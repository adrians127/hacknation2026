#include "ipv4.hpp"

#include <algorithm>
#include <bit>
#include <charconv>
#include <format>
#include <system_error>

namespace worker_manager {

namespace {

std::string_view trim(std::string_view text) {
    while (!text.empty() && (text.front() == ' ' || text.front() == '\t')) text.remove_prefix(1);
    while (!text.empty() && (text.back() == ' ' || text.back() == '\t')) text.remove_suffix(1);
    return text;
}

std::expected<void, std::string> append_specs(std::string_view text,
                                              std::vector<Ipv4Range>& ranges) {
    while (true) {
        const auto comma = text.find(',');
        const std::string_view item = trim(text.substr(0, comma));
        if (!item.empty()) {
            const auto range = parse_ipv4_spec(item);
            if (!range) {
                return std::unexpected(
                    std::format("'{}' is not an IPv4 address, CIDR or range", item));
            }
            ranges.push_back(*range);
        }
        if (comma == std::string_view::npos) {
            return {};
        }
        text.remove_prefix(comma + 1);
    }
}

}  // namespace

std::optional<std::uint32_t> parse_ipv4(std::string_view text) {
    std::uint32_t address = 0;
    for (int octet = 0; octet < 4; ++octet) {
        if (octet > 0) {
            if (text.empty() || text.front() != '.') return std::nullopt;
            text.remove_prefix(1);
        }
        std::uint32_t part = 0;
        const auto [end, ec] = std::from_chars(text.data(), text.data() + text.size(), part);
        const auto digits = static_cast<std::size_t>(end - text.data());
        if (ec != std::errc{} || part > 255 || digits > 3) return std::nullopt;
        address = (address << 8U) | part;
        text.remove_prefix(digits);
    }
    if (!text.empty()) return std::nullopt;
    return address;
}

std::string format_ipv4(std::uint32_t address) {
    return std::format("{}.{}.{}.{}", address >> 24U, (address >> 16U) & 0xFFU,
                       (address >> 8U) & 0xFFU, address & 0xFFU);
}

std::optional<Ipv4Range> parse_ipv4_spec(std::string_view text) {
    text = trim(text);
    if (const auto slash = text.find('/'); slash != std::string_view::npos) {
        const auto address = parse_ipv4(text.substr(0, slash));
        const std::string_view prefix_text = text.substr(slash + 1);
        std::uint32_t prefix = 0;
        const auto [end, ec] =
            std::from_chars(prefix_text.data(), prefix_text.data() + prefix_text.size(), prefix);
        if (!address || ec != std::errc{} || end != prefix_text.data() + prefix_text.size() ||
            prefix_text.empty() || prefix > 32) {
            return std::nullopt;
        }
        const std::uint32_t mask = prefix == 0 ? 0U : ~std::uint32_t{0} << (32U - prefix);
        return Ipv4Range{*address & mask, (*address & mask) | ~mask};
    }
    if (const auto dash = text.find('-'); dash != std::string_view::npos) {
        const auto first = parse_ipv4(trim(text.substr(0, dash)));
        const auto last = parse_ipv4(trim(text.substr(dash + 1)));
        if (!first || !last || *first > *last) return std::nullopt;
        return Ipv4Range{*first, *last};
    }
    const auto address = parse_ipv4(text);
    if (!address) return std::nullopt;
    return Ipv4Range{*address, *address};
}

std::expected<std::vector<Ipv4Range>, std::string> parse_ipv4_specs(
    const nlohmann::ordered_json& specs) {
    std::vector<Ipv4Range> ranges;
    if (specs.is_null()) {
        return ranges;
    }
    if (specs.is_string()) {
        if (auto ok = append_specs(specs.get_ref<const std::string&>(), ranges); !ok) {
            return std::unexpected(ok.error());
        }
        return merge_ranges(std::move(ranges));
    }
    if (!specs.is_array()) {
        return std::unexpected(std::string{"must be an array of strings or a string"});
    }
    for (const auto& item : specs) {
        if (!item.is_string()) {
            return std::unexpected(std::string{"must be an array of strings or a string"});
        }
        if (auto ok = append_specs(item.get_ref<const std::string&>(), ranges); !ok) {
            return std::unexpected(ok.error());
        }
    }
    return merge_ranges(std::move(ranges));
}

std::vector<Ipv4Range> merge_ranges(std::vector<Ipv4Range> ranges) {
    std::ranges::sort(ranges, {}, &Ipv4Range::first);
    std::vector<Ipv4Range> merged;
    for (const Ipv4Range& range : ranges) {
        // 64-bit so last + 1 cannot wrap at 255.255.255.255.
        if (!merged.empty() &&
            std::uint64_t{range.first} <= std::uint64_t{merged.back().last} + 1) {
            merged.back().last = std::max(merged.back().last, range.last);
        } else {
            merged.push_back(range);
        }
    }
    return merged;
}

std::vector<Ipv4Range> subtract_ranges(const std::vector<Ipv4Range>& ranges,
                                       const std::vector<Ipv4Range>& excludes) {
    std::vector<Ipv4Range> result;
    std::size_t next_exclude = 0;
    for (const Ipv4Range& range : ranges) {
        std::uint64_t cursor = range.first;
        while (next_exclude < excludes.size() && excludes[next_exclude].last < range.first) {
            ++next_exclude;
        }
        for (std::size_t i = next_exclude; i < excludes.size() && excludes[i].first <= range.last;
             ++i) {
            if (excludes[i].first > cursor) {
                result.push_back({static_cast<std::uint32_t>(cursor), excludes[i].first - 1});
            }
            cursor = std::max<std::uint64_t>(cursor, std::uint64_t{excludes[i].last} + 1);
        }
        if (cursor <= range.last) {
            result.push_back({static_cast<std::uint32_t>(cursor), range.last});
        }
    }
    return result;
}

std::uint64_t count_addresses(const std::vector<Ipv4Range>& ranges) {
    std::uint64_t total = 0;
    for (const Ipv4Range& range : ranges) {
        total += std::uint64_t{range.last} - range.first + 1;
    }
    return total;
}

std::vector<std::vector<Ipv4Range>> split_ranges(const std::vector<Ipv4Range>& ranges,
                                                 std::size_t parts) {
    const std::uint64_t total = count_addresses(ranges);
    std::vector<std::vector<Ipv4Range>> groups(parts);
    if (parts == 0 || total == 0) {
        return groups;
    }
    const std::uint64_t base = total / parts;
    const std::uint64_t remainder = total % parts;
    std::size_t range_index = 0;
    std::uint64_t cursor = ranges.front().first;
    for (std::size_t part = 0; part < parts; ++part) {
        std::uint64_t needed = base + (part < remainder ? 1 : 0);
        while (needed > 0 && range_index < ranges.size()) {
            const std::uint64_t available = std::uint64_t{ranges[range_index].last} - cursor + 1;
            const std::uint64_t taken = std::min(needed, available);
            groups[part].push_back({static_cast<std::uint32_t>(cursor),
                                    static_cast<std::uint32_t>(cursor + taken - 1)});
            needed -= taken;
            cursor += taken;
            if (taken == available && ++range_index < ranges.size()) {
                cursor = ranges[range_index].first;
            }
        }
    }
    return groups;
}

std::string format_ipv4_range(const Ipv4Range& range) {
    if (range.first == range.last) {
        return format_ipv4(range.first);
    }
    const std::uint64_t size = std::uint64_t{range.last} - range.first + 1;
    if (std::has_single_bit(size) && range.first % size == 0) {
        const int prefix = 32 - std::countr_zero(size);
        return std::format("{}/{}", format_ipv4(range.first), prefix);
    }
    return std::format("{}-{}", format_ipv4(range.first), format_ipv4(range.last));
}

}  // namespace worker_manager
