#pragma once

#include <chrono>
#include <cstdint>
#include <expected>
#include <nlohmann/json_fwd.hpp>
#include <optional>
#include <string>
#include <vector>

#include "address.hpp"
#include "config.hpp"
#include "error.hpp"

namespace masscan_worker {

struct Shard {
    std::uint32_t index;  // 1-based, as masscan --shards expects
    std::uint32_t total;
};

struct ScanJob {
    std::string job_id;
    std::vector<std::string> target_specs;  // as received, echoed back in the result
    std::vector<std::string> exclude_specs;
    std::vector<Ipv4Range> ranges;  // targets minus excludes, merged
    std::vector<PortRange> ports;
    std::uint32_t rate;
    std::chrono::seconds wait;
    std::uint32_t retries;
    std::optional<std::chrono::seconds> max_duration;
    int group_prefix;
    std::optional<Shard> shard;
    std::uint64_t seed;
    std::uint64_t resume_index;
    std::optional<std::string> adapter;
    std::optional<std::string> adapter_ip;
    std::optional<std::string> router_mac;
};

// Non-fatal adjustments (e.g. a clamped rate) are appended to `warnings`.
[[nodiscard]] std::expected<ScanJob, Error> parse_scan_job(const nlohmann::json& input,
                                                           const Config& config,
                                                           std::vector<std::string>& warnings);

}  // namespace masscan_worker
