#include "job.hpp"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <charconv>
#include <format>
#include <map>
#include <optional>
#include <set>

namespace httpx_worker {
namespace {
using Json = nlohmann::json;

std::unexpected<Error> invalid(std::string message) {
    return std::unexpected(Error{"invalid-input", std::move(message)});
}

std::expected<std::optional<std::string>, Error> optional_string(const Json& object,
                                                                  const char* key) {
    auto it = object.find(key);
    if (it == object.end() || it->is_null()) return std::nullopt;
    if (!it->is_string()) return invalid(std::format("'{}' must be a string", key));
    return it->get<std::string>();
}

std::expected<std::optional<std::uint32_t>, Error> optional_number(const Json& object,
                                                                     const char* key,
                                                                     std::uint32_t maximum,
                                                                     bool allow_zero = false) {
    auto it = object.find(key);
    if (it == object.end() || it->is_null()) return std::nullopt;
    if (!it->is_number_unsigned() || it->get<std::uint64_t>() > maximum ||
        (!allow_zero && it->get<std::uint64_t>() == 0)) {
        return invalid(std::format("'{}' must be an integer in {}..{}", key,
                                   allow_zero ? 0 : 1, maximum));
    }
    return static_cast<std::uint32_t>(it->get<std::uint64_t>());
}

void append_csv(std::string_view text, std::vector<std::string>& out) {
    while (!text.empty()) {
        auto comma = text.find(',');
        auto part = text.substr(0, comma);
        while (!part.empty() && part.front() == ' ') part.remove_prefix(1);
        while (!part.empty() && part.back() == ' ') part.remove_suffix(1);
        if (!part.empty()) out.emplace_back(part);
        text = comma == std::string_view::npos ? std::string_view{} : text.substr(comma + 1);
    }
}

std::expected<std::vector<std::string>, Error> string_list(const Json& input,
                                                            std::string_view key,
                                                            bool numbers = false) {
    std::vector<std::string> items;
    if (input.is_string()) append_csv(input.get_ref<const std::string&>(), items);
    else if (input.is_array()) {
        for (const auto& item : input) {
            if (item.is_string()) append_csv(item.get_ref<const std::string&>(), items);
            else if (numbers && item.is_number_unsigned())
                items.push_back(std::to_string(item.get<std::uint64_t>()));
            else return invalid(std::format("'{}' contains an invalid item", key));
        }
    } else return invalid(std::format("'{}' must be a string or an array", key));
    return items;
}

std::expected<std::vector<PortRange>, Error> parse_ports(const Json& value) {
    auto list = string_list(value, "ports", true);
    if (!list) return std::unexpected(list.error());
    if (list->empty()) return invalid("'ports' must not be empty");
    std::vector<PortRange> ranges;
    for (const auto& text : *list) {
        auto range = parse_port_range(text);
        if (!range) return std::unexpected(range.error());
        ranges.push_back(*range);
    }
    return merge_ranges(std::move(ranges));
}

std::expected<std::vector<Ipv4Range>, Error> parse_ranges(const std::vector<std::string>& specs) {
    std::vector<Ipv4Range> ranges;
    for (const auto& text : specs) {
        auto range = parse_ipv4_range(text);
        if (!range) return std::unexpected(range.error());
        ranges.push_back(*range);
    }
    return merge_ranges(std::move(ranges));
}

bool domain_valid(std::string_view domain) {
    if (domain.empty() || domain.size() > 253 || domain.front() == '.' || domain.back() == '.')
        return false;
    for (char ch : domain) {
        if (!((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
              (ch >= '0' && ch <= '9') || ch == '-' || ch == '.')) return false;
    }
    return domain.find("..") == std::string_view::npos;
}

std::string subnet_of(const std::map<std::uint32_t, Target>& targets) {
    if (targets.empty()) return {};
    const std::uint64_t first = targets.begin()->first;
    const std::uint64_t last = targets.rbegin()->first;
    const std::uint64_t size = last - first + 1;
    if (size != targets.size() || (size & (size - 1)) != 0 || (first & (size - 1)) != 0)
        return {};
    int prefix = 32;
    for (std::uint64_t block = 1; block < size; block <<= 1) --prefix;
    return format_subnet(static_cast<std::uint32_t>(first), prefix);
}

} // namespace

std::expected<Job, Error> parse_job(std::string_view input) {
    const Json data = Json::parse(input, nullptr, false);
    if (!data.is_object()) return invalid("input must be a JSON object");
    Job job;
    for (const auto* key : {"job_id", "scan_id", "lease_id"}) {
        auto value = optional_string(data, key);
        if (!value) return std::unexpected(value.error());
        if (std::string_view{key} == "job_id") job.job_id = value->value_or("");
        if (std::string_view{key} == "scan_id") job.scan_id = value->value_or("");
        if (std::string_view{key} == "lease_id") job.lease_id = value->value_or("");
    }
    auto duration = optional_number(data, "max_duration_seconds", 604800);
    if (!duration) return std::unexpected(duration.error());
    if (!*duration) return invalid("'max_duration_seconds' is required");
    job.deadline = std::chrono::steady_clock::now() + std::chrono::seconds{**duration};

    std::vector<PortRange> defaults{{1, 65535}};
    if (auto it = data.find("ports"); it != data.end() && !it->is_null()) {
        auto parsed = parse_ports(*it);
        if (!parsed) return std::unexpected(parsed.error());
        defaults = std::move(*parsed);
    }

    auto targets = data.find("targets");
    if (targets == data.end() || targets->is_null()) return invalid("'targets' is required");
    std::vector<std::string> range_specs;
    std::map<std::uint32_t, Target> by_ip;
    if (targets->is_string()) append_csv(targets->get_ref<const std::string&>(), range_specs);
    else if (targets->is_array()) {
        for (const auto& item : *targets) {
            if (item.is_string()) {
                append_csv(item.get_ref<const std::string&>(), range_specs);
                continue;
            }
            if (!item.is_object()) return invalid("'targets' entries must be strings or host objects");
            auto ip = optional_string(item, "ip");
            if (!ip) return std::unexpected(ip.error());
            if (!*ip) return invalid("'targets' objects need an 'ip'");
            auto address = parse_ipv4(**ip);
            if (!address) return std::unexpected(address.error());
            std::vector<PortRange> ports = defaults;
            if (auto it = item.find("ports"); it != item.end() && !it->is_null()) {
                auto parsed = parse_ports(*it);
                if (!parsed) return std::unexpected(parsed.error());
                ports = std::move(*parsed);
            }
            auto& target = by_ip[*address];
            target.ip = format_ipv4(*address);
            target.known_open = true;
            target.ports.insert(target.ports.end(), ports.begin(), ports.end());
            auto domains = item.find("domains");
            if (domains != item.end() && !domains->is_null()) {
                if (!domains->is_array() || domains->size() > 128)
                    return invalid("'domains' must be an array of at most 128 names");
                for (const auto& domain : *domains) {
                    if (!domain.is_string() || !domain_valid(domain.get_ref<const std::string&>()))
                        return invalid("invalid domain in 'targets'");
                    target.domains.push_back(domain.get<std::string>());
                }
            }
            auto legacy = optional_string(item, "domain");
            if (!legacy) return std::unexpected(legacy.error());
            if (*legacy) {
                if (!domain_valid(**legacy)) return invalid("invalid domain in 'targets'");
                target.domains.push_back(**legacy);
            }
        }
    } else return invalid("'targets' must be a string or an array");

    auto included = parse_ranges(range_specs);
    if (!included) return std::unexpected(included.error());
    std::vector<std::string> excluded_specs;
    if (auto it = data.find("exclude"); it != data.end() && !it->is_null()) {
        auto list = string_list(*it, "exclude");
        if (!list) return std::unexpected(list.error());
        excluded_specs = std::move(*list);
    }
    auto excluded = parse_ranges(excluded_specs);
    if (!excluded) return std::unexpected(excluded.error());
    auto remaining = subtract_ranges(*included, *excluded);
    if (count_addresses(remaining) > 1024) return invalid("more than 1024 addresses in job");
    for (const auto& range : remaining) {
        for (std::uint64_t ip = range.first; ip <= range.last; ++ip) {
            auto& target = by_ip[static_cast<std::uint32_t>(ip)];
            target.ip = format_ipv4(static_cast<std::uint32_t>(ip));
            target.ports.insert(target.ports.end(), defaults.begin(), defaults.end());
        }
    }
    for (auto it = by_ip.begin(); it != by_ip.end();) {
        if (std::ranges::any_of(*excluded, [&](auto range) {
            return range.first <= it->first && it->first <= range.last;
        })) it = by_ip.erase(it);
        else ++it;
    }
    if (by_ip.empty()) return invalid("no addresses left to scan after applying 'exclude'");
    if (by_ip.size() > 1024) return invalid("more than 1024 addresses in job");

    auto paths = data.find("probe_paths");
    if (paths != data.end() && !paths->is_null()) {
        if (!paths->is_array() || paths->size() > 128)
            return invalid("'probe_paths' must be an array of at most 128 paths");
        for (const auto& path : *paths) {
            if (!path.is_string()) return invalid("'probe_paths' must contain strings");
            const auto& text = path.get_ref<const std::string&>();
            if (text.empty() || text.size() > 2048 || text[0] != '/' || text.starts_with("//") ||
                text.find('#') != std::string::npos ||
                text.find('\n') != std::string::npos || text.find('\r') != std::string::npos)
                return invalid("invalid probe path");
            if (text != "/") job.probe_paths.push_back(text);
        }
    }
    std::ranges::sort(job.probe_paths);
    job.probe_paths.erase(std::unique(job.probe_paths.begin(), job.probe_paths.end()),
                          job.probe_paths.end());

    auto rate = optional_number(data, "rate", 1000000);
    if (!rate) return std::unexpected(rate.error());
    if (*rate) job.limits.rate = std::min(job.limits.rate, **rate);
    auto threads = optional_number(data, "max_parallel", 64);
    if (!threads) return std::unexpected(threads.error());
    if (*threads) job.limits.threads = std::min(job.limits.threads, **threads);
    auto timeout = optional_number(data, "http_timeout_ms", 3600000);
    if (!timeout) return std::unexpected(timeout.error());
    if (*timeout) {
        if (**timeout < 1000) return invalid("'http_timeout_ms' must be at least 1000 for httpx");
        job.limits.timeout_seconds = std::min(job.limits.timeout_seconds, **timeout / 1000);
    }
    auto body = optional_number(data, "max_body_bytes", 16777216);
    if (!body) return std::unexpected(body.error());
    if (*body) job.limits.max_body_bytes = std::min(job.limits.max_body_bytes, **body);
    auto redirects = optional_number(data, "max_redirects", 50, true);
    if (!redirects) return std::unexpected(redirects.error());
    if (*redirects) job.limits.max_redirects = std::min(job.limits.max_redirects, **redirects);

    std::vector<PortRange> all_ports;
    std::uint64_t attempts = 0;
    for (auto& [ip, target] : by_ip) {
        (void)ip;
        target.ports = merge_ranges(std::move(target.ports));
        std::ranges::sort(target.domains);
        target.domains.erase(std::unique(target.domains.begin(), target.domains.end()),
                             target.domains.end());
        all_ports.insert(all_ports.end(), target.ports.begin(), target.ports.end());
        attempts += count_ports(target.ports) * (target.domains.size() + 1) * 2 *
                    (job.probe_paths.size() + 1);
        job.targets.push_back(std::move(target));
    }
    if (attempts > 8192) return invalid("HTTP request plan exceeds 8192 requests; narrow ports or split the job");
    job.ports = format_port_ranges(merge_ranges(std::move(all_ports)));
    job.subnet = subnet_of(by_ip);
    return job;
}

} // namespace httpx_worker
