#include "scheduler.hpp"

#include <algorithm>
#include <format>
#include <limits>

namespace worker_manager {

namespace {

constexpr std::uint64_t kUnlimited = std::numeric_limits<std::uint64_t>::max();

}  // namespace

Scheduler::Scheduler(std::vector<ScheduledTask> tasks, RateBudget budget, const Logger& logger)
    : tasks_{std::move(tasks)},
      predecessors_(tasks_.size()),
      // A minimum above the total would never be met.
      budget_{budget.total, std::clamp<std::uint64_t>(budget.min_task, 1, budget.total)},
      logger_{logger},
      states_(tasks_.size(), State::kPending),
      granted_(tasks_.size(), 0),
      was_held_back_(tasks_.size(), false),
      free_rate_{budget.total},
      pending_{tasks_.size()} {
    std::size_t jobs = 0;
    for (const ScheduledTask& task : tasks_) jobs = std::max(jobs, task.job + 1);
    job_used_.assign(jobs, 0);
    // Only pairs across stages are ordered; within a stage overlap just means "not together".
    for (std::size_t later = 0; later < tasks_.size(); ++later) {
        for (std::size_t earlier = 0; earlier < tasks_.size(); ++earlier) {
            const auto& a = tasks_[earlier].stage;
            const auto& b = tasks_[later].stage;
            if (a && b && *a < *b && overlaps(tasks_[earlier].footprint, tasks_[later].footprint)) {
                predecessors_[later].push_back(earlier);
            }
        }
    }
}

bool Scheduler::conflicts(std::size_t a, std::size_t b) const {
    const auto& pa = tasks_[a].partition;
    const auto& pb = tasks_[b].partition;
    if (pa && pb && *pa == *pb) {
        return false;
    }
    return overlaps(tasks_[a].footprint, tasks_[b].footprint);
}

std::optional<std::string> Scheduler::blocker(std::size_t id) const {
    for (const std::size_t before : predecessors_[id]) {
        if (states_[before] != State::kDone) {
            return std::format("waits for earlier-stage task {} on the same IPs and ports",
                               tasks_[before].task_id);
        }
    }
    for (const std::size_t other : running_) {
        if (conflicts(id, other)) {
            return std::format("shares IPs and ports with running task {}", tasks_[other].task_id);
        }
    }
    const auto& cap = tasks_[id].rate_cap;
    if (cap && job_headroom(id) < std::min(*cap, budget_.min_task)) {
        return std::format("its job's rate {} pps is in use by its other tasks", *cap);
    }
    return std::nullopt;
}

std::uint64_t Scheduler::job_headroom(std::size_t id) const {
    const auto& cap = tasks_[id].rate_cap;
    const std::uint64_t used = job_used_[tasks_[id].job];
    return cap ? (*cap > used ? *cap - used : 0) : kUnlimited;
}

Grant Scheduler::start(std::size_t id, std::uint64_t rate) {
    states_[id] = State::kRunning;
    running_.push_back(id);
    --pending_;
    granted_[id] = rate;
    job_used_[tasks_[id].job] += rate;
    free_rate_ -= rate;
    return {id, rate};
}

void Scheduler::hold(std::size_t id, const std::string& reason) {
    if (!was_held_back_[id]) {
        was_held_back_[id] = true;
        logger_.info("task.held", "task held back",
                     {{"task_id", tasks_[id].task_id}, {"reason", reason}});
    }
}

std::optional<Grant> Scheduler::acquire(const std::stop_token& stop) {
    std::unique_lock lock{mutex_};
    while (true) {
        if (pending_ == 0) {
            return std::nullopt;
        }
        std::optional<std::size_t> first_pending;
        for (std::size_t id = 0; id < tasks_.size(); ++id) {
            if (states_[id] != State::kPending) continue;
            if (!first_pending) first_pending = id;
            if (stop.stop_requested()) return start(id, 0);
            if (const auto reason = blocker(id)) {
                hold(id, *reason);  // cannot run anyway, so it does not hold the budget either
                continue;
            }
            const std::uint64_t wanted = job_headroom(id);
            if (free_rate_ >= std::min(wanted, budget_.min_task)) {
                return start(id, std::min(wanted, free_rate_));
            }
            // First ready task in the queue: the budget waits for it, nobody behind overtakes.
            hold(id, std::format("waits for rate budget ({} of {} pps free)", free_rate_,
                                 budget_.total));
            break;
        }
        // Cannot happen (with nothing running the whole budget is free and the earliest
        // pending stage is unblocked); never let a scheduling bug hang the run.
        if (running_.empty()) {
            logger_.error("scheduler.stuck", "no task is ready while none runs; forcing one",
                          {{"task_id", tasks_[*first_pending].task_id}});
            return start(*first_pending, std::min(job_headroom(*first_pending), free_rate_));
        }
        const std::uint64_t seen = releases_;
        changed_.wait(lock, stop, [&] { return releases_ != seen; });
    }
}

void Scheduler::release(std::size_t id) {
    {
        const std::scoped_lock lock{mutex_};
        states_[id] = State::kDone;
        std::erase(running_, id);
        free_rate_ += granted_[id];
        job_used_[tasks_[id].job] -= granted_[id];
        granted_[id] = 0;
        ++releases_;
    }
    changed_.notify_all();
}

}  // namespace worker_manager
