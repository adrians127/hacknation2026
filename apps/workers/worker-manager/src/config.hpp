#pragma once

#include <chrono>
#include <cstdint>
#include <string>
#include <vector>

#include "logger.hpp"

namespace worker_manager {

// A job's `worker` name and the binary that runs it. Every binary follows the shared worker
// contract: `<binary> --input FILE --output FILE`, logs on stderr, a result JSON in every case.
struct WorkerBinary {
    std::string name;
    std::string binary;
};

// The most a worker can use, e.g. nmap-worker: NMAP_MAX_PARALLEL x NMAP_MAX_RATE_PER_PROCESS.
// Its tasks never reserve more of the budget than this.
struct WorkerRateCap {
    std::string name;
    std::uint64_t rate;
};

struct Config {
    std::vector<WorkerBinary> workers;
    std::vector<WorkerRateCap> worker_rate_caps;
    // Pipeline order: on overlapping IP:ports a later worker waits for the earlier ones.
    std::vector<std::string> stages;
    std::uint32_t max_parallel;       // worker processes running at once, across all jobs
    std::uint32_t max_rate;           // packets per second for all running tasks together
    std::uint32_t min_task_rate;      // a task does not start with less
    std::uint32_t max_tasks_per_job;  // hard cap on how far one job is split
    std::chrono::seconds deadline_margin;
    std::chrono::seconds kill_grace;
    LogLevel log_level;
    LogFormat log_format;
};

// "masscan=masscan-worker,nmap=/opt/bin/nmap-worker". Throws std::runtime_error when malformed.
[[nodiscard]] std::vector<WorkerBinary> parse_worker_binaries(std::string_view text);

// "nmap=100,other=5000". Throws std::runtime_error when malformed.
[[nodiscard]] std::vector<WorkerRateCap> parse_worker_rate_caps(std::string_view text);

// "masscan,nmap". Throws std::runtime_error on an empty or repeated name.
[[nodiscard]] std::vector<std::string> parse_stages(std::string_view text);

// Throws std::runtime_error on a malformed variable (startup failure).
[[nodiscard]] Config read_config();

}  // namespace worker_manager
