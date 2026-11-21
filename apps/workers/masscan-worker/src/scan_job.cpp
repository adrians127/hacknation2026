#include "scan_job.hpp"

#include <algorithm>
#include <format>
#include <nlohmann/json.hpp>
#include <random>
#include <string_view>

namespace masscan_worker {

namespace {

using nlohmann::json;

// JSON consumers in JS lose precision above 2^53, and seed/resume_index must round-trip.
constexpr std::uint64_t kMaxSafeInteger = (std::uint64_t{1} << 53) - 1;
constexpr std::string_view kDefaultPorts = "1-65535";

std::unexpected<Error> invalid(std::string message) {
    return std::unexpected(Error{ErrorCode::kInvalidInput, std::move(message)});
}

std::expected<std::optional<std::uint64_t>, Error> optional_uint(const json& input,
                                                                 std::string_view key,
                                                                 std::uint64_t max) {
    const auto it = input.find(key);
    if (it == input.end() || it->is_null()) {
        return std::nullopt;
    }
    if (!it->is_number_unsigned() || it->get<std::uint64_t>() > max) {
        return invalid(std::format("'{}' must be an integer between 0 and {}", key, max));
    }
    return it->get<std::uint64_t>();
}

std::expected<std::optional<std::string>, Error> optional_string(const json& input,
                                                                 std::string_view key) {
    const auto it = input.find(key);
    if (it == input.end() || it->is_null()) {
        return std::nullopt;
    }
    if (!it->is_string()) {
        return invalid(std::format("'{}' must be a string", key));
    }
    return it->get<std::string>();
}

// Accepts a single string ("a, b") or an array of strings; array items may also be numbers
// when `allow_numbers` is set (ports).
std::expected<std::vector<std::string>, Error> string_list(const json& value, std::string_view key,
                                                           bool allow_numbers) {
    std::vector<std::string> items;
    const auto add_split = [&items](std::string_view text) {
        while (!text.empty()) {
            const std::size_t comma = text.find(',');
            std::string_view item = text.substr(0, comma);
            while (!item.empty() && item.front() == ' ') item.remove_prefix(1);
            while (!item.empty() && item.back() == ' ') item.remove_suffix(1);
            if (!item.empty()) {
                items.emplace_back(item);
            }
            text = comma == std::string_view::npos ? std::string_view{} : text.substr(comma + 1);
        }
    };
    if (value.is_string()) {
        add_split(value.get_ref<const std::string&>());
        return items;
    }
    if (!value.is_array()) {
        return invalid(std::format("'{}' must be a string or an array", key));
    }
    for (const json& item : value) {
        if (item.is_string()) {
            add_split(item.get_ref<const std::string&>());
        } else if (allow_numbers && item.is_number_unsigned()) {
            items.push_back(std::to_string(item.get<std::uint64_t>()));
        } else {
            return invalid(std::format("'{}' contains an invalid item: {}", key, item.dump()));
        }
    }
    return items;
}

std::expected<std::vector<Ipv4Range>, Error> parse_ranges(const std::vector<std::string>& specs) {
    std::vector<Ipv4Range> ranges;
    ranges.reserve(specs.size());
    for (const std::string& spec : specs) {
        auto range = parse_ipv4_range(spec);
        if (!range) {
            return std::unexpected(range.error());
        }
        ranges.push_back(*range);
    }
    return merge_ranges(std::move(ranges));
}

// The values go straight into masscan's argv; a leading '-' would be read as an option.
bool is_interface_name(std::string_view name) {
    return !name.empty() && name.size() <= 15 && name.front() != '-' &&
           std::ranges::all_of(name, [](char c) {
               return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
                      c == '.' || c == '_' || c == '-' || c == ':';
           });
}

bool is_mac_address(std::string_view mac) {
    if (mac.size() != 17) {
        return false;
    }
    for (std::size_t i = 0; i < mac.size(); ++i) {
        const char c = mac[i];
        const bool is_hex =
            (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
        if (i % 3 == 2 ? (c != ':' && c != '-') : !is_hex) {
            return false;
        }
    }
    return true;
}

std::uint64_t random_seed() {
    std::random_device device;
    const std::uint64_t value = (std::uint64_t{device()} << 32) | device();
    return value & kMaxSafeInteger;
}

}  // namespace

std::expected<ScanJob, Error> parse_scan_job(const json& input, const Config& config,
                                             std::vector<std::string>& warnings) {
    if (!input.is_object()) {
        return invalid("input must be a JSON object");
    }

    ScanJob job{};

    const auto job_id = optional_string(input, "job_id");
    if (!job_id) return std::unexpected(job_id.error());
    job.job_id = job_id->value_or("");

    const auto targets_it = input.find("targets");
    if (targets_it == input.end()) {
        return invalid("'targets' is required");
    }
    auto target_specs = string_list(*targets_it, "targets", false);
    if (!target_specs) return std::unexpected(target_specs.error());
    if (target_specs->empty()) {
        return invalid("'targets' must not be empty");
    }
    job.target_specs = std::move(*target_specs);

    if (const auto it = input.find("exclude"); it != input.end() && !it->is_null()) {
        auto exclude_specs = string_list(*it, "exclude", false);
        if (!exclude_specs) return std::unexpected(exclude_specs.error());
        job.exclude_specs = std::move(*exclude_specs);
    }

    const auto targets = parse_ranges(job.target_specs);
    if (!targets) return std::unexpected(targets.error());
    const auto excludes = parse_ranges(job.exclude_specs);
    if (!excludes) return std::unexpected(excludes.error());
    job.ranges = subtract_ranges(*targets, *excludes);
    const std::uint64_t address_count = count_addresses(job.ranges);
    if (address_count == 0) {
        return invalid("no addresses left to scan after applying 'exclude'");
    }
    if (address_count > config.max_target_addresses) {
        return invalid(
            std::format("{} addresses exceed the limit of {} (MASSCAN_WORKER_MAX_TARGETS)",
                        address_count, config.max_target_addresses));
    }

    const auto ports_it = input.find("ports");
    std::vector<std::string> port_specs{std::string{kDefaultPorts}};
    if (ports_it != input.end() && !ports_it->is_null()) {
        auto parsed = string_list(*ports_it, "ports", true);
        if (!parsed) return std::unexpected(parsed.error());
        if (parsed->empty()) {
            return invalid("'ports' must not be empty");
        }
        port_specs = std::move(*parsed);
    }
    std::vector<PortRange> ports;
    for (const std::string& spec : port_specs) {
        const auto range = parse_port_range(spec);
        if (!range) return std::unexpected(range.error());
        ports.push_back(*range);
    }
    job.ports = merge_ranges(std::move(ports));

    const auto rate = optional_uint(input, "rate", 100'000'000);
    if (!rate) return std::unexpected(rate.error());
    job.rate = static_cast<std::uint32_t>(rate->value_or(config.default_rate));
    if (job.rate == 0) {
        return invalid("'rate' must be positive");
    }
    if (job.rate > config.max_rate) {
        warnings.push_back(std::format("rate {} clamped to MASSCAN_WORKER_MAX_RATE={}", job.rate,
                                       config.max_rate));
        job.rate = config.max_rate;
    }

    const auto wait = optional_uint(input, "wait_seconds", 60);
    if (!wait) return std::unexpected(wait.error());
    job.wait = std::chrono::seconds{wait->value_or(3)};

    const auto retries = optional_uint(input, "retries", 5);
    if (!retries) return std::unexpected(retries.error());
    job.retries = static_cast<std::uint32_t>(retries->value_or(0));

    const auto max_duration = optional_uint(input, "max_duration_seconds", 7 * 24 * 3600);
    if (!max_duration) return std::unexpected(max_duration.error());
    if (*max_duration) {
        if (**max_duration == 0) {
            return invalid("'max_duration_seconds' must be positive");
        }
        job.max_duration = std::chrono::seconds{**max_duration};
    }

    const auto group_prefix = optional_uint(input, "group_prefix", 32);
    if (!group_prefix) return std::unexpected(group_prefix.error());
    job.group_prefix = static_cast<int>(group_prefix->value_or(24));
    if (job.group_prefix < 8) {
        return invalid("'group_prefix' must be between 8 and 32");
    }

    if (const auto it = input.find("shard"); it != input.end() && !it->is_null()) {
        if (!it->is_object()) return invalid("'shard' must be an object {index, total}");
        const auto index = optional_uint(*it, "index", 65535);
        if (!index) return std::unexpected(index.error());
        const auto total = optional_uint(*it, "total", 65535);
        if (!total) return std::unexpected(total.error());
        if (!*index || !*total || **index == 0 || **index > **total) {
            return invalid("'shard' needs 1 <= index <= total");
        }
        job.shard = Shard{static_cast<std::uint32_t>(**index), static_cast<std::uint32_t>(**total)};
    }

    const auto seed = optional_uint(input, "seed", kMaxSafeInteger);
    if (!seed) return std::unexpected(seed.error());
    if (job.shard && !*seed) {
        return invalid("'seed' is required with 'shard': every shard must use the same seed");
    }
    job.seed = seed->value_or(random_seed());

    const auto resume_index = optional_uint(input, "resume_index", kMaxSafeInteger);
    if (!resume_index) return std::unexpected(resume_index.error());
    job.resume_index = resume_index->value_or(0);
    if (job.resume_index > 0 && !*seed) {
        return invalid("'resume_index' requires the 'seed' of the interrupted scan");
    }

    const auto adapter = optional_string(input, "adapter");
    if (!adapter) return std::unexpected(adapter.error());
    if (*adapter && !is_interface_name(**adapter)) {
        return invalid(std::format("invalid 'adapter': '{}'", **adapter));
    }
    job.adapter = *adapter;

    const auto adapter_ip = optional_string(input, "adapter_ip");
    if (!adapter_ip) return std::unexpected(adapter_ip.error());
    if (*adapter_ip && !parse_ipv4(**adapter_ip)) {
        return invalid(std::format("invalid 'adapter_ip': '{}'", **adapter_ip));
    }
    job.adapter_ip = *adapter_ip;

    const auto router_mac = optional_string(input, "router_mac");
    if (!router_mac) return std::unexpected(router_mac.error());
    if (*router_mac && !is_mac_address(**router_mac)) {
        return invalid(std::format("invalid 'router_mac': '{}'", **router_mac));
    }
    job.router_mac = *router_mac;

    return job;
}

}  // namespace masscan_worker
