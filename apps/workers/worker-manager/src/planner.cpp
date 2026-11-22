#include "planner.hpp"

#include <algorithm>
#include <format>
#include <random>

#include "ipv4.hpp"

namespace worker_manager {

namespace {

constexpr std::uint64_t kMaxSafeInteger = (std::uint64_t{1} << 53) - 1;

bool has_value(const Json& params, const char* key) {
    const auto it = params.find(key);
    return it != params.end() && !it->is_null();
}

bool is_resume(const Json& params) {
    const auto it = params.find("resume_index");
    return it != params.end() && it->is_number_integer() && it->get<std::int64_t>() > 0;
}

// max_items_per_task sets the task size; max_tasks (or the operator cap) bounds the count.
std::uint64_t task_count(std::uint64_t items, const SplitPolicy& split, std::uint32_t wanted,
                         std::uint32_t cap) {
    std::uint64_t count = wanted;
    if (split.max_items_per_task) {
        count = (items + *split.max_items_per_task - 1) / *split.max_items_per_task;
    }
    return std::clamp<std::uint64_t>(std::min<std::uint64_t>(count, cap), 1,
                                     std::max<std::uint64_t>(items, 1));
}

}  // namespace

std::uint64_t random_seed() {
    std::random_device device;
    std::mt19937_64 engine{(std::uint64_t{device()} << 32U) | device()};
    return std::uniform_int_distribution<std::uint64_t>{1, kMaxSafeInteger}(engine);
}

std::expected<Plan, std::string> plan_job(const Job& job, const PlanLimits& limits,
                                          std::uint64_t seed) {
    Plan plan;
    plan.strategy = job.split.strategy;
    const Json& params = job.params;

    // masscan's resume index points into the randomized space of one exact (shard of a) job.
    if (plan.strategy != SplitStrategy::kNone &&
        (is_resume(params) || has_value(params, "shard"))) {
        plan.warnings.push_back(std::format(
            "split '{}' ignored: params carry 'shard' or 'resume_index', run as one task",
            to_string(plan.strategy)));
        plan.strategy = SplitStrategy::kNone;
    }

    const std::uint32_t cap =
        std::min(job.split.max_tasks.value_or(limits.max_tasks_per_job), limits.max_tasks_per_job);
    const std::uint32_t wanted = std::min(job.split.max_tasks.value_or(limits.max_parallel), cap);

    // Per-task overrides of params; one empty object per task when nothing changes.
    std::vector<Json> overrides;
    switch (plan.strategy) {
        case SplitStrategy::kNone:
            overrides.emplace_back(Json::object());
            break;
        case SplitStrategy::kShard: {
            const auto count = std::max<std::uint32_t>(wanted, 1);
            if (count == 1) {
                overrides.emplace_back(Json::object());
                break;
            }
            const auto seed_it = params.find("seed");
            const Json shared_seed =
                (seed_it != params.end() && !seed_it->is_null()) ? *seed_it : Json(seed);
            for (std::uint32_t index = 1; index <= count; ++index) {
                overrides.push_back(
                    {{"seed", shared_seed}, {"shard", {{"index", index}, {"total", count}}}});
            }
            break;
        }
        case SplitStrategy::kRanges: {
            const auto targets =
                parse_ipv4_specs(params.contains("targets") ? params["targets"] : Json(nullptr));
            if (!targets)
                return std::unexpected(std::format("'params.targets' {}", targets.error()));
            const auto excludes =
                parse_ipv4_specs(params.contains("exclude") ? params["exclude"] : Json(nullptr));
            if (!excludes) {
                return std::unexpected(std::format("'params.exclude' {}", excludes.error()));
            }
            const auto effective = subtract_ranges(*targets, *excludes);
            const std::uint64_t addresses = count_addresses(effective);
            if (addresses == 0) {
                return std::unexpected(
                    std::string{"no addresses left in 'params.targets' after 'exclude'"});
            }
            const auto groups = split_ranges(
                effective, static_cast<std::size_t>(task_count(addresses, job.split, wanted, cap)));
            for (const auto& group : groups) {
                Json specs = Json::array();
                for (const Ipv4Range& range : group) {
                    specs.push_back(format_ipv4_range(range));
                }
                // Excludes are already subtracted from every group.
                overrides.push_back({{"targets", std::move(specs)}, {"exclude", Json::array()}});
            }
            break;
        }
        case SplitStrategy::kChunk: {
            const auto targets = params.find("targets");
            if (targets == params.end() || !targets->is_array() || targets->empty()) {
                return std::unexpected(
                    std::string{"split 'chunk' needs a non-empty 'params.targets' array"});
            }
            const std::uint64_t items = targets->size();
            const auto count = task_count(items, job.split, wanted, cap);
            const std::uint64_t base = items / count;
            const std::uint64_t remainder = items % count;
            std::size_t next = 0;
            for (std::uint64_t part = 0; part < count; ++part) {
                const auto size = static_cast<std::size_t>(base + (part < remainder ? 1 : 0));
                Json slice = Json::array();
                for (std::size_t i = 0; i < size; ++i) {
                    slice.push_back((*targets)[next++]);
                }
                overrides.push_back({{"targets", std::move(slice)}});
            }
            break;
        }
    }

    const auto count = static_cast<std::uint32_t>(overrides.size());

    // `rate` is not set here: the scheduler grants each task its share when it starts.
    for (std::uint32_t index = 1; index <= count; ++index) {
        Task task;
        task.index = index;
        task.count = count;
        task.task_id = std::format("{}/{}", job.job_id, index);
        // Envelope first, then the worker's params; params cannot override the envelope.
        task.input = {
            {"job_id", job.job_id},
            {"scan_id", job.scan_id ? Json(*job.scan_id) : Json(nullptr)},
            {"lease_id", job.lease_id ? Json(*job.lease_id) : Json(nullptr)},
            {"task_id", task.task_id},
            {"task_index", index},
            {"task_count", count},
        };
        for (const auto& [key, value] : params.items()) {
            if (!task.input.contains(key)) {
                task.input[key] = value;
            }
        }
        for (const auto& [key, value] : overrides[index - 1].items()) {
            task.input[key] = value;
        }
        plan.tasks.push_back(std::move(task));
    }
    return plan;
}

}  // namespace worker_manager
