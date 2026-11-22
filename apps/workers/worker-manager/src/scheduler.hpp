#pragma once

#include <condition_variable>
#include <cstdint>
#include <mutex>
#include <optional>
#include <span>
#include <stop_token>
#include <string>
#include <vector>

#include "footprint.hpp"
#include "logger.hpp"

namespace worker_manager {

struct ScheduledTask {
    std::string task_id;
    std::size_t job = 0;                    // tasks of one job share its rate cap
    std::optional<std::uint64_t> rate_cap;  // the job's `rate`; none: as much as is free
    std::optional<std::size_t> stage;       // position of the worker in WORKER_MANAGER_STAGES
    std::optional<std::size_t> partition;   // tasks sharing one never conflict (masscan shards)
    Footprint footprint;
};

struct RateBudget {
    std::uint64_t total;     // packets per second for all running tasks together
    std::uint64_t min_task;  // a task never starts with less (unless its job asks for less)
};

struct Grant {
    std::size_t id;
    std::uint64_t rate;  // 0 after a stop: the task is handed out only to be cancelled
};

// Decides which task may start next, walking the queue in backend order:
// - two tasks touching a common IP:port never run at the same time;
// - a task waits for every overlapping task of an earlier stage to finish;
// - the rate budget goes to the queue in order: the first ready task takes all it may
//   (its job's `rate`, or everything free), the next one gets what is left, and a task that
//   cannot get its minimum keeps the budget for itself until running tasks give some back.
class Scheduler {
public:
    Scheduler(std::vector<ScheduledTask> tasks, RateBudget budget, const Logger& logger);

    // Blocks until a task may start; nullopt when none are left. Once `stop` is requested it
    // hands out the remaining tasks at once, so they can be marked cancelled.
    [[nodiscard]] std::optional<Grant> acquire(const std::stop_token& stop);
    void release(std::size_t id);

    [[nodiscard]] const ScheduledTask& task(std::size_t id) const { return tasks_[id]; }
    // Earlier-stage tasks this one had to wait for.
    [[nodiscard]] std::span<const std::size_t> predecessors(std::size_t id) const {
        return predecessors_[id];
    }

private:
    enum class State { kPending, kRunning, kDone };

    [[nodiscard]] bool conflicts(std::size_t a, std::size_t b) const;
    // Requires mutex_. Why the task may not start yet, ignoring the global rate budget.
    [[nodiscard]] std::optional<std::string> blocker(std::size_t id) const;
    [[nodiscard]] std::uint64_t job_headroom(std::size_t id) const;  // requires mutex_
    Grant start(std::size_t id, std::uint64_t rate);                 // requires mutex_
    void hold(std::size_t id, const std::string& reason);            // requires mutex_

    std::vector<ScheduledTask> tasks_;
    std::vector<std::vector<std::size_t>> predecessors_;
    RateBudget budget_;
    const Logger& logger_;

    std::mutex mutex_;
    std::condition_variable_any changed_;
    std::vector<State> states_;
    std::vector<std::uint64_t> granted_;
    std::vector<std::uint64_t> job_used_;
    std::vector<bool> was_held_back_;
    std::vector<std::size_t> running_;
    std::uint64_t free_rate_;
    std::size_t pending_;
    std::uint64_t releases_ = 0;  // wake-up generation
};

}  // namespace worker_manager
