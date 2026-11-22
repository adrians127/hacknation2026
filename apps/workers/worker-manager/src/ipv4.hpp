#pragma once

#include <cstdint>
#include <expected>
#include <nlohmann/json.hpp>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace worker_manager {

struct Ipv4Range {
    std::uint32_t first;
    std::uint32_t last;  // inclusive

    friend bool operator==(const Ipv4Range&, const Ipv4Range&) = default;
};

[[nodiscard]] std::optional<std::uint32_t> parse_ipv4(std::string_view text);
[[nodiscard]] std::string format_ipv4(std::uint32_t address);

// "10.0.0.1", "10.0.0.0/16" or "10.0.0.1-10.0.0.50".
[[nodiscard]] std::optional<Ipv4Range> parse_ipv4_spec(std::string_view text);

// An array of specs, or one comma-separated string (the masscan-worker `targets` format).
// null yields no ranges. The result is sorted and merged.
[[nodiscard]] std::expected<std::vector<Ipv4Range>, std::string> parse_ipv4_specs(
    const nlohmann::ordered_json& specs);

[[nodiscard]] std::vector<Ipv4Range> merge_ranges(std::vector<Ipv4Range> ranges);

// Both inputs sorted and merged.
[[nodiscard]] std::vector<Ipv4Range> subtract_ranges(const std::vector<Ipv4Range>& ranges,
                                                     const std::vector<Ipv4Range>& excludes);

[[nodiscard]] std::uint64_t count_addresses(const std::vector<Ipv4Range>& ranges);

// `parts` contiguous groups whose address counts differ by at most one.
// Requires 1 <= parts <= count_addresses(ranges).
[[nodiscard]] std::vector<std::vector<Ipv4Range>> split_ranges(const std::vector<Ipv4Range>& ranges,
                                                               std::size_t parts);

// "a.b.c.d" for one address, CIDR when the range is exactly one block, "first-last" otherwise.
[[nodiscard]] std::string format_ipv4_range(const Ipv4Range& range);

}  // namespace worker_manager
