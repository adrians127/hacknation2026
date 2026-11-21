#pragma once

#include <cstdint>
#include <expected>
#include <string>
#include <vector>

#include "files.hpp"
#include "ipv4.hpp"

namespace worker_manager {

struct PortRange {
    std::uint16_t first;
    std::uint16_t last;  // inclusive

    friend bool operator==(const PortRange&, const PortRange&) = default;
};

using PortSet = std::vector<PortRange>;  // sorted, merged

// "22,80,8000-8100", or an array of numbers and such strings (the masscan-worker format).
[[nodiscard]] std::expected<PortSet, std::string> parse_port_specs(const Json& specs);

[[nodiscard]] std::uint64_t count_ports(const PortSet& ports);

// The (IPv4, TCP port) pairs one task touches, as areas with disjoint, sorted IP ranges.
struct Footprint {
    struct Area {
        Ipv4Range ips;
        PortSet ports;
    };
    std::vector<Area> areas;
    // false: the input could not be read, so the footprint is "everything" and the task never
    // shares the network with another one.
    bool is_exact = true;

    [[nodiscard]] std::uint64_t address_count() const;
};

// Reads `targets` (strings, or objects {ip, tcp_ports | ports}), `exclude` and `ports`
// (default 1-65535, as masscan-worker). Never fails: unreadable input yields everything().
[[nodiscard]] Footprint footprint_of(const Json& task_input);

[[nodiscard]] Footprint everything();

// True when some IP:port is in both.
[[nodiscard]] bool overlaps(const Footprint& a, const Footprint& b);

}  // namespace worker_manager
