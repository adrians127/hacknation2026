#pragma once

#include <chrono>
#include <cstdint>
#include <expected>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "files.hpp"

namespace worker_manager {

using SysClock = std::chrono::system_clock;

enum class SplitStrategy { kNone, kShard, kRanges, kChunk };

[[nodiscard]] std::string_view to_string(SplitStrategy strategy) noexcept;

struct SplitPolicy {
    SplitStrategy strategy = SplitStrategy::kNone;
    std::optional<std::uint32_t> max_tasks;
    std::optional<std::uint64_t> max_items_per_task;
};

// One entry of the backend's `jobs[]` (see README.md, "Input").
struct Job {
    std::size_t index = 0;  // position in `jobs[]`
    std::string job_id;
    std::optional<std::string> scan_id;
    std::optional<std::string> lease_id;
    std::string worker;
    std::optional<SysClock::time_point> deadline;
    SplitPolicy split;
    Json params;  // the worker's own input, never interpreted beyond what `split` needs
};

// A job the manager cannot run; it is still reported, so the backend can fail its lease.
struct InvalidJob {
    std::size_t index = 0;
    std::optional<std::string> job_id;
    std::string message;
};

struct JobList {
    std::vector<Job> jobs;
    std::vector<InvalidJob> invalid;
};

// Fails only when the document itself is unusable; a bad entry becomes an InvalidJob.
[[nodiscard]] std::expected<JobList, std::string> parse_job_list(const Json& document);

// "2026-11-21T17:30:00Z", optionally with fractional seconds.
[[nodiscard]] std::optional<SysClock::time_point> parse_timestamp(std::string_view text);
[[nodiscard]] std::string format_timestamp(SysClock::time_point time);

// Ids become directory names: [A-Za-z0-9._-], 1-128 characters, not starting with '.'.
[[nodiscard]] bool is_safe_id(std::string_view id) noexcept;

}  // namespace worker_manager
