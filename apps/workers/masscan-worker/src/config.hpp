#pragma once

#include <chrono>
#include <cstdint>
#include <string>

#include "logger.hpp"

namespace masscan_worker {

// Operator-side limits from the environment; a job can ask for less, never more.
struct Config {
    std::string masscan_binary;
    std::uint32_t default_rate;
    std::uint32_t max_rate;
    std::uint64_t max_target_addresses;
    LogLevel log_level;
    LogFormat log_format;
    std::chrono::seconds progress_interval;
};

// Throws std::runtime_error on a malformed variable (startup failure).
[[nodiscard]] Config read_config();

}  // namespace masscan_worker
