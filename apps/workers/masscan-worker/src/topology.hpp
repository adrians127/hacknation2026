#pragma once

#include <cstddef>
#include <cstdint>
#include <nlohmann/json_fwd.hpp>
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
    [[nodiscard]] nlohmann::ordered_json to_json() const;

private:
    struct Host {
        std::uint8_t ttl = 0;  // highest seen, i.e. the shortest observed path
        std::vector<std::uint16_t> ports;
    };

    int group_prefix_;
    std::unordered_map<std::uint32_t, Host> hosts_;
};

}  // namespace masscan_worker
