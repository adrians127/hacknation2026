#pragma once

#include "address.hpp"

#include <algorithm>
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

/** Fetched from every endpoint for its hash; the same host, so allowed ranges and rate still hold. */
inline constexpr std::string_view kFaviconPath = "/favicon.ico";

/** Paths requested per URL: `/`, the favicon and the probe paths, each once. */
[[nodiscard]] inline std::size_t request_paths(const Job& job) {
    const bool probes_favicon = std::ranges::find(job.probe_paths, kFaviconPath) != job.probe_paths.end();
    return job.probe_paths.size() + (probes_favicon ? 1 : 2);
}

[[nodiscard]] std::expected<Job, Error> parse_job(std::string_view input);

} // namespace httpx_worker
