#include "address.hpp"

#include <algorithm>
#include <charconv>
#include <format>
#include <optional>
#include <system_error>

namespace masscan_worker {

namespace {

Error invalid(std::string_view what, std::string_view text) {
    return Error{ErrorCode::kInvalidInput, std::format("invalid {}: '{}'", what, text)};
}

std::optional<std::uint32_t> parse_decimal(std::string_view text, std::size_t max_digits) {
    if (text.empty() || text.size() > max_digits ||
        !std::ranges::all_of(text, [](char c) { return c >= '0' && c <= '9'; })) {
        return std::nullopt;
    }
    std::uint32_t value = 0;
    const auto [end, ec] = std::from_chars(text.data(), text.data() + text.size(), value);
    if (ec != std::errc{} || end != text.data() + text.size()) {
        return std::nullopt;
    }
    return value;
}

template <typename Range>
std::vector<Range> merge_sorted(std::vector<Range> ranges) {
    std::ranges::sort(ranges, {}, &Range::first);
    std::vector<Range> merged;
    merged.reserve(ranges.size());
    for (const Range& range : ranges) {
        // Widen before +1 so a range ending at the type's max value cannot wrap.
        if (!merged.empty() &&
            std::uint64_t{range.first} <= std::uint64_t{merged.back().last} + 1) {
            merged.back().last = std::max(merged.back().last, range.last);
        } else {
            merged.push_back(range);
        }
    }
    return merged;
}

}  // namespace

std::expected<std::uint32_t, Error> parse_ipv4(std::string_view text) {
    std::uint32_t address = 0;
    std::string_view rest = text;
    for (int octet_index = 0; octet_index < 4; ++octet_index) {
        const std::size_t dot = rest.find('.');
        const bool is_last = octet_index == 3;
        if (is_last != (dot == std::string_view::npos)) {
            return std::unexpected(invalid("IPv4 address", text));
        }
        const auto octet = parse_decimal(rest.substr(0, dot), 3);
        if (!octet || *octet > 255) {
            return std::unexpected(invalid("IPv4 address", text));
        }
        address = (address << 8) | *octet;
        rest = is_last ? std::string_view{} : rest.substr(dot + 1);
    }
    return address;
}

std::string format_ipv4(std::uint32_t address) {
    return std::format("{}.{}.{}.{}", address >> 24, (address >> 16) & 0xFFU,
                       (address >> 8) & 0xFFU, address & 0xFFU);
}

std::expected<Ipv4Range, Error> parse_ipv4_range(std::string_view text) {
    if (const std::size_t slash = text.find('/'); slash != std::string_view::npos) {
        const auto base = parse_ipv4(text.substr(0, slash));
        const auto prefix = parse_decimal(text.substr(slash + 1), 2);
        if (!base || !prefix || *prefix > 32) {
            return std::unexpected(invalid("CIDR", text));
        }
        const std::uint32_t mask = *prefix == 0 ? 0U : ~std::uint32_t{0} << (32U - *prefix);
        return Ipv4Range{*base & mask, (*base & mask) | ~mask};
    }
    if (const std::size_t dash = text.find('-'); dash != std::string_view::npos) {
        const auto first = parse_ipv4(text.substr(0, dash));
        const auto last = parse_ipv4(text.substr(dash + 1));
        if (!first || !last || *first > *last) {
            return std::unexpected(invalid("IPv4 range", text));
        }
        return Ipv4Range{*first, *last};
    }
    const auto address = parse_ipv4(text);
    if (!address) {
        return std::unexpected(address.error());
    }
    return Ipv4Range{*address, *address};
}

std::string format_ipv4_range(const Ipv4Range& range) {
    if (range.first == range.last) {
        return format_ipv4(range.first);
    }
    return std::format("{}-{}", format_ipv4(range.first), format_ipv4(range.last));
}

std::string format_subnet(std::uint32_t address, int prefix) {
    const std::uint32_t mask =
        prefix <= 0 ? 0U : ~std::uint32_t{0} << (32U - static_cast<std::uint32_t>(prefix));
    return std::format("{}/{}", format_ipv4(address & mask), prefix);
}

std::expected<PortRange, Error> parse_port_range(std::string_view text) {
    const std::size_t dash = text.find('-');
    const auto first = parse_decimal(text.substr(0, dash), 5);
    const auto last =
        dash == std::string_view::npos ? first : parse_decimal(text.substr(dash + 1), 5);
    if (!first || !last || *first == 0 || *last > 65535 || *first > *last) {
        return std::unexpected(invalid("port or port range", text));
    }
    return PortRange{static_cast<std::uint16_t>(*first), static_cast<std::uint16_t>(*last)};
}

std::string format_port_ranges(std::span<const PortRange> ranges) {
    std::string out;
    for (const PortRange& range : ranges) {
        if (!out.empty()) {
            out += ',';
        }
        out += range.first == range.last ? std::format("{}", range.first)
                                         : std::format("{}-{}", range.first, range.last);
    }
    return out;
}

std::vector<Ipv4Range> merge_ranges(std::vector<Ipv4Range> ranges) {
    return merge_sorted(std::move(ranges));
}

std::vector<PortRange> merge_ranges(std::vector<PortRange> ranges) {
    return merge_sorted(std::move(ranges));
}

std::vector<Ipv4Range> subtract_ranges(std::span<const Ipv4Range> include,
                                       std::span<const Ipv4Range> exclude) {
    std::vector<Ipv4Range> result;
    auto excluded = exclude.begin();
    for (const Ipv4Range& range : include) {
        std::uint64_t cursor = range.first;
        while (excluded != exclude.end() && excluded->last < range.first) {
            ++excluded;
        }
        for (auto it = excluded; it != exclude.end() && it->first <= range.last; ++it) {
            if (it->first > cursor) {
                result.push_back({static_cast<std::uint32_t>(cursor), it->first - 1});
            }
            cursor = std::max<std::uint64_t>(cursor, std::uint64_t{it->last} + 1);
        }
        if (cursor <= range.last) {
            result.push_back({static_cast<std::uint32_t>(cursor), range.last});
        }
    }
    return result;
}

std::uint64_t count_addresses(std::span<const Ipv4Range> ranges) {
    std::uint64_t total = 0;
    for (const Ipv4Range& range : ranges) {
        total += range.size();
    }
    return total;
}

std::uint64_t count_ports(std::span<const PortRange> ranges) {
    std::uint64_t total = 0;
    for (const PortRange& range : ranges) {
        total += range.size();
    }
    return total;
}

}  // namespace masscan_worker
