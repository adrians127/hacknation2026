#include "json_codec.hpp"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <expected>
#include <format>
#include <map>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace nmap_worker {
namespace {

// Input is read as in masscan-worker (same fields, rules and messages); output keys keep the
// order of docs/worker-result-format.md, as masscan-worker writes them.
using Json = nlohmann::json;
using OrderedJson = nlohmann::ordered_json;

constexpr std::string_view kDefaultPorts = "1-65535";
constexpr std::uint64_t kMaxDurationSeconds = 7 * 24 * 3600;  // same bound as masscan-worker
constexpr std::uint64_t kMaxAddresses = 1024;  // hosts[] lists every address of the job

std::unexpected<Error> invalid(std::string message) {
    return std::unexpected(Error{"invalid-input", std::move(message)});
}

std::expected<std::optional<std::uint64_t>, Error> optional_uint(const Json& input,
                                                                 std::string_view key,
                                                                 std::uint64_t max) {
    const auto it = input.find(key);
    if (it == input.end() || it->is_null()) return std::nullopt;
    if (!it->is_number_unsigned() || it->get<std::uint64_t>() > max) {
        return invalid(std::format("'{}' must be an integer between 0 and {}", key, max));
    }
    return it->get<std::uint64_t>();
}

std::expected<std::optional<std::uint64_t>, Error> optional_positive(const Json& input,
                                                                     std::string_view key,
                                                                     std::uint64_t max) {
    auto value = optional_uint(input, key, max);
    if (value && *value && **value == 0) return invalid(std::format("'{}' must be positive", key));
    return value;
}

std::expected<std::optional<std::string>, Error> optional_string(const Json& input,
                                                                 std::string_view key) {
    const auto it = input.find(key);
    if (it == input.end() || it->is_null()) return std::nullopt;
    if (!it->is_string()) return invalid(std::format("'{}' must be a string", key));
    return it->get<std::string>();
}

void add_split(std::string_view text, std::vector<std::string>& items) {
    while (!text.empty()) {
        const std::size_t comma = text.find(',');
        std::string_view item = text.substr(0, comma);
        while (!item.empty() && item.front() == ' ') item.remove_prefix(1);
        while (!item.empty() && item.back() == ' ') item.remove_suffix(1);
        if (!item.empty()) items.emplace_back(item);
        text = comma == std::string_view::npos ? std::string_view{} : text.substr(comma + 1);
    }
}

// A single string ("a, b") or an array of strings; port arrays may also hold numbers.
std::expected<std::vector<std::string>, Error> string_list(const Json& value, std::string_view key,
                                                           bool allow_numbers) {
    std::vector<std::string> items;
    if (value.is_string()) {
        add_split(value.get_ref<const std::string&>(), items);
        return items;
    }
    if (!value.is_array()) return invalid(std::format("'{}' must be a string or an array", key));
    for (const Json& item : value) {
        if (item.is_string()) {
            add_split(item.get_ref<const std::string&>(), items);
        } else if (allow_numbers && item.is_number_unsigned()) {
            items.push_back(std::to_string(item.get<std::uint64_t>()));
        } else {
            return invalid(std::format("'{}' contains an invalid item: {}", key, item.dump()));
        }
    }
    return items;
}

std::expected<std::vector<PortRange>, Error> parse_ports(const Json& value, std::string_view key) {
    auto specs = string_list(value, key, true);
    if (!specs) return std::unexpected(specs.error());
    if (specs->empty()) return invalid(std::format("'{}' must not be empty", key));
    std::vector<PortRange> ports;
    for (const std::string& spec : *specs) {
        const auto range = parse_port_range(spec);
        if (!range) return std::unexpected(range.error());
        ports.push_back(*range);
    }
    return merge_ranges(std::move(ports));
}

std::expected<std::vector<Ipv4Range>, Error> parse_ranges(const std::vector<std::string>& specs) {
    std::vector<Ipv4Range> ranges;
    for (const std::string& spec : specs) {
        auto range = parse_ipv4_range(spec);
        if (!range) return std::unexpected(range.error());
        ranges.push_back(*range);
    }
    return merge_ranges(std::move(ranges));
}

// A host object in `targets`: {"ip": "10.0.0.5", "ports": [22, 443], "domains": ["a.example"]}.
struct HostSpec {
    std::uint32_t address = 0;
    std::optional<std::vector<PortRange>> ports{};
    std::vector<std::string> domains{};
};

std::expected<HostSpec, Error> parse_host(const Json& target) {
    const auto ip = optional_string(target, "ip");
    if (!ip) return std::unexpected(ip.error());
    if (!*ip) return invalid("'targets' objects need an 'ip'");
    const auto address = parse_ipv4(**ip);
    if (!address) return std::unexpected(address.error());
    HostSpec host{.address = *address};
    if (const auto it = target.find("ports"); it != target.end() && !it->is_null()) {
        auto ports = parse_ports(*it, "ports");
        if (!ports) return std::unexpected(ports.error());
        host.ports = std::move(*ports);
    }
    if (const auto it = target.find("domains"); it != target.end() && !it->is_null()) {
        if (!it->is_array() || it->size() > 128)
            return invalid("'domains' must be an array of at most 128 names");
        for (const Json& domain : *it) {
            if (!domain.is_string() || domain.get_ref<const std::string&>().empty() ||
                domain.get_ref<const std::string&>().size() > 253)
                return invalid(std::format("invalid domain: {}", domain.dump()));
            host.domains.push_back(domain.get<std::string>());
        }
    }
    return host;
}

// The single aligned CIDR covering exactly these ranges, or "" (as masscan-worker reports it).
std::string single_subnet(const std::vector<Ipv4Range>& ranges) {
    if (ranges.size() != 1) return {};
    const Ipv4Range& range = ranges.front();
    const std::uint64_t size = range.size();
    if ((size & (size - 1)) != 0 || (range.first & (size - 1)) != 0) return {};
    int prefix = 32;
    for (std::uint64_t block = 1; block < size; block <<= 1U) --prefix;
    return format_subnet(range.first, prefix);
}

// Job limits may lower the worker's configured maxima but never raise them.
std::expected<ScanLimits, Error> parse_limits(const Json& json, const ScanLimits& maximum) {
    constexpr std::uint64_t kHuge = std::uint64_t{1} << 40;
    ScanLimits limits = maximum;
    const auto max_parallel = optional_positive(json, "max_parallel", kHuge);
    if (!max_parallel) return std::unexpected(max_parallel.error());
    if (*max_parallel)
        limits.max_parallel = std::min(static_cast<std::size_t>(**max_parallel),
                                       maximum.max_parallel);
    const auto rate = optional_positive(json, "max_rate_per_process", kHuge);
    if (!rate) return std::unexpected(rate.error());
    if (*rate)
        limits.max_rate_per_process = static_cast<std::uint32_t>(
            std::min<std::uint64_t>(**rate, maximum.max_rate_per_process));
    const auto host_timeout = optional_positive(json, "host_timeout_ms", kHuge);
    if (!host_timeout) return std::unexpected(host_timeout.error());
    if (*host_timeout)
        limits.host_timeout = std::chrono::milliseconds{std::min<std::int64_t>(
            static_cast<std::int64_t>(**host_timeout), maximum.host_timeout.count())};
    const auto http_timeout = optional_positive(json, "http_timeout_ms", kHuge);
    if (!http_timeout) return std::unexpected(http_timeout.error());
    if (*http_timeout)
        limits.http_timeout = std::chrono::milliseconds{std::min<std::int64_t>(
            static_cast<std::int64_t>(**http_timeout), maximum.http_timeout.count())};
    const auto body = optional_positive(json, "max_body_bytes", kHuge);
    if (!body) return std::unexpected(body.error());
    if (*body)
        limits.max_body_bytes = std::min(static_cast<std::size_t>(**body), maximum.max_body_bytes);
    const auto redirects = optional_uint(json, "max_redirects", kHuge);
    if (!redirects) return std::unexpected(redirects.error());
    if (*redirects)
        limits.max_redirects =
            std::min(static_cast<std::size_t>(**redirects), maximum.max_redirects);
    return limits;
}

std::expected<std::vector<std::string>, Error> parse_probe_paths(const Json& json) {
    std::vector<std::string> paths;
    const auto it = json.find("probe_paths");
    if (it == json.end() || it->is_null()) return paths;
    if (!it->is_array() || it->size() > 128)
        return invalid("'probe_paths' must be an array of at most 128 paths");
    for (const Json& path : *it) {
        if (!path.is_string()) return invalid("'probe_paths' must be strings");
        const auto& value = path.get_ref<const std::string&>();
        if (value.empty() || value.size() > 2048 || value[0] != '/' || value.starts_with("//"))
            return invalid(std::format("invalid probe path: '{}'", value));
        paths.push_back(value);
    }
    return paths;
}

OrderedJson nullable(const std::optional<std::string>& value) {
    return value && !value->empty() ? OrderedJson(*value) : OrderedJson(nullptr);
}

OrderedJson nullable(const std::string& value) {
    return value.empty() ? OrderedJson(nullptr) : OrderedJson(value);
}

OrderedJson error_json(const Error& error) {
    return OrderedJson{{"code", error.code}, {"message", error.message}};
}

std::string iso8601(std::chrono::system_clock::time_point time) {
    return std::format("{:%FT%TZ}", std::chrono::floor<std::chrono::milliseconds>(time));
}

OrderedJson params_json(const JobResult& result) {
    return OrderedJson{{"subnet", nullable(result.subnet)},
                       {"ports", nullable(result.ports)},
                       {"maxParallel", result.limits.max_parallel},
                       {"maxRatePerProcess", result.limits.max_rate_per_process},
                       {"hostTimeoutMs", result.limits.host_timeout.count()},
                       {"httpTimeoutMs", result.limits.http_timeout.count()},
                       {"maxBodyBytes", result.limits.max_body_bytes},
                       {"maxRedirects", result.limits.max_redirects},
                       {"nmapArgs", result.nmap_args}};
}

OrderedJson host_json(const HostResult& host) {
    OrderedJson names = OrderedJson::array();
    for (const auto& domain : host.domains)
        names.push_back(OrderedJson{{"name", domain}, {"source", "job"}});
    for (const auto& name : host.ptr_names)
        names.push_back(OrderedJson{{"name", name}, {"source", "ptr"}});

    OrderedJson ports = OrderedJson::array();
    for (const auto& port : host.ports) {
        OrderedJson service = nullptr;
        if (port.service) {
            service = OrderedJson{{"name", port.service->name},
                                  {"product", nullable(port.service->product)},
                                  {"version", nullable(port.service->version)},
                                  {"extraInfo", nullable(port.service->extra_info)},
                                  {"cpe", port.service->cpe},
                                  {"method", port.service->method},
                                  {"confidence", port.service->confidence}};
        }
        OrderedJson scripts = OrderedJson::array();
        for (const auto& script : port.scripts)
            scripts.push_back(OrderedJson{{"id", script.id}, {"output", script.output}});
        ports.push_back(OrderedJson{
            {"port", port.number},
            {"protocol", port.protocol},
            {"state", port.state},
            {"reason", nullable(port.reason)},
            {"service", std::move(service)},
            {"identity",
             OrderedJson{{"ttl", port.ttl ? OrderedJson(*port.ttl) : OrderedJson(nullptr)},
                         {"sshHostKeySha256", nullptr},
                         {"tlsCertSha256", nullptr}}},
            {"banner", nullptr},
            {"scripts", std::move(scripts)},
            {"http", OrderedJson::array()}});
    }
    return OrderedJson{
        {"ip", host.ip},
        {"status", host.status},
        {"reason", nullable(host.reason)},
        {"observedAt",
         host.observed_at ? OrderedJson(iso8601(*host.observed_at)) : OrderedJson(nullptr)},
        {"latencyMs", host.latency_ms ? OrderedJson(*host.latency_ms) : OrderedJson(nullptr)},
        {"hostnames", std::move(names)},
        {"error", host.error ? error_json(*host.error) : OrderedJson(nullptr)},
        {"ports", std::move(ports)}};
}

OrderedJson scan_json(const JobResult& result, OrderedJson params, OrderedJson counts) {
    return OrderedJson{
        {"jobId", nullable(result.job_id)},
        {"leaseId", nullable(result.lease_id)},
        {"scanId", nullable(result.scan_id)},
        {"worker", OrderedJson{{"id", "nmap-worker"},
                               {"version", NMAP_WORKER_VERSION},
                               {"nmapVersion", nullable(result.nmap_version)}}},
        {"status", result.status},
        {"stopReason", nullable(result.stop_reason)},
        {"startedAt", iso8601(result.started_at)},
        {"finishedAt", iso8601(result.finished_at)},
        {"durationMs", result.duration.count()},
        {"phasesMs", OrderedJson{{"hostDiscovery", 0},
                                 {"portScan", result.duration.count()},
                                 {"serviceDetection", 0},
                                 {"http", 0}}},
        {"params", std::move(params)},
        {"counts", std::move(counts)},
        {"error", result.error ? error_json(*result.error) : OrderedJson(nullptr)}};
}

}  // namespace

std::expected<ScanJob, Error> parse_scan_job(std::string_view input,
                                             const ScanLimits& maximum_limits) {
    const Json json = Json::parse(input, nullptr, /*allow_exceptions=*/false);
    if (json.is_discarded()) return invalid("input is not valid JSON");
    if (!json.is_object()) return invalid("input must be a JSON object");

    ScanJob job{};
    const auto job_id = optional_string(json, "job_id");
    if (!job_id) return std::unexpected(job_id.error());
    job.job_id = job_id->value_or("");
    const auto scan_id = optional_string(json, "scan_id");
    if (!scan_id) return std::unexpected(scan_id.error());
    job.scan_id = scan_id->value_or("");
    const auto lease_id = optional_string(json, "lease_id");
    if (!lease_id) return std::unexpected(lease_id.error());
    job.lease_id = lease_id->value_or("");

    std::vector<PortRange> job_ports{*parse_port_range(kDefaultPorts)};
    if (const auto it = json.find("ports"); it != json.end() && !it->is_null()) {
        auto ports = parse_ports(*it, "ports");
        if (!ports) return std::unexpected(ports.error());
        job_ports = std::move(*ports);
    }

    // `targets`: address specs as in masscan-worker, plus host objects.
    const auto targets_it = json.find("targets");
    if (targets_it == json.end() || targets_it->is_null()) return invalid("'targets' is required");
    std::vector<std::string> range_specs;
    std::vector<HostSpec> hosts;
    if (targets_it->is_string()) {
        add_split(targets_it->get_ref<const std::string&>(), range_specs);
    } else if (targets_it->is_array()) {
        for (const Json& target : *targets_it) {
            if (target.is_string()) {
                add_split(target.get_ref<const std::string&>(), range_specs);
            } else if (target.is_object()) {
                auto host = parse_host(target);
                if (!host) return std::unexpected(host.error());
                hosts.push_back(std::move(*host));
            } else {
                return invalid(
                    std::format("'targets' contains an invalid item: {}", target.dump()));
            }
        }
    } else {
        return invalid("'targets' must be a string or an array");
    }
    if (range_specs.empty() && hosts.empty()) return invalid("'targets' must not be empty");

    std::vector<std::string> exclude_specs;
    if (const auto it = json.find("exclude"); it != json.end() && !it->is_null()) {
        auto specs = string_list(*it, "exclude", false);
        if (!specs) return std::unexpected(specs.error());
        exclude_specs = std::move(*specs);
    }
    const auto ranges = parse_ranges(range_specs);
    if (!ranges) return std::unexpected(ranges.error());
    const auto excludes = parse_ranges(exclude_specs);
    if (!excludes) return std::unexpected(excludes.error());
    const auto included = subtract_ranges(*ranges, *excludes);
    if (count_addresses(included) > kMaxAddresses) {
        return invalid(std::format("{} addresses exceed the limit of {}",
                                   count_addresses(included), kMaxAddresses));
    }

    // An address listed twice (or as an object inside a range) gets the union of its ports and
    // domains.
    std::map<std::uint32_t, Target> by_address;
    for (const Ipv4Range& range : included) {
        for (std::uint64_t address = range.first; address <= range.last; ++address) {
            const auto ip = static_cast<std::uint32_t>(address);
            by_address[ip] = Target{.ip = format_ipv4(ip), .ports = job_ports};
        }
    }
    for (HostSpec& host : hosts) {
        if (std::ranges::any_of(*excludes, [&](const Ipv4Range& range) {
                return range.first <= host.address && host.address <= range.last;
            }))
            continue;
        const auto& ports = host.ports ? *host.ports : job_ports;
        auto [it, is_new] = by_address.try_emplace(host.address);
        Target& target = it->second;
        if (is_new) target.ip = format_ipv4(host.address);
        target.ports.insert(target.ports.end(), ports.begin(), ports.end());
        target.ports = merge_ranges(std::move(target.ports));
        target.domains.insert(target.domains.end(), host.domains.begin(), host.domains.end());
    }
    if (by_address.empty()) return invalid("no addresses left to scan after applying 'exclude'");
    if (by_address.size() > kMaxAddresses) {
        return invalid(std::format("{} addresses exceed the limit of {}", by_address.size(),
                                   kMaxAddresses));
    }
    std::vector<Ipv4Range> address_ranges;
    for (auto& [address, target] : by_address) {
        std::ranges::sort(target.domains);
        const auto [last, end] = std::ranges::unique(target.domains);
        target.domains.erase(last, end);
        address_ranges.push_back({address, address});
        job.targets.push_back(std::move(target));
    }
    job.subnet = single_subnet(merge_ranges(std::move(address_ranges)));

    const auto rate = optional_positive(json, "rate", 100'000'000);
    if (!rate) return std::unexpected(rate.error());
    if (*rate) job.rate = static_cast<std::uint32_t>(**rate);

    // Unlike masscan-worker, nmap-worker requires a time window.
    const auto max_duration = optional_positive(json, "max_duration_seconds", kMaxDurationSeconds);
    if (!max_duration) return std::unexpected(max_duration.error());
    if (!*max_duration) return invalid("'max_duration_seconds' is required");
    job.deadline = std::chrono::system_clock::now() + std::chrono::seconds{**max_duration};

    auto limits = parse_limits(json, maximum_limits);
    if (!limits) return std::unexpected(limits.error());
    job.limits = *limits;
    auto probe_paths = parse_probe_paths(json);
    if (!probe_paths) return std::unexpected(probe_paths.error());
    job.probe_paths = std::move(*probe_paths);
    return job;
}

std::string serialize_job_result(const JobResult& result, bool is_pretty) {
    OrderedJson hosts = OrderedJson::array();
    std::map<std::string, std::size_t, std::less<>> by_status;
    std::size_t open_ports = 0;
    for (const auto& host : result.hosts) {
        ++by_status[host.status];
        open_ports += host.ports.size();
        hosts.push_back(host_json(host));
    }
    const auto count = [&](std::string_view status) -> std::size_t {
        const auto it = by_status.find(status);
        return it == by_status.end() ? 0 : it->second;
    };
    OrderedJson counts{{"addresses", result.hosts.size()},
                       {"up", count("up")},
                       {"down", count("down")},
                       {"timeout", count("timeout")},
                       {"cancelled", count("cancelled")},
                       {"failed", count("failed")},
                       {"openPorts", open_ports},
                       {"httpEndpoints", 0},
                       {"httpRequests", 0}};
    const OrderedJson document{{"scan", scan_json(result, params_json(result), std::move(counts))},
                               {"hosts", std::move(hosts)}};
    return document.dump(is_pretty ? 2 : -1, ' ', false, OrderedJson::error_handler_t::replace);
}

std::string serialize_error(const Error& error) { return error_json(error).dump(); }

// Same document as masscan-worker for a job that could not be read: nothing about it is known.
std::string serialize_failed_job(std::string_view input, const Error& error, bool is_pretty) {
    const auto started = std::chrono::system_clock::now();
    JobResult result;
    result.status = "failed";
    result.stop_reason = "error";
    result.error = error;
    result.started_at = started;
    result.finished_at = started;
    const auto json = Json::parse(input, nullptr, false);
    if (json.is_object()) {
        const auto field = [&](const char* key) -> std::string {
            return json.contains(key) && json.at(key).is_string() ? json.at(key).get<std::string>()
                                                                  : "";
        };
        result.job_id = field("job_id");
        result.lease_id = field("lease_id");
        result.scan_id = field("scan_id");
    }
    const OrderedJson params{{"subnet", nullptr},          {"ports", nullptr},
                             {"maxParallel", nullptr},     {"maxRatePerProcess", nullptr},
                             {"hostTimeoutMs", nullptr},   {"httpTimeoutMs", nullptr},
                             {"maxBodyBytes", nullptr},    {"maxRedirects", nullptr},
                             {"nmapArgs", OrderedJson::array()}};
    const OrderedJson counts{{"addresses", nullptr}, {"up", 0},        {"down", nullptr},
                             {"timeout", 0},         {"cancelled", nullptr}, {"failed", 0},
                             {"openPorts", 0},       {"httpEndpoints", 0},   {"httpRequests", 0}};
    const OrderedJson document{{"scan", scan_json(result, params, counts)},
                               {"hosts", OrderedJson::array()}};
    return document.dump(is_pretty ? 2 : -1, ' ', false, OrderedJson::error_handler_t::replace);
}

}  // namespace nmap_worker
