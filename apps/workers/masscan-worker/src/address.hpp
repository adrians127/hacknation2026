#pragma once

#include <cstdint>
#include <expected>
#include <span>
#include <string>
#include <string_view>
#include <vector>

#include "error.hpp"

namespace masscan_worker {

struct Ipv4Range {
    std::uint32_t first;
    std::uint32_t last;

    [[nodiscard]] constexpr std::uint64_t size() const noexcept {
        return std::uint64_t{last} - first + 1;
    }
    friend constexpr bool operator==(const Ipv4Range&, const Ipv4Range&) = default;
};

struct PortRange {
    std::uint16_t first;
    std::uint16_t last;

    [[nodiscard]] constexpr std::uint32_t size() const noexcept {
        return std::uint32_t{last} - first + 1;
    }
    friend constexpr bool operator==(const PortRange&, const PortRange&) = default;
};

[[nodiscard]] std::expected<std::uint32_t, Error> parse_ipv4(std::string_view text);
[[nodiscard]] std::string format_ipv4(std::uint32_t address);

// Accepts "10.0.0.1", "10.0.0.0/24" and "10.0.0.1-10.0.0.50".
[[nodiscard]] std::expected<Ipv4Range, Error> parse_ipv4_range(std::string_view text);
// "a" for a single address, "a-b" otherwise; the form masscan reads from -iL.
[[nodiscard]] std::string format_ipv4_range(const Ipv4Range& range);
[[nodiscard]] std::string format_subnet(std::uint32_t address, int prefix);

// Accepts "443" and "8000-8100"; port 0 is rejected.
[[nodiscard]] std::expected<PortRange, Error> parse_port_range(std::string_view text);
// Comma list for masscan -p, e.g. "22,80,8000-8100".
[[nodiscard]] std::string format_port_ranges(std::span<const PortRange> ranges);

// Sorted, with overlapping and adjacent ranges merged.
[[nodiscard]] std::vector<Ipv4Range> merge_ranges(std::vector<Ipv4Range> ranges);
[[nodiscard]] std::vector<PortRange> merge_ranges(std::vector<PortRange> ranges);
// Both inputs must already be merged.
[[nodiscard]] std::vector<Ipv4Range> subtract_ranges(std::span<const Ipv4Range> include,
                                                     std::span<const Ipv4Range> exclude);

[[nodiscard]] std::uint64_t count_addresses(std::span<const Ipv4Range> ranges);
[[nodiscard]] std::uint64_t count_ports(std::span<const PortRange> ranges);

}  // namespace masscan_worker
