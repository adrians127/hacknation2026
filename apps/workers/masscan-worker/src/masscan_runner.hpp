#pragma once

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
#include "scan_job.hpp"

namespace masscan_worker {

enum class StopReason { kNone, kTimeWindow, kSignal };

struct Finding {
    std::uint32_t ip;
    std::uint16_t port;
    std::uint8_t ttl;
};

struct ScanOutcome {
    int exit_code = 0;
    StopReason stop_reason = StopReason::kNone;
    bool was_killed = false;                    // masscan ignored SIGINT for the whole grace period
    std::optional<std::uint64_t> resume_index;  // from masscan's paused.conf
    std::uint64_t malformed_lines = 0;
    std::string diagnostics;  // meaningful tail of masscan's stderr
};

using FindingSink = std::function<void(const Finding&)>;

// SIGINT/SIGTERM must be blocked in every thread before run_masscan starts its signal thread.
void block_stop_signals();

// "1.3.2", or nullopt when the binary is missing or not runnable.
[[nodiscard]] std::optional<std::string> detect_masscan_version(const Config& config);

[[nodiscard]] std::vector<std::string> build_masscan_args(const ScanJob& job, const Config& config,
                                                          const std::filesystem::path& target_file);

// One line of `masscan -oD` output; nullopt for anything but an open-port status record.
[[nodiscard]] std::optional<Finding> parse_finding(std::string_view line);

// Blocks until masscan exits; `on_finding` is called on the calling thread as results stream in.
[[nodiscard]] std::expected<ScanOutcome, Error> run_masscan(const ScanJob& job,
                                                            const Config& config,
                                                            const FindingSink& on_finding);

}  // namespace masscan_worker
