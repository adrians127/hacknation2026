#pragma once

#include <chrono>
#include <cstdint>
#include <expected>
#include <filesystem>
#include <functional>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "config.hpp"
#include "error.hpp"
#include "logger.hpp"
#include "scan_job.hpp"

namespace masscan_worker {

enum class StopReason { kNone, kTimeWindow, kSignal };

struct Finding {
    std::uint32_t ip;
    std::uint16_t port;
    std::uint8_t ttl;
    std::string reason{};                     // masscan's "reason" ("syn-ack"); empty if absent
    std::optional<std::int64_t> timestamp{};  // Unix seconds when masscan saw the reply
};

struct ScanOutcome {
    int exit_code = 0;
    StopReason stop_reason = StopReason::kNone;
    bool was_killed = false;                    // masscan ignored SIGINT for the whole grace period
    std::optional<std::uint64_t> resume_index;  // from masscan's paused.conf
    std::uint64_t malformed_lines = 0;
    std::string diagnostics;  // meaningful tail of masscan's stderr
};

struct MasscanStatus {
    double rate_pps = 0;
    double percent_done = 0;
    std::optional<std::chrono::seconds> remaining;
    std::optional<std::chrono::seconds> waiting;  // listening for late replies after the last probe
    std::uint64_t found = 0;
};

struct ScanProgress {
    std::optional<MasscanStatus> status;  // none until masscan prints its first status line
    std::chrono::steady_clock::duration elapsed;
    std::uint64_t open_ports_reported;
};

struct ScanCallbacks {
    std::function<void(const Finding&)> on_finding;
    std::function<void(const ScanProgress&)> on_progress;  // every Config::progress_interval
};

// SIGINT/SIGTERM must be blocked in every thread before run_masscan starts its signal thread.
void block_stop_signals();

// "1.3.2", or nullopt when the binary is missing or not runnable.
[[nodiscard]] std::optional<std::string> detect_masscan_version(const Config& config);

[[nodiscard]] std::vector<std::string> build_masscan_args(const ScanJob& job, const Config& config,
                                                          const std::filesystem::path& target_file);

// One line of `masscan -oD` output; nullopt for anything but an open-port status record.
[[nodiscard]] std::optional<Finding> parse_finding(std::string_view line);

// masscan's stderr status line; nullopt for any other line.
[[nodiscard]] std::optional<MasscanStatus> parse_masscan_status(std::string_view line);

// Blocks until masscan exits; callbacks run on the calling thread.
[[nodiscard]] std::expected<ScanOutcome, Error> run_masscan(const ScanJob& job,
                                                            const Config& config,
                                                            const Logger& logger,
                                                            const ScanCallbacks& callbacks);

}  // namespace masscan_worker
