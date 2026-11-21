#pragma once

#include <chrono>
#include <nlohmann/json_fwd.hpp>
#include <optional>
#include <span>
#include <string>

#include "error.hpp"
#include "masscan_runner.hpp"
#include "scan_job.hpp"
#include "topology.hpp"

namespace masscan_worker {

enum class ScanStatus { kCompleted, kPartial, kFailed };

struct ReportTiming {
    std::chrono::system_clock::time_point started_at{};
    std::chrono::system_clock::time_point finished_at{};
    std::chrono::milliseconds duration{};
    std::chrono::milliseconds scan_duration{};  // the masscan run itself; 0 if it never ran
};

// Pointers are optional, non-owning: a job that failed validation has no ScanJob or outcome.
struct ReportInput {
    ScanStatus status = ScanStatus::kFailed;
    std::string job_id{};
    std::optional<std::string> scan_id{};  // used when `job` is null (invalid input)
    std::optional<std::string> lease_id{};
    const ScanJob* job = nullptr;
    const ScanOutcome* outcome = nullptr;
    const TopologyBuilder* topology = nullptr;
    std::optional<Error> error{};
    std::optional<std::string> scanner_version{};
    ReportTiming timing{};
    std::span<const std::string> warnings{};
};

// The result document of docs/worker-result-format.md ({scan, hosts}), plus a `masscan` block.
[[nodiscard]] nlohmann::ordered_json build_report(const ReportInput& input);

}  // namespace masscan_worker
