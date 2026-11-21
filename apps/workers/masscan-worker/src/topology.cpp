#include "topology.hpp"

#include <algorithm>
#include <array>
#include <chrono>
#include <format>
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

std::string iso8601(std::int64_t unix_seconds) {
    return std::format("{:%FT%TZ}", std::chrono::sys_seconds{std::chrono::seconds{unix_seconds}});
}

std::uint32_t subnet_mask(int prefix) {
    return prefix <= 0 ? 0U : ~std::uint32_t{0} << (32U - static_cast<std::uint32_t>(prefix));
}

}  // namespace

void TopologyBuilder::add(const Finding& finding) {
    Host& host = hosts_[finding.ip];
    host.ttl = std::max(host.ttl, finding.ttl);
    if (finding.timestamp && (!host.first_seen || *finding.timestamp < *host.first_seen)) {
        host.first_seen = finding.timestamp;
    }
    host.ports.push_back({finding.port, finding.ttl, finding.reason});
}

void TopologyBuilder::finalize() {
    for (auto& [ip, host] : hosts_) {
        std::ranges::stable_sort(host.ports, {}, &Port::port);
        // Retries can report one port twice: keep one entry with the highest TTL and a reason.
        std::vector<Port> unique;
        for (Port& port : host.ports) {
            if (!unique.empty() && unique.back().port == port.port) {
                Port& kept = unique.back();
                kept.ttl = std::max(kept.ttl, port.ttl);
                if (kept.reason.empty()) {
                    kept.reason = std::move(port.reason);
                }
            } else {
                unique.push_back(std::move(port));
            }
        }
        host.ports = std::move(unique);
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

std::vector<std::uint32_t> TopologyBuilder::sorted_ips() const {
    std::vector<std::uint32_t> ips;
    ips.reserve(hosts_.size());
    for (const auto& [ip, host] : hosts_) {
        ips.push_back(ip);
    }
    std::ranges::sort(ips);
    return ips;
}

json TopologyBuilder::hosts_json() const {
    const auto nullable_string = [](const std::string& text) {
        return text.empty() ? json(nullptr) : json(text);
    };
    json hosts = json::array();
    for (const std::uint32_t ip : sorted_ips()) {
        const Host& host = hosts_.at(ip);
        json ports = json::array();
        // A host is up because of its replies, so its reason is the one of its first open port.
        std::string host_reason;
        for (const Port& port : host.ports) {
            if (host_reason.empty()) {
                host_reason = port.reason;
            }
            ports.push_back({
                {"port", port.port},
                {"protocol", "tcp"},
                {"state", "open"},
                {"reason", nullable_string(port.reason)},
                {"service", nullptr},
                {"identity",
                 {{"ttl", port.ttl > 0 ? json(port.ttl) : json(nullptr)},
                  {"sshHostKeySha256", nullptr},
                  {"tlsCertSha256", nullptr}}},
                {"banner", nullptr},
                {"scripts", json::array()},
                {"http", json::array()},
            });
        }
        hosts.push_back({
            {"ip", format_ipv4(ip)},
            {"status", "up"},
            {"reason", nullable_string(host_reason)},
            {"observedAt", host.first_seen ? json(iso8601(*host.first_seen)) : json(nullptr)},
            {"latencyMs", nullptr},
            {"hostnames", json::array()},
            {"error", nullptr},
            {"ports", std::move(ports)},
        });
    }
    return hosts;
}

json TopologyBuilder::to_json() const {
    const std::uint32_t mask = subnet_mask(group_prefix_);
    std::map<std::uint32_t, std::vector<std::uint32_t>> subnets;
    for (const std::uint32_t ip : sorted_ips()) {
        subnets[ip & mask].push_back(ip);
    }

    std::map<int, std::size_t> hop_histogram;
    json subnet_list = json::array();
    for (const auto& [network, ips] : subnets) {
        json hosts = json::array();
        std::size_t port_total = 0;
        for (const std::uint32_t ip : ips) {
            const Host& host = hosts_.at(ip);
            port_total += host.ports.size();
            json entry{{"ip", format_ipv4(ip)}, {"openPorts", host.ports.size()}};
            if (const auto hint = ttl_hint(host.ttl)) {
                const int hops = hint->initial_ttl - host.ttl;
                entry["ttl"] = host.ttl;
                entry["estimatedHops"] = hops;
                entry["osFamilyHint"] = hint->os_family;
                ++hop_histogram[hops];
            } else {
                entry["ttl"] = nullptr;
                entry["estimatedHops"] = nullptr;
                entry["osFamilyHint"] = nullptr;
            }
            hosts.push_back(std::move(entry));
        }
        subnet_list.push_back({{"cidr", format_subnet(network, group_prefix_)},
                               {"hostsUp", ips.size()},
                               {"openPorts", port_total},
                               {"hosts", std::move(hosts)}});
    }

    json hops = json::array();
    for (const auto& [hop_count, host_count] : hop_histogram) {
        hops.push_back({{"estimatedHops", hop_count}, {"hosts", host_count}});
    }
    return json{{"groupPrefix", group_prefix_},
                {"subnets", std::move(subnet_list)},
                {"hopDistribution", std::move(hops)}};
}

}  // namespace masscan_worker
