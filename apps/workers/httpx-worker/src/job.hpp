#pragma once

#include "address.hpp"

#include <chrono>
#include <cstdint>
#include <expected>
#include <string>
#include <string_view>
#include <vector>

namespace httpx_worker {

struct Target {
    std::string ip;
    std::vector<PortRange> ports;
    std::vector<std::string> domains;
    // Host objects are the open-port handoff from discovery/service workers.
    bool known_open = false;
};

struct Limits {
    std::uint32_t rate = 25; // HTTP requests per second, capped by the manager's grant.
    std::uint32_t threads = 10;
    std::uint32_t timeout_seconds = 10;
    std::uint32_t max_body_bytes = 524288;
    std::uint32_t max_redirects = 5;
};

struct Job {
    std::string job_id;
    std::string scan_id;
    std::string lease_id;
    std::string subnet;
    std::string ports;
    std::vector<Target> targets;
    std::vector<std::string> probe_paths;
    Limits limits;
    std::chrono::steady_clock::time_point deadline;
};

[[nodiscard]] std::expected<Job, Error> parse_job(std::string_view input);

} // namespace httpx_worker
