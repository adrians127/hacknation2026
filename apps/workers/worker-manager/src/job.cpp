#include "job.hpp"

#include <charconv>
#include <format>
#include <set>
#include <system_error>

namespace worker_manager {

namespace {

constexpr std::int64_t kSupportedSchemaVersion = 1;

std::expected<std::optional<std::string>, std::string> optional_string(const Json& object,
                                                                       const char* key) {
    const auto it = object.find(key);
    if (it == object.end() || it->is_null()) {
        return std::nullopt;
    }
    if (!it->is_string() || it->get_ref<const std::string&>().empty()) {
        return std::unexpected(std::format("'{}' must be a non-empty string", key));
    }
    return it->get<std::string>();
}

std::expected<std::optional<std::uint64_t>, std::string> optional_positive(const Json& object,
                                                                           const char* key,
                                                                           std::uint64_t max) {
    const auto it = object.find(key);
    if (it == object.end() || it->is_null()) {
        return std::nullopt;
    }
    if (!it->is_number_unsigned() || it->get<std::uint64_t>() == 0 ||
        it->get<std::uint64_t>() > max) {
        return std::unexpected(std::format("'{}' must be an integer in 1..{}", key, max));
    }
    return it->get<std::uint64_t>();
}

std::expected<SplitPolicy, std::string> parse_split(const Json& job) {
    SplitPolicy policy;
    const auto it = job.find("split");
    if (it == job.end() || it->is_null()) {
        return policy;
    }
    if (!it->is_object()) {
        return std::unexpected(std::string{"'split' must be an object"});
    }
    const auto strategy = optional_string(*it, "strategy");
    if (!strategy) return std::unexpected(strategy.error());
    const std::string name = strategy->value_or("none");
    if (name == "none") {
        policy.strategy = SplitStrategy::kNone;
    } else if (name == "shard") {
        policy.strategy = SplitStrategy::kShard;
    } else if (name == "ranges") {
        policy.strategy = SplitStrategy::kRanges;
    } else if (name == "chunk") {
        policy.strategy = SplitStrategy::kChunk;
    } else {
        return std::unexpected(
            std::format("'split.strategy' must be none, shard, ranges or chunk, got '{}'", name));
    }
    const auto max_tasks = optional_positive(*it, "max_tasks", 1024);
    if (!max_tasks) return std::unexpected(max_tasks.error());
    if (*max_tasks) policy.max_tasks = static_cast<std::uint32_t>(**max_tasks);
    const auto max_items = optional_positive(*it, "max_items_per_task", std::uint64_t{1} << 32);
    if (!max_items) return std::unexpected(max_items.error());
    policy.max_items_per_task = *max_items;
    return policy;
}

std::expected<Job, std::string> parse_job(const Json& entry, std::size_t index) {
    if (!entry.is_object()) {
        return std::unexpected(std::string{"a job must be an object"});
    }
    Job job;
    job.index = index;

    const auto job_id = optional_string(entry, "job_id");
    if (!job_id) return std::unexpected(job_id.error());
    if (!*job_id) return std::unexpected(std::string{"'job_id' is required"});
    if (!is_safe_id(**job_id)) {
        return std::unexpected(
            std::string{"'job_id' may only contain A-Z a-z 0-9 . _ - (max 128, no leading '.')"});
    }
    job.job_id = **job_id;

    const auto scan_id = optional_string(entry, "scan_id");
    if (!scan_id) return std::unexpected(scan_id.error());
    job.scan_id = *scan_id;
    const auto lease_id = optional_string(entry, "lease_id");
    if (!lease_id) return std::unexpected(lease_id.error());
    job.lease_id = *lease_id;

    const auto worker = optional_string(entry, "worker");
    if (!worker) return std::unexpected(worker.error());
    if (!*worker) return std::unexpected(std::string{"'worker' is required"});
    job.worker = **worker;

    const auto deadline = optional_string(entry, "deadline");
    if (!deadline) return std::unexpected(deadline.error());
    if (*deadline) {
        job.deadline = parse_timestamp(**deadline);
        if (!job.deadline) {
            return std::unexpected(
                std::string{"'deadline' must look like 2026-11-21T17:30:00Z (UTC)"});
        }
    }

    auto split = parse_split(entry);
    if (!split) return std::unexpected(split.error());
    job.split = *split;

    const auto params = entry.find("params");
    if (params == entry.end() || !params->is_object()) {
        return std::unexpected(std::string{"'params' must be an object"});
    }
    job.params = *params;
    return job;
}

}  // namespace

std::string_view to_string(SplitStrategy strategy) noexcept {
    switch (strategy) {
        case SplitStrategy::kNone:
            return "none";
        case SplitStrategy::kShard:
            return "shard";
        case SplitStrategy::kRanges:
            return "ranges";
        case SplitStrategy::kChunk:
            return "chunk";
    }
    return "none";
}

std::expected<JobList, std::string> parse_job_list(const Json& document) {
    if (!document.is_object()) {
        return std::unexpected(std::string{"the job list must be a JSON object"});
    }
    if (const auto it = document.find("schema_version"); it != document.end()) {
        if (!it->is_number_integer() || it->get<std::int64_t>() != kSupportedSchemaVersion) {
            return std::unexpected(
                std::format("unsupported 'schema_version' (expected {})", kSupportedSchemaVersion));
        }
    }
    const auto jobs = document.find("jobs");
    if (jobs == document.end() || !jobs->is_array()) {
        return std::unexpected(std::string{"'jobs' must be an array"});
    }

    JobList list;
    std::set<std::string> seen_ids;
    for (std::size_t index = 0; index < jobs->size(); ++index) {
        const Json& entry = (*jobs)[index];
        auto job = parse_job(entry, index);
        if (job && !seen_ids.insert(job->job_id).second) {
            job = std::unexpected(std::format("duplicate 'job_id' '{}'", job->job_id));
        }
        if (job) {
            list.jobs.push_back(std::move(*job));
            continue;
        }
        std::optional<std::string> job_id;
        if (entry.is_object()) {
            if (const auto it = entry.find("job_id"); it != entry.end() && it->is_string()) {
                job_id = it->get<std::string>();
            }
        }
        list.invalid.push_back({index, job_id, job.error()});
    }
    return list;
}

std::optional<SysClock::time_point> parse_timestamp(std::string_view text) {
    // YYYY-MM-DDTHH:MM:SS[.fff]Z
    const auto number = [&](std::size_t offset, std::size_t width) -> std::optional<int> {
        if (offset + width > text.size()) return std::nullopt;
        int value = 0;
        const char* first = text.data() + offset;
        const auto [end, ec] = std::from_chars(first, first + width, value);
        if (ec != std::errc{} || end != first + width) return std::nullopt;
        return value;
    };
    if (text.size() < 20 || text[4] != '-' || text[7] != '-' || text[10] != 'T' ||
        text[13] != ':' || text[16] != ':' || text.back() != 'Z') {
        return std::nullopt;
    }
    const auto year = number(0, 4);
    const auto month = number(5, 2);
    const auto day = number(8, 2);
    const auto hour = number(11, 2);
    const auto minute = number(14, 2);
    const auto second = number(17, 2);
    if (!year || !month || !day || !hour || !minute || !second || *hour > 23 || *minute > 59 ||
        *second > 59) {
        return std::nullopt;
    }
    std::chrono::milliseconds fraction{0};
    std::string_view rest = text.substr(19, text.size() - 20);
    if (!rest.empty()) {
        if (rest.front() != '.' || rest.size() < 2) return std::nullopt;
        rest.remove_prefix(1);
        int scale = 100;
        for (const char digit : rest) {
            if (digit < '0' || digit > '9') return std::nullopt;
            fraction += std::chrono::milliseconds{(digit - '0') * scale};
            scale /= 10;
        }
    }
    const std::chrono::year_month_day date{std::chrono::year{*year},
                                           std::chrono::month{static_cast<unsigned>(*month)},
                                           std::chrono::day{static_cast<unsigned>(*day)}};
    if (!date.ok()) {
        return std::nullopt;
    }
    return std::chrono::sys_days{date} + std::chrono::hours{*hour} + std::chrono::minutes{*minute} +
           std::chrono::seconds{*second} + fraction;
}

std::string format_timestamp(SysClock::time_point time) {
    return std::format("{:%FT%TZ}", std::chrono::floor<std::chrono::milliseconds>(time));
}

bool is_safe_id(std::string_view id) noexcept {
    if (id.empty() || id.size() > 128 || id.front() == '.') {
        return false;
    }
    for (const char c : id) {
        const bool is_allowed = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                                (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '-';
        if (!is_allowed) {
            return false;
        }
    }
    return true;
}

}  // namespace worker_manager
