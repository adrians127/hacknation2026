#include "json_codec.hpp"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <arpa/inet.h>
#include <charconv>
#include <cctype>
#include <chrono>
#include <cstdint>
#include <expected>
#include <format>
#include <limits>
#include <set>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace nmap_worker {
namespace {

using Json = nlohmann::json;

std::expected<int, Error> decimal(std::string_view input) {
    int value = 0;
    const auto [end, error] = std::from_chars(input.data(), input.data() + input.size(), value);
    if (error != std::errc{} || end != input.data() + input.size()) {
        return std::unexpected(Error{"invalid-deadline", "Deadline must be UTC ISO 8601"});
    }
    return value;
}

std::expected<std::chrono::system_clock::time_point, Error> parse_deadline(std::string_view input) {
    if (input.size() != 20 || input[4] != '-' || input[7] != '-' || input[10] != 'T' ||
        input[13] != ':' || input[16] != ':' || input[19] != 'Z') {
        return std::unexpected(Error{"invalid-deadline", "Deadline must be YYYY-MM-DDTHH:MM:SSZ"});
    }
    const auto year = decimal(input.substr(0, 4));
    const auto month = decimal(input.substr(5, 2));
    const auto day = decimal(input.substr(8, 2));
    const auto hour = decimal(input.substr(11, 2));
    const auto minute = decimal(input.substr(14, 2));
    const auto second = decimal(input.substr(17, 2));
    if (!year || !month || !day || !hour || !minute || !second || *year < 1 || *month < 1 ||
        *month > 12 || *day < 1 || *day > 31 || *hour < 0 || *hour > 23 || *minute < 0 ||
        *minute > 59 || *second < 0 || *second > 59) {
        return std::unexpected(Error{"invalid-deadline", "Deadline contains an invalid date or time"});
    }
    const std::chrono::year_month_day date{std::chrono::year{*year},
                                           std::chrono::month{static_cast<unsigned>(*month)},
                                           std::chrono::day{static_cast<unsigned>(*day)}};
    if (!date.ok()) return std::unexpected(Error{"invalid-deadline", "Invalid calendar date"});
    return std::chrono::sys_days{date} + std::chrono::hours{*hour} + std::chrono::minutes{*minute} +
           std::chrono::seconds{*second};
}

std::expected<std::pair<std::uint32_t, unsigned>, Error> parse_subnet(std::string_view subnet) {
    const auto slash = subnet.find('/');
    if (slash == std::string_view::npos || slash == 0 || slash + 1 == subnet.size())
        return std::unexpected(Error{"invalid-subnet", "Expected an IPv4 CIDR"});
    const std::string address{subnet.substr(0, slash)};
    in_addr parsed{};
    if (inet_pton(AF_INET, address.c_str(), &parsed) != 1)
        return std::unexpected(Error{"invalid-subnet", "Expected an IPv4 CIDR"});
    int prefix = 0;
    const auto digits = subnet.substr(slash + 1);
    const auto [end, error] = std::from_chars(digits.data(), digits.data() + digits.size(), prefix);
    if (error != std::errc{} || end != digits.data() + digits.size() || prefix < 0 || prefix > 32)
        return std::unexpected(Error{"invalid-subnet", "IPv4 prefix must be between 0 and 32"});
    return std::pair{ntohl(parsed.s_addr), static_cast<unsigned>(prefix)};
}

bool is_in_subnet(std::string_view ip, std::uint32_t network, unsigned prefix) {
    const std::string address{ip};
    in_addr parsed{};
    if (inet_pton(AF_INET, address.c_str(), &parsed) != 1) return false;
    const std::uint32_t mask =
        prefix == 0 ? 0 : (std::numeric_limits<std::uint32_t>::max() << (32U - prefix));
    return (ntohl(parsed.s_addr) & mask) == (network & mask);
}

std::expected<std::string, Error> required_string(const Json& object, const char* key) {
    if (!object.contains(key) || !object.at(key).is_string())
        return std::unexpected(Error{"invalid-job", std::string{"Missing string: "} + key});
    const std::string value = object.at(key).get<std::string>();
    if (value.empty() || value.size() > 256)
        return std::unexpected(Error{"invalid-job", std::string{"Invalid string: "} + key});
    return value;
}

bool is_uuid(std::string_view value) {
    if (value.size() != 36 || value[8] != '-' || value[13] != '-' ||
        value[18] != '-' || value[23] != '-') return false;
    for (std::size_t index = 0; index < value.size(); ++index) {
        if (index == 8 || index == 13 || index == 18 || index == 23) continue;
        if (!std::isxdigit(static_cast<unsigned char>(value[index]))) return false;
    }
    const char version = value[14];
    const char variant = static_cast<char>(std::tolower(
        static_cast<unsigned char>(value[19])));
    return version >= '1' && version <= '8' &&
           (variant == '8' || variant == '9' || variant == 'a' || variant == 'b');
}

std::expected<std::int64_t, Error> positive_limit(const Json& json, const char* key) {
    if (!json.at(key).is_number_integer())
        return std::unexpected(Error{"invalid-job", std::string{key} + " must be a positive integer"});
    const auto value = json.at(key).get<std::int64_t>();
    if (value <= 0)
        return std::unexpected(Error{"invalid-job", std::string{key} + " must be positive"});
    return value;
}

Json nullable(const std::optional<std::string>& value) {
    return value ? Json(*value) : Json(nullptr);
}

Json error_json(const Error& error) {
    return Json{{"code", error.code}, {"message", error.message}};
}

std::string iso8601(std::chrono::system_clock::time_point time) {
    return std::format("{:%FT%TZ}", std::chrono::floor<std::chrono::milliseconds>(time));
}

Json params_json(const JobResult& result) {
    return Json{{"subnet", result.subnet.empty() ? Json(nullptr) : Json(result.subnet)},
                {"ports", result.ports.empty() ? Json(nullptr) : Json(result.ports)},
                {"maxParallel", result.limits.max_parallel},
                {"maxRatePerProcess", result.limits.max_rate_per_process},
                {"hostTimeoutMs", result.limits.host_timeout.count()},
                {"httpTimeoutMs", result.limits.http_timeout.count()},
                {"maxBodyBytes", result.limits.max_body_bytes},
                {"maxRedirects", result.limits.max_redirects},
                {"nmapArgs", result.nmap_args}};
}

Json host_json(const HostResult& host) {
    Json names = Json::array();
    for (const auto& domain : host.domains)
        names.push_back(Json{{"name", domain}, {"source", "job"}});
    for (const auto& name : host.ptr_names)
        names.push_back(Json{{"name", name}, {"source", "ptr"}});

    Json ports = Json::array();
    for (const auto& port : host.ports) {
        Json service = nullptr;
        if (port.service) {
            service = Json{{"name", port.service->name},
                           {"product", nullable(port.service->product)},
                           {"version", nullable(port.service->version)},
                           {"extraInfo", nullable(port.service->extra_info)},
                           {"cpe", port.service->cpe},
                           {"method", port.service->method},
                           {"confidence", port.service->confidence}};
        }
        Json scripts = Json::array();
        for (const auto& script : port.scripts)
            scripts.push_back(Json{{"id", script.id}, {"output", script.output}});
        ports.push_back(Json{{"port", port.number},
                             {"protocol", port.protocol},
                             {"state", port.state},
                             {"reason", nullable(port.reason)},
                             {"service", std::move(service)},
                             {"identity", Json{{"ttl", port.ttl ? Json(*port.ttl) : Json(nullptr)},
                                               {"sshHostKeySha256", nullptr},
                                               {"tlsCertSha256", nullptr}}},
                             {"banner", nullptr},
                             {"scripts", std::move(scripts)},
                             {"http", Json::array()}});
    }
    return Json{{"ip", host.ip},
                {"status", host.status},
                {"reason", nullable(host.reason)},
                {"observedAt", host.observed_at ? Json(iso8601(*host.observed_at)) : Json(nullptr)},
                {"latencyMs", host.latency_ms ? Json(*host.latency_ms) : Json(nullptr)},
                {"hostnames", std::move(names)},
                {"error", host.error ? error_json(*host.error) : Json(nullptr)},
                {"ports", std::move(ports)}};
}

}  // namespace

std::expected<ScanJob, Error> parse_scan_job(std::string_view input,
                                             const ScanLimits& maximum_limits) {
    try {
        const Json json = Json::parse(input);
        if (!json.is_object())
            return std::unexpected(Error{"invalid-job", "Job must be a JSON object"});
        const auto job_id = required_string(json, "job_id");
        const auto lease_id = required_string(json, "lease_id");
        const auto scan_id = required_string(json, "scan_id");
        const auto subnet = required_string(json, "subnet");
        const auto deadline_text = required_string(json, "deadline");
        if (!job_id) return std::unexpected(job_id.error());
        if (!lease_id) return std::unexpected(lease_id.error());
        if (!scan_id) return std::unexpected(scan_id.error());
        if (!is_uuid(*job_id) || !is_uuid(*scan_id))
            return std::unexpected(Error{"invalid-job", "job_id and scan_id must be UUIDs"});
        if (!subnet) return std::unexpected(subnet.error());
        if (!deadline_text) return std::unexpected(deadline_text.error());
        const auto deadline = parse_deadline(*deadline_text);
        const auto network = parse_subnet(*subnet);
        if (!deadline) return std::unexpected(deadline.error());
        if (!network) return std::unexpected(network.error());
        if (!json.contains("targets") || !json.at("targets").is_array() ||
            json.at("targets").empty() || json.at("targets").size() > 1024)
            return std::unexpected(Error{"invalid-job", "targets must contain 1 to 1024 hosts"});

        ScanLimits limits = maximum_limits;
        if (json.contains("limits")) {
            const auto& requested = json.at("limits");
            if (!requested.is_object())
                return std::unexpected(Error{"invalid-job", "limits must be an object"});
            if (requested.contains("max_parallel")) {
                const auto value = positive_limit(requested, "max_parallel");
                if (!value) return std::unexpected(value.error());
                limits.max_parallel = std::min(static_cast<std::size_t>(*value),
                                               maximum_limits.max_parallel);
            }
            if (requested.contains("max_rate_per_process")) {
                const auto value = positive_limit(requested, "max_rate_per_process");
                if (!value) return std::unexpected(value.error());
                limits.max_rate_per_process = static_cast<std::uint32_t>(
                    std::min(*value, static_cast<std::int64_t>(maximum_limits.max_rate_per_process)));
            }
            if (requested.contains("host_timeout_ms")) {
                const auto value = positive_limit(requested, "host_timeout_ms");
                if (!value) return std::unexpected(value.error());
                limits.host_timeout = std::chrono::milliseconds{
                    std::min(*value, maximum_limits.host_timeout.count())};
            }
            if (requested.contains("http_timeout_ms")) {
                const auto value = positive_limit(requested, "http_timeout_ms");
                if (!value) return std::unexpected(value.error());
                limits.http_timeout = std::chrono::milliseconds{
                    std::min(*value, maximum_limits.http_timeout.count())};
            }
            if (requested.contains("max_body_bytes")) {
                const auto value = positive_limit(requested, "max_body_bytes");
                if (!value) return std::unexpected(value.error());
                limits.max_body_bytes = std::min(static_cast<std::size_t>(*value),
                                                 maximum_limits.max_body_bytes);
            }
            if (requested.contains("max_redirects")) {
                if (!requested.at("max_redirects").is_number_integer())
                    return std::unexpected(Error{"invalid-job", "max_redirects must be nonnegative"});
                const auto value = requested.at("max_redirects").get<std::int64_t>();
                if (value < 0)
                    return std::unexpected(Error{"invalid-job", "max_redirects must be nonnegative"});
                limits.max_redirects = std::min(static_cast<std::size_t>(value),
                                                 maximum_limits.max_redirects);
            }
        }

        std::vector<std::string> probe_paths;
        if (json.contains("probe_paths")) {
            const auto& paths = json.at("probe_paths");
            if (!paths.is_array() || paths.size() > 128)
                return std::unexpected(Error{"invalid-job", "probe_paths must contain at most 128 paths"});
            for (const auto& path : paths) {
                if (!path.is_string())
                    return std::unexpected(Error{"invalid-job", "probe_paths must be strings"});
                const auto value = path.get<std::string>();
                if (value.empty() || value.size() > 2048 || value[0] != '/' ||
                    value.starts_with("//"))
                    return std::unexpected(Error{"invalid-job", "Invalid probe path"});
                probe_paths.push_back(value);
            }
        }

        std::vector<Target> targets;
        targets.reserve(json.at("targets").size());
        std::set<std::string> seen_ips;
        for (const auto& target_json : json.at("targets")) {
            if (!target_json.is_object())
                return std::unexpected(Error{"invalid-job", "Each target must be an object"});
            const auto ip = required_string(target_json, "ip");
            if (!ip) return std::unexpected(ip.error());
            if (!is_in_subnet(*ip, network->first, network->second))
                return std::unexpected(Error{"invalid-target", "Target IP is outside job subnet"});
            if (!seen_ips.insert(*ip).second)
                return std::unexpected(Error{"invalid-target", "Duplicate target IP"});
            Target target{.ip = *ip};
            if (target_json.contains("domains")) {
                const auto& domains = target_json.at("domains");
                if (!domains.is_array() || domains.size() > 128)
                    return std::unexpected(Error{"invalid-target", "domains must be an array of at most 128 names"});
                for (const auto& domain : domains) {
                    if (!domain.is_string())
                        return std::unexpected(Error{"invalid-target", "domains must be strings"});
                    const auto name = domain.get<std::string>();
                    if (name.empty() || name.size() > 253)
                        return std::unexpected(Error{"invalid-target", "Invalid domain"});
                    target.domains.push_back(name);
                }
            } else if (target_json.contains("domain") && !target_json.at("domain").is_null()) {
                if (!target_json.at("domain").is_string())
                    return std::unexpected(Error{"invalid-target", "domain must be a string"});
                const auto name = target_json.at("domain").get<std::string>();
                if (name.empty() || name.size() > 253)
                    return std::unexpected(Error{"invalid-target", "Invalid domain"});
                target.domains.push_back(name);
            }
            std::ranges::sort(target.domains);
            target.domains.erase(std::ranges::unique(target.domains).begin(), target.domains.end());
            if (!target_json.contains("tcp_ports") || !target_json.at("tcp_ports").is_array() ||
                target_json.at("tcp_ports").empty() || target_json.at("tcp_ports").size() > 4096)
                return std::unexpected(Error{"invalid-target", "tcp_ports must contain 1 to 4096 ports"});
            for (const auto& port_json : target_json.at("tcp_ports")) {
                if (!port_json.is_number_integer())
                    return std::unexpected(Error{"invalid-target", "tcp_ports must be integers"});
                const auto port = port_json.get<int>();
                if (port < 1 || port > 65535)
                    return std::unexpected(Error{"invalid-target", "TCP port is outside 1-65535"});
                target.tcp_ports.push_back(static_cast<std::uint16_t>(port));
            }
            std::ranges::sort(target.tcp_ports);
            target.tcp_ports.erase(std::ranges::unique(target.tcp_ports).begin(),
                                   target.tcp_ports.end());
            targets.push_back(std::move(target));
        }
        return ScanJob{.job_id = *job_id, .lease_id = *lease_id, .scan_id = *scan_id,
                       .subnet = *subnet, .deadline = *deadline, .limits = limits,
                       .probe_paths = std::move(probe_paths), .targets = std::move(targets)};
    } catch (const Json::exception& error) {
        return std::unexpected(Error{"invalid-json", error.what()});
    }
}

std::string serialize_job_result(const JobResult& result) {
    Json hosts = Json::array();
    Json counts{{"addresses", result.hosts.size()}, {"up", 0}, {"down", 0},
                {"timeout", 0}, {"cancelled", 0}, {"failed", 0},
                {"openPorts", 0}, {"httpEndpoints", 0}, {"httpRequests", 0}};
    for (const auto& host : result.hosts) {
        counts[host.status] = counts[host.status].get<std::size_t>() + 1;
        counts["openPorts"] = counts["openPorts"].get<std::size_t>() + host.ports.size();
        hosts.push_back(host_json(host));
    }
    const Json scan{{"jobId", result.job_id},
                    {"leaseId", result.lease_id},
                    {"scanId", result.scan_id},
                    {"worker", Json{{"id", "nmap-worker"},
                                    {"version", NMAP_WORKER_VERSION},
                                    {"nmapVersion", nullable(result.nmap_version)}}},
                    {"status", result.status},
                    {"stopReason", nullable(result.stop_reason)},
                    {"startedAt", iso8601(result.started_at)},
                    {"finishedAt", iso8601(result.finished_at)},
                    {"durationMs", result.duration.count()},
                    {"phasesMs", Json{{"hostDiscovery", 0}, {"portScan", result.duration.count()},
                                      {"serviceDetection", 0}, {"http", 0}}},
                    {"params", params_json(result)},
                    {"counts", std::move(counts)},
                    {"error", result.error ? error_json(*result.error) : Json(nullptr)}};
    return Json{{"scan", scan}, {"hosts", std::move(hosts)}}.dump();
}

std::string serialize_error(const Error& error) { return error_json(error).dump(); }

std::string serialize_failed_job(std::string_view input, const Error& error,
                                 const ScanLimits& limits) {
    const auto started = std::chrono::system_clock::now();
    JobResult result;
    result.status = "failed";
    result.stop_reason = "error";
    result.error = error;
    result.started_at = started;
    result.finished_at = started;
    result.limits = limits;
    const auto json = Json::parse(input, nullptr, false);
    if (json.is_object()) {
        const auto field = [&](const char* key) -> std::string {
            return json.contains(key) && json.at(key).is_string()
                       ? json.at(key).get<std::string>() : "";
        };
        result.job_id = field("job_id");
        result.lease_id = field("lease_id");
        result.scan_id = field("scan_id");
        result.subnet = field("subnet");
        const auto targets = json.value("targets", Json::array());
        if (targets.is_array()) {
            for (const auto& target : targets) {
                if (target.is_object() && target.contains("ip") && target.at("ip").is_string()) {
                    result.hosts.push_back(HostResult{.ip = target.at("ip").get<std::string>()});
                }
            }
        }
    }
    return serialize_job_result(result);
}

}  // namespace nmap_worker
