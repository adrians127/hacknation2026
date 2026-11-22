#include "footprint.hpp"

#include <algorithm>
#include <charconv>
#include <format>
#include <string_view>
#include <system_error>

namespace worker_manager {

namespace {

using Area = Footprint::Area;

constexpr PortRange kAllPorts{1, 65535};

std::string_view trim(std::string_view text) {
    while (!text.empty() && text.front() == ' ') text.remove_prefix(1);
    while (!text.empty() && text.back() == ' ') text.remove_suffix(1);
    return text;
}

std::optional<std::uint16_t> parse_port(std::string_view text) {
    text = trim(text);
    unsigned value = 0;
    const auto [end, ec] = std::from_chars(text.data(), text.data() + text.size(), value);
    if (text.empty() || ec != std::errc{} || end != text.data() + text.size() || value < 1 ||
        value > 65535) {
        return std::nullopt;
    }
    return static_cast<std::uint16_t>(value);
}

std::expected<void, std::string> append_port_text(std::string_view text, PortSet& ports) {
    while (true) {
        const auto comma = text.find(',');
        const std::string_view item = trim(text.substr(0, comma));
        if (!item.empty()) {
            const auto dash = item.find('-');
            const auto first = parse_port(item.substr(0, dash));
            const auto last =
                dash == std::string_view::npos ? first : parse_port(item.substr(dash + 1));
            if (!first || !last || *first > *last) {
                return std::unexpected(std::format("'{}' is not a port or port range", item));
            }
            ports.push_back({*first, *last});
        }
        if (comma == std::string_view::npos) return {};
        text.remove_prefix(comma + 1);
    }
}

PortSet merge_ports(PortSet ports) {
    std::ranges::sort(ports, {}, &PortRange::first);
    PortSet merged;
    for (const PortRange& range : ports) {
        if (!merged.empty() && range.first <= merged.back().last + 1) {
            merged.back().last = std::max(merged.back().last, range.last);
        } else {
            merged.push_back(range);
        }
    }
    return merged;
}

bool ports_intersect(const PortSet& a, const PortSet& b) {
    std::size_t i = 0;
    std::size_t j = 0;
    while (i < a.size() && j < b.size()) {
        if (a[i].last < b[j].first) {
            ++i;
        } else if (b[j].last < a[i].first) {
            ++j;
        } else {
            return true;
        }
    }
    return false;
}

PortSet unite(const PortSet& a, const PortSet& b) {
    PortSet all = a;
    all.insert(all.end(), b.begin(), b.end());
    return merge_ports(std::move(all));
}

// Areas may overlap (e.g. one host listed twice); cut them into disjoint IP segments whose
// ports are the union of every area covering the segment.
std::vector<Area> normalize(std::vector<Area> areas) {
    std::erase_if(areas, [](const Area& area) { return area.ports.empty(); });
    std::ranges::sort(areas, {}, [](const Area& area) { return area.ips.first; });

    bool has_overlap = false;
    for (std::size_t i = 1; i < areas.size() && !has_overlap; ++i) {
        has_overlap = areas[i].ips.first <= areas[i - 1].ips.last;
    }
    std::vector<Area> disjoint;
    if (!has_overlap) {
        disjoint = std::move(areas);
    } else {
        std::vector<std::uint64_t> bounds;
        for (const Area& area : areas) {
            bounds.push_back(area.ips.first);
            bounds.push_back(std::uint64_t{area.ips.last} + 1);
        }
        std::ranges::sort(bounds);
        const auto [last, end] = std::ranges::unique(bounds);
        bounds.erase(last, end);
        std::vector<const Area*> active;
        std::size_t next = 0;
        for (std::size_t b = 0; b + 1 < bounds.size(); ++b) {
            const std::uint64_t start = bounds[b];
            std::erase_if(active, [&](const Area* area) { return area->ips.last < start; });
            while (next < areas.size() && areas[next].ips.first == start) {
                active.push_back(&areas[next++]);
            }
            if (active.empty()) continue;
            PortSet ports;
            for (const Area* area : active) ports = unite(ports, area->ports);
            disjoint.push_back(
                {{static_cast<std::uint32_t>(start), static_cast<std::uint32_t>(bounds[b + 1] - 1)},
                 std::move(ports)});
        }
    }
    // Adjacent segments with the same ports become one, so a /16 stays one area.
    std::vector<Area> merged;
    for (Area& area : disjoint) {
        if (!merged.empty() && std::uint64_t{merged.back().ips.last} + 1 == area.ips.first &&
            merged.back().ports == area.ports) {
            merged.back().ips.last = area.ips.last;
        } else {
            merged.push_back(std::move(area));
        }
    }
    return merged;
}

std::expected<Footprint, std::string> read_footprint(const Json& input) {
    PortSet default_ports{kAllPorts};
    if (const auto it = input.find("ports"); it != input.end() && !it->is_null()) {
        auto ports = parse_port_specs(*it);
        if (!ports) return std::unexpected(std::format("'ports' {}", ports.error()));
        default_ports = std::move(*ports);
    }
    const auto targets = input.find("targets");
    if (targets == input.end() || targets->is_null()) {
        return std::unexpected(std::string{"no 'targets'"});
    }

    std::vector<Area> areas;
    const auto add_spec = [&](const Json& spec,
                              const PortSet& ports) -> std::expected<void, std::string> {
        auto ranges = parse_ipv4_specs(spec);
        if (!ranges) return std::unexpected(std::format("'targets' {}", ranges.error()));
        for (const Ipv4Range& range : *ranges) areas.push_back({range, ports});
        return {};
    };
    if (targets->is_string()) {
        if (auto ok = add_spec(*targets, default_ports); !ok) return std::unexpected(ok.error());
    } else if (targets->is_array()) {
        for (const Json& target : *targets) {
            if (target.is_string()) {
                if (auto ok = add_spec(target, default_ports); !ok) {
                    return std::unexpected(ok.error());
                }
                continue;
            }
            // Host object (nmap-worker): {"ip": "10.0.0.5", "ports": [22, 443]}; without
            // `ports` it gets the job's.
            if (!target.is_object() || !target.contains("ip")) {
                return std::unexpected(
                    std::string{"'targets' entries must be strings or {ip, ...}"});
            }
            PortSet ports = default_ports;
            if (const auto it = target.find("ports"); it != target.end() && !it->is_null()) {
                auto parsed = parse_port_specs(*it);
                if (!parsed) return std::unexpected(std::format("'ports' {}", parsed.error()));
                ports = std::move(*parsed);
            }
            if (auto ok = add_spec(target["ip"], ports); !ok) return std::unexpected(ok.error());
        }
    } else {
        return std::unexpected(std::string{"'targets' must be a string or an array"});
    }

    const auto excludes =
        parse_ipv4_specs(input.contains("exclude") ? input["exclude"] : Json(nullptr));
    if (!excludes) return std::unexpected(std::format("'exclude' {}", excludes.error()));
    if (!excludes->empty()) {
        std::vector<Area> kept;
        for (const Area& area : areas) {
            for (const Ipv4Range& range : subtract_ranges({area.ips}, *excludes)) {
                kept.push_back({range, area.ports});
            }
        }
        areas = std::move(kept);
    }
    Footprint footprint;
    footprint.areas = normalize(std::move(areas));
    return footprint;
}

}  // namespace

std::expected<PortSet, std::string> parse_port_specs(const Json& specs) {
    PortSet ports;
    if (specs.is_string()) {
        if (auto ok = append_port_text(specs.get_ref<const std::string&>(), ports); !ok) {
            return std::unexpected(ok.error());
        }
    } else if (specs.is_array()) {
        for (const Json& item : specs) {
            if (item.is_number_unsigned() && item.get<std::uint64_t>() >= 1 &&
                item.get<std::uint64_t>() <= 65535) {
                const auto port = static_cast<std::uint16_t>(item.get<std::uint64_t>());
                ports.push_back({port, port});
            } else if (item.is_string()) {
                if (auto ok = append_port_text(item.get_ref<const std::string&>(), ports); !ok) {
                    return std::unexpected(ok.error());
                }
            } else {
                return std::unexpected(std::format("'{}' is not a port", item.dump()));
            }
        }
    } else {
        return std::unexpected(std::string{"must be a string or an array"});
    }
    if (ports.empty()) return std::unexpected(std::string{"must not be empty"});
    return merge_ports(std::move(ports));
}

std::uint64_t count_ports(const PortSet& ports) {
    std::uint64_t total = 0;
    for (const PortRange& range : ports) total += std::uint64_t{range.last} - range.first + 1;
    return total;
}

std::uint64_t Footprint::address_count() const {
    std::uint64_t total = 0;
    for (const Area& area : areas) total += std::uint64_t{area.ips.last} - area.ips.first + 1;
    return total;
}

Footprint footprint_of(const Json& task_input) {
    auto footprint = read_footprint(task_input);
    return footprint ? std::move(*footprint) : everything();
}

Footprint everything() {
    Footprint footprint;
    footprint.areas.push_back({{0U, 0xFFFFFFFFU}, {kAllPorts}});
    footprint.is_exact = false;
    return footprint;
}

bool overlaps(const Footprint& a, const Footprint& b) {
    if (a.areas.empty() || b.areas.empty() || a.areas.back().ips.last < b.areas.front().ips.first ||
        b.areas.back().ips.last < a.areas.front().ips.first) {
        return false;
    }
    std::size_t i = 0;
    std::size_t j = 0;
    while (i < a.areas.size() && j < b.areas.size()) {
        const Ipv4Range& x = a.areas[i].ips;
        const Ipv4Range& y = b.areas[j].ips;
        if (x.last < y.first) {
            ++i;
        } else if (y.last < x.first) {
            ++j;
        } else {
            if (ports_intersect(a.areas[i].ports, b.areas[j].ports)) return true;
            (x.last < y.last) ? ++i : ++j;
        }
    }
    return false;
}

}  // namespace worker_manager
