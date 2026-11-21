#pragma once

#include <chrono>
#include <filesystem>
#include <optional>
#include <span>
#include <stop_token>
#include <string>
#include <string_view>

#include "job.hpp"
#include "logger.hpp"
#include "planner.hpp"

namespace worker_manager {

enum class TaskStatus { kCompleted, kPartial, kFailed, kCancelled };

[[nodiscard]] std::string_view to_string(TaskStatus status) noexcept;

struct TaskOutcome {
    TaskStatus status = TaskStatus::kCancelled;
    std::optional<int> exit_code;
    std::optional<std::string> error_code;
    std::optional<std::string> error_message;
    std::optional<SysClock::time_point> started_at;
    std::optional<SysClock::time_point> finished_at;
    bool has_result = false;
    Json counts = nullptr;  // the result's scan.counts
};

struct TaskContext {
    const Job& job;
    const Task& task;
    std::filesystem::path binary;
    std::filesystem::path job_dir;
    std::chrono::seconds deadline_margin;
    std::chrono::seconds kill_grace;
    std::uint64_t rate;     // packets per second granted by the scheduler; written as `rate`
    std::stop_token stop;   // first SIGINT/SIGTERM: ask the worker to stop (it writes a partial)
    std::stop_token force;  // second one: kill it
};

// "task-001"; the stem of the task's .input.json, .result.json and .log files.
[[nodiscard]] std::string task_file_stem(std::uint32_t index);

// Runs one worker process to completion. Never throws.
[[nodiscard]] TaskOutcome run_task(const TaskContext& context, const Logger& logger) noexcept;

// completed / partial / failed / cancelled for a set of task or job statuses.
[[nodiscard]] std::string_view aggregate_status(std::span<const std::string_view> statuses);

}  // namespace worker_manager
