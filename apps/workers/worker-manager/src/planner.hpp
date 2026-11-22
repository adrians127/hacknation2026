#pragma once

#include <cstdint>
#include <expected>
#include <string>
#include <vector>

#include "job.hpp"

namespace worker_manager {

// One worker run: the input JSON a worker process gets on --input.
struct Task {
    std::uint32_t index = 1;  // 1-based
    std::uint32_t count = 1;
    std::string task_id;  // "<job_id>/<index>"
    Json input;
};

struct Plan {
    SplitStrategy strategy = SplitStrategy::kNone;  // after overrides (e.g. a resume)
    std::vector<Task> tasks;
    std::vector<std::string> warnings;
};

struct PlanLimits {
    std::uint32_t max_tasks_per_job;
    std::uint32_t max_parallel;
};

// `seed` is used for `shard` when the job's params carry none; every shard gets the same one.
[[nodiscard]] std::expected<Plan, std::string> plan_job(const Job& job, const PlanLimits& limits,
                                                        std::uint64_t seed);

// A random seed below 2^53 (masscan-worker rejects larger ones: they do not survive JS).
[[nodiscard]] std::uint64_t random_seed();

}  // namespace worker_manager
