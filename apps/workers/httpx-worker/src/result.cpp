#include "result.hpp"

#include <openssl/sha.h>

#include <algorithm>
#include <charconv>
#include <cctype>
#include <format>
#include <map>
#include <set>
#include <sstream>
#include <tuple>

namespace httpx_worker {
namespace {
using Json = nlohmann::json;

std::string iso(std::chrono::system_clock::time_point time) {
    return std::format("{:%FT%TZ}", std::chrono::floor<std::chrono::milliseconds>(time));
}

OrderedJson nullable(const std::string& value) {
    return value.empty() ? OrderedJson(nullptr) : OrderedJson(value);
}

OrderedJson error_json(const Error& error) {
    return OrderedJson{{"code", error.code}, {"message", error.message}};
}

std::string sha256(std::string_view text) {
    unsigned char hash[SHA256_DIGEST_LENGTH];
    SHA256(reinterpret_cast<const unsigned char*>(text.data()), text.size(), hash);
    constexpr char hex[] = "0123456789abcdef";
    std::string output;
    output.reserve(64);
    for (auto byte : hash) {
        output += hex[byte >> 4];
        output += hex[byte & 15];
    }
    return output;
}

std::string lower(std::string text) {
    std::ranges::transform(text, text.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return text;
}

std::string trim(std::string text) {
    const auto first = text.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) return {};
    const auto last = text.find_last_not_of(" \t\r\n");
    return text.substr(first, last - first + 1);
}

std::string str(const Json& object, const char* key) {
    auto it = object.find(key);
    return it != object.end() && it->is_string() ? it->get<std::string>() : "";
}

int number(const Json& object, const char* key) {
    auto it = object.find(key);
    return it != object.end() && it->is_number_integer() ? it->get<int>() : 0;
}

bool text_type(std::string_view type) {
    return type.starts_with("text/") || type.find("json") != std::string_view::npos ||
           type.find("xml") != std::string_view::npos ||
           type.find("javascript") != std::string_view::npos;
}

std::vector<std::pair<std::string, std::string>> raw_headers(const Json& row) {
    std::vector<std::pair<std::string, std::string>> headers;
    std::istringstream stream{str(row, "raw_header")};
    std::string line;
    while (std::getline(stream, line)) {
        auto colon = line.find(':');
        if (colon == std::string::npos) continue;
        auto name = lower(trim(line.substr(0, colon)));
        if (name.empty()) continue;
        headers.emplace_back(std::move(name), trim(line.substr(colon + 1)));
    }
    if (!headers.empty()) return headers;
    auto object = row.find("header");
    if (object != row.end() && object->is_object()) {
        for (auto it = object->begin(); it != object->end(); ++it) {
            if (it.value().is_string()) headers.emplace_back(lower(it.key()), it.value().get<std::string>());
        }
    }
    return headers;
}

OrderedJson cookie_json(const std::string& header) {
    const auto semicolon = header.find(';');
    const auto pair = trim(header.substr(0, semicolon));
    const auto equals = pair.find('=');
    if (equals == std::string::npos || equals == 0) return nullptr;
    OrderedJson cookie{{"name", pair.substr(0, equals)},
                       {"valueSha256", sha256(pair.substr(equals + 1))},
                       {"secure", false}, {"httpOnly", false}, {"sameSite", nullptr},
                       {"domain", nullptr}, {"path", nullptr}, {"expires", nullptr}};
    std::size_t next = semicolon;
    while (next != std::string::npos) {
        const auto end = header.find(';', next + 1);
        const auto attribute = trim(header.substr(next + 1, end == std::string::npos
                                                              ? end : end - next - 1));
        const auto equal = attribute.find('=');
        const auto name = lower(trim(attribute.substr(0, equal)));
        const auto value = equal == std::string::npos ? "" : trim(attribute.substr(equal + 1));
        if (name == "secure") cookie["secure"] = true;
        else if (name == "httponly") cookie["httpOnly"] = true;
        else if (name == "domain" && !value.empty()) cookie["domain"] = value;
        else if (name == "path" && !value.empty()) cookie["path"] = value;
        else if (name == "expires" && !value.empty()) cookie["expires"] = value;
        else if (name == "samesite") {
            if (lower(value) == "strict") cookie["sameSite"] = "Strict";
            else if (lower(value) == "lax") cookie["sameSite"] = "Lax";
            else if (lower(value) == "none") cookie["sameSite"] = "None";
        }
        next = end;
    }
    return cookie;
}

OrderedJson header_json(const Json& row, OrderedJson& cookies) {
    OrderedJson headers = OrderedJson::array();
    for (const auto& [name, value] : raw_headers(row)) {
        if (name == "set-cookie") {
            auto cookie = cookie_json(value);
            if (!cookie.is_null()) cookies.push_back(std::move(cookie));
        } else {
            headers.push_back(OrderedJson{{"name", name}, {"value", value}});
        }
    }
    return headers;
}

OrderedJson body_json(const Json& row, std::uint32_t limit) {
    const auto status = number(row, "status_code");
    if (status < 100 || status > 599) return nullptr;
    const std::string body = str(row, "body");
    const auto content_type = str(row, "content_type");
    const auto length = number(row, "content_length");
    const auto read_size = std::min<std::size_t>(body.size(), limit);
    const auto captured = body.substr(0, read_size);
    const bool truncated = body.size() > limit ||
        (length > 0 && static_cast<std::size_t>(length) > body.size());
    return OrderedJson{{"sha256", sha256(captured)},
                       {"size", length > 0 ? length : static_cast<int>(body.size())},
                       {"contentType", nullable(content_type)},
                       {"content", text_type(content_type) ? OrderedJson(captured) : OrderedJson(nullptr)},
                       {"truncated", truncated}};
}

std::string logical_url(const Target& target, int port, std::string_view scheme,
                        const std::string& domain, std::string_view path = "/") {
    return std::format("{}://{}:{}{}", scheme, domain.empty() ? target.ip : domain, port, path);
}

OrderedJson probe_json(const Json& row, const std::string& path) {
    const int code = number(row, "status_code");
    OrderedJson error = nullptr;
    if (code < 100 || code > 599)
        error = error_json(Error{"http-no-response", "HTTP path did not respond"});
    const auto body = str(row, "body");
    return OrderedJson{{"path", path},
                       {"statusCode", code >= 100 && code <= 599 ? OrderedJson(code) : OrderedJson(nullptr)},
                       {"location", nullable(str(row, "location"))},
                       {"title", nullable(str(row, "title"))},
                       {"size", code >= 100 && code <= 599
                                    ? OrderedJson(std::max(0, number(row, "content_length")))
                                    : OrderedJson(nullptr)},
                       {"bodySha256", code >= 100 && code <= 599
                                          ? OrderedJson(sha256(body)) : OrderedJson(nullptr)},
                       {"error", std::move(error)}};
}

OrderedJson endpoint_json(const Json& row, const Target& target, int port,
                          const std::string& scheme, const std::string& domain,
                          std::uint32_t body_limit) {
    const int code = number(row, "status_code");
    OrderedJson cookies = OrderedJson::array();
    auto headers = header_json(row, cookies);
    OrderedJson redirects = OrderedJson::array();
    const auto location = str(row, "location");
    if (code >= 300 && code <= 399 && !location.empty()) {
        redirects.push_back(OrderedJson{{"url", logical_url(target, port, scheme, domain)},
                                         {"statusCode", code}, {"location", location},
                                         {"followed", false}});
    }
    return OrderedJson{{"scheme", scheme}, {"vhost", nullable(domain)},
                       {"url", logical_url(target, port, scheme, domain)},
                       {"finalUrl", logical_url(target, port, scheme, domain)},
                       {"statusCode", code >= 100 && code <= 599 ? OrderedJson(code) : OrderedJson(nullptr)},
                       {"title", nullable(str(row, "title"))},
                       {"headers", std::move(headers)}, {"cookies", std::move(cookies)},
                       {"redirects", std::move(redirects)},
                       {"body", body_json(row, body_limit)},
                       {"favicon", nullptr}, {"tls", nullptr},
                       {"probes", OrderedJson::array()},
                       {"error", code >= 100 && code <= 599 ? OrderedJson(nullptr)
                           : error_json(Error{"http-no-response", "HTTP endpoint did not respond"})}};
}

OrderedJson port_json(int number, OrderedJson http) {
    return OrderedJson{{"port", number}, {"protocol", "tcp"}, {"state", "open"},
                       {"reason", nullptr}, {"service", nullptr},
                       {"identity", OrderedJson{{"ttl", nullptr},
                           {"sshHostKeySha256", nullptr}, {"tlsCertSha256", nullptr}}},
                       {"banner", nullptr}, {"scripts", OrderedJson::array()},
                       {"tls", OrderedJson::array()},
                       {"http", std::move(http)}};
}

OrderedJson scan_json(const Job& job, const std::string& status,
                      const std::string& reason, const std::optional<Error>& error,
                      std::chrono::system_clock::time_point started,
                      std::chrono::milliseconds duration, OrderedJson counts) {
    const auto finished = std::chrono::system_clock::now();
    return OrderedJson{{"jobId", nullable(job.job_id)},
        {"leaseId", nullable(job.lease_id)}, {"scanId", nullable(job.scan_id)},
        {"worker", OrderedJson{{"id", "httpx-worker"},
                               {"version", HTTPX_WORKER_VERSION}, {"nmapVersion", nullptr}}},
        {"status", status}, {"stopReason", nullable(reason)},
        {"startedAt", iso(started)}, {"finishedAt", iso(finished)},
        {"durationMs", duration.count()},
        {"phasesMs", OrderedJson{{"hostDiscovery", 0}, {"portScan", 0},
                                  {"serviceDetection", 0}, {"http", duration.count()}}},
        {"params", OrderedJson{{"subnet", nullable(job.subnet)}, {"ports", nullable(job.ports)},
            {"maxParallel", job.limits.threads}, {"maxRatePerProcess", job.limits.rate},
            {"hostTimeoutMs", nullptr},
            {"httpTimeoutMs", job.limits.timeout_seconds * 1000},
            {"maxBodyBytes", job.limits.max_body_bytes},
            {"maxRedirects", job.limits.max_redirects}, {"nmapArgs", OrderedJson::array()}}},
        {"counts", std::move(counts)},
        {"error", error ? error_json(*error) : OrderedJson(nullptr)}};
}

} // namespace

OrderedJson make_result(const Job& job, const std::vector<GroupResult>& groups,
                        std::size_t processed_targets, const std::string& status,
                        const std::string& stop_reason, const std::optional<Error>& error,
                        std::chrono::system_clock::time_point started,
                        std::chrono::milliseconds duration) {
    using Key = std::tuple<int, std::string, std::string>; // port, scheme, vhost
    struct Draft { Json root; std::map<std::string, Json> probes; bool seen = false; };
    std::vector<std::map<Key, Draft>> drafts(job.targets.size());
    std::size_t requests = 0;
    for (const auto& group : groups) {
        if (group.target_index >= job.targets.size()) continue;
        const auto& target = job.targets[group.target_index];
        const std::size_t planned = count_ports(target.ports) * 2 *
                                    (job.probe_paths.size() + 1);
        std::size_t rows = 0;
        std::istringstream lines{group.jsonl};
        std::string line;
        while (std::getline(lines, line)) {
            const Json row = Json::parse(line, nullptr, false);
            if (!row.is_object()) continue;
            const auto scheme = str(row, "scheme");
            if (scheme != "http" && scheme != "https") continue;
            const auto port_string = str(row, "port");
            int port = 0;
            const auto [end, ec] = std::from_chars(port_string.data(),
                port_string.data() + port_string.size(), port);
            if (ec != std::errc{} || end != port_string.data() + port_string.size() ||
                port < 1 || port > 65535) continue;
            if (!std::ranges::any_of(target.ports, [port](const PortRange& range) {
                return range.first <= port && port <= range.last;
            })) continue;
            const auto expected = std::format("{}://{}:{}/", scheme, target.ip, port);
            const auto source = str(row, "input");
            const auto url = str(row, "url");
            if (source != expected && !url.starts_with(expected)) continue;
            const auto path = str(row, "path");
            if (path != "/" && std::ranges::find(job.probe_paths, path) == job.probe_paths.end())
                continue;
            ++rows;
            auto& draft = drafts[group.target_index][Key{port, scheme, group.domain}];
            if (path == "/") draft.root = row;
            else draft.probes[path] = row;
            draft.seen = true;
        }
        // httpx omits failed connections from JSONL, even with -probe. A completed
        // group has attempted every URL/path; on interruption only emitted rows are known.
        requests += group.stopped ? rows : planned;
    }

    OrderedJson hosts = OrderedJson::array();
    std::size_t up = 0, down = 0, cancelled = 0, open_ports = 0, endpoints = 0;
    for (std::size_t index = 0; index < job.targets.size(); ++index) {
        const auto& target = job.targets[index];
        std::map<int, OrderedJson> port_http;
        bool has_response = false;
        for (const auto& [key, draft] : drafts[index]) {
            const auto& [port, scheme, domain] = key;
            const bool root_ok = draft.root.is_object() &&
                number(draft.root, "status_code") >= 100 &&
                number(draft.root, "status_code") <= 599;
            bool probe_ok = false;
            for (const auto& [path, row] : draft.probes) {
                (void)path;
                probe_ok |= number(row, "status_code") >= 100 &&
                            number(row, "status_code") <= 599;
            }
            if (!root_ok && !probe_ok) continue;
            has_response = true;
            OrderedJson endpoint = endpoint_json(draft.root, target, port, scheme, domain,
                                                 job.limits.max_body_bytes);
            for (const auto& path : job.probe_paths) {
                auto it = draft.probes.find(path);
                endpoint["probes"].push_back(probe_json(it == draft.probes.end()
                    ? Json::object() : it->second, path));
            }
            if (!port_http.contains(port)) port_http.emplace(port, OrderedJson::array());
            port_http.at(port).push_back(std::move(endpoint));
            ++endpoints;
        }
        OrderedJson ports = OrderedJson::array();
        const bool processed = index < processed_targets;
        if (processed && target.known_open) {
            for (const auto& range : target.ports) {
                for (int port = range.first; port <= range.last; ++port) {
                    auto it = port_http.find(port);
                    ports.push_back(port_json(port, it == port_http.end()
                        ? OrderedJson::array() : std::move(it->second)));
                }
            }
        } else if (processed) {
            for (auto& [port, http] : port_http)
                ports.push_back(port_json(port, std::move(http)));
        }
        const std::string host_status = !processed ? "cancelled"
            : target.known_open || has_response ? "up" : "down";
        up += host_status == "up";
        down += host_status == "down";
        cancelled += host_status == "cancelled";
        open_ports += ports.size();
        OrderedJson names = OrderedJson::array();
        for (const auto& domain : target.domains)
            names.push_back(OrderedJson{{"name", domain}, {"source", "job"}});
        hosts.push_back(OrderedJson{{"ip", target.ip}, {"status", host_status},
            {"reason", nullptr},
            {"observedAt", processed ? OrderedJson(iso(std::chrono::system_clock::now()))
                                     : OrderedJson(nullptr)},
            {"latencyMs", nullptr}, {"hostnames", std::move(names)},
            {"error", nullptr}, {"ports", std::move(ports)}});
    }
    OrderedJson counts{{"addresses", job.targets.size()}, {"up", up}, {"down", down},
                       {"timeout", 0}, {"cancelled", cancelled}, {"failed", 0},
                       {"openPorts", open_ports}, {"httpEndpoints", endpoints},
                       {"httpRequests", requests}};
    return OrderedJson{{"scan", scan_json(job, status, stop_reason, error,
                                          started, duration, std::move(counts))},
                       {"hosts", std::move(hosts)}};
}

OrderedJson make_failed_result(std::string_view input, const Error& error) {
    Json data = Json::parse(input, nullptr, false);
    if (!data.is_object()) data = Json::object();
    const auto field = [&](const char* key) { return str(data, key); };
    const auto now = iso(std::chrono::system_clock::now());
    return OrderedJson{{"scan", OrderedJson{
        {"jobId", nullable(field("job_id"))}, {"leaseId", nullable(field("lease_id"))},
        {"scanId", nullable(field("scan_id"))},
        {"worker", OrderedJson{{"id", "httpx-worker"},
                                {"version", HTTPX_WORKER_VERSION}, {"nmapVersion", nullptr}}},
        {"status", "failed"}, {"stopReason", "error"},
        {"startedAt", now}, {"finishedAt", now}, {"durationMs", 0},
        {"phasesMs", OrderedJson{{"hostDiscovery", 0}, {"portScan", 0},
                                  {"serviceDetection", 0}, {"http", 0}}},
        {"params", OrderedJson{{"subnet", nullptr}, {"ports", nullptr},
            {"maxParallel", nullptr}, {"maxRatePerProcess", nullptr},
            {"hostTimeoutMs", nullptr}, {"httpTimeoutMs", nullptr},
            {"maxBodyBytes", nullptr}, {"maxRedirects", nullptr},
            {"nmapArgs", OrderedJson::array()}}},
        {"counts", OrderedJson{{"addresses", nullptr}, {"up", 0}, {"down", nullptr},
            {"timeout", 0}, {"cancelled", nullptr}, {"failed", 0},
            {"openPorts", 0}, {"httpEndpoints", 0}, {"httpRequests", 0}}},
        {"error", error_json(error)}}}, {"hosts", OrderedJson::array()}};
}

} // namespace httpx_worker
