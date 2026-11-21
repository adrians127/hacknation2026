#include "topology.hpp"

#include <algorithm>
#include <array>
#include <map>
#include <nlohmann/json.hpp>
#include <optional>
#include <string_view>
#include <unordered_set>

#include "address.hpp"

namespace masscan_worker {

namespace {

using json = nlohmann::ordered_json;

struct TtlHint {
    std::uint8_t initial_ttl;
    std::string_view os_family;
};

// Common OS default TTLs; the smallest default >= observed TTL is the likely origin.
constexpr std::array<TtlHint, 3> kTtlHints{{
    {64, "unix-like"},
    {128, "windows"},
    {255, "network-device"},
}};

std::optional<TtlHint> ttl_hint(std::uint8_t ttl) {
    if (ttl == 0) {
        return std::nullopt;
    }
    for (const TtlHint& hint : kTtlHints) {
        if (ttl <= hint.initial_ttl) {
            return hint;
        }
    }
    return std::nullopt;
}

std::uint32_t subnet_mask(int prefix) {
    return prefix <= 0 ? 0U : ~std::uint32_t{0} << (32U - static_cast<std::uint32_t>(prefix));
}

}  // namespace

void TopologyBuilder::add(const Finding& finding) {
    Host& host = hosts_[finding.ip];
    host.ttl = std::max(host.ttl, finding.ttl);
    host.ports.push_back(finding.port);
}

void TopologyBuilder::finalize() {
    for (auto& [ip, host] : hosts_) {
        std::ranges::sort(host.ports);
        const auto [first, last] = std::ranges::unique(host.ports);
        host.ports.erase(first, last);
    }
}

std::size_t TopologyBuilder::open_port_count() const noexcept {
    std::size_t total = 0;
    for (const auto& [ip, host] : hosts_) {
        total += host.ports.size();
    }
    return total;
}

std::size_t TopologyBuilder::subnet_count() const {
    const std::uint32_t mask = subnet_mask(group_prefix_);
    std::unordered_set<std::uint32_t> subnets;
    for (const auto& [ip, host] : hosts_) {
        subnets.insert(ip & mask);
    }
    return subnets.size();
}

json TopologyBuilder::to_json() const {
    const std::uint32_t mask = subnet_mask(group_prefix_);
    std::map<std::uint32_t, std::vector<std::uint32_t>> subnets;
    for (const auto& [ip, host] : hosts_) {
        subnets[ip & mask].push_back(ip);
    }

    std::map<int, std::size_t> hop_histogram;
    json subnet_list = json::array();
    for (auto& [network, ips] : subnets) {
        std::ranges::sort(ips);
        json hosts = json::array();
        std::size_t port_total = 0;
        for (const std::uint32_t ip : ips) {
            const Host& host = hosts_.at(ip);
            json ports = json::array();
            for (const std::uint16_t port : host.ports) {
                ports.push_back({{"port", port}, {"protocol", "tcp"}});
            }
            port_total += host.ports.size();
            json entry{{"ip", format_ipv4(ip)}, {"open_ports", std::move(ports)}};
            if (const auto hint = ttl_hint(host.ttl)) {
                const int hops = hint->initial_ttl - host.ttl;
                entry["ttl"] = host.ttl;
                entry["estimated_hops"] = hops;
                entry["os_family_hint"] = hint->os_family;
                ++hop_histogram[hops];
            } else {
                entry["ttl"] = nullptr;
                entry["estimated_hops"] = nullptr;
                entry["os_family_hint"] = nullptr;
            }
            hosts.push_back(std::move(entry));
        }
        subnet_list.push_back({{"cidr", format_subnet(network, group_prefix_)},
                               {"hosts_up", ips.size()},
                               {"open_ports", port_total},
                               {"hosts", std::move(hosts)}});
    }

    json hops = json::array();
    for (const auto& [hop_count, host_count] : hop_histogram) {
        hops.push_back({{"estimated_hops", hop_count}, {"hosts", host_count}});
    }
    return json{{"group_prefix", group_prefix_},
                {"subnets", std::move(subnet_list)},
                {"hop_distribution", std::move(hops)}};
}

}  // namespace masscan_worker
