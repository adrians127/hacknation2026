#pragma once

#include <cstddef>
#include <cstdint>
#include <nlohmann/json_fwd.hpp>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

#include "masscan_runner.hpp"

namespace masscan_worker {

// Live hosts grouped into subnets of `group_prefix` bits, with TTL-based distance hints.
class TopologyBuilder {
public:
    explicit TopologyBuilder(int group_prefix) noexcept : group_prefix_{group_prefix} {}

    void add(const Finding& finding);

    // Sorts and dedupes ports (retries can report one port twice); call before reading results.
    void finalize();

    [[nodiscard]] std::size_t host_count() const noexcept { return hosts_.size(); }
    [[nodiscard]] std::size_t open_port_count() const noexcept;
    [[nodiscard]] std::size_t subnet_count() const;
    // Subnets and TTL hints (camelCase); hosts are listed by IP only, their ports are in
    // hosts_json().
    [[nodiscard]] nlohmann::ordered_json to_json() const;

    // `hosts[]` of docs/worker-result-format.md: one `up` entry per live host, sorted numerically.
    [[nodiscard]] nlohmann::ordered_json hosts_json() const;

private:
    struct Port {
        std::uint16_t port = 0;
        std::uint8_t ttl = 0;  // highest seen for this port
        std::string reason;
    };

    struct Host {
        std::uint8_t ttl = 0;                    // highest seen, i.e. the shortest observed path
        std::optional<std::int64_t> first_seen;  // Unix seconds
        std::vector<Port> ports;
    };

    [[nodiscard]] std::vector<std::uint32_t> sorted_ips() const;

    int group_prefix_;
    std::unordered_map<std::uint32_t, Host> hosts_;
};

}  // namespace masscan_worker
