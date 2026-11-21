#include "report.hpp"

#include <format>
#include <nlohmann/json.hpp>
#include <string_view>

#include "address.hpp"

namespace masscan_worker {

namespace {

using json = nlohmann::ordered_json;

constexpr int kSchemaVersion = 1;

std::string_view to_string(ScanStatus status) {
    switch (status) {
        case ScanStatus::kCompleted:
            return "completed";
        case ScanStatus::kPartial:
            return "partial";
        case ScanStatus::kFailed:
            return "failed";
    }
    return "failed";
}

json to_json(StopReason reason) {
    switch (reason) {
        case StopReason::kNone:
            return nullptr;
        case StopReason::kTimeWindow:
            return "time_window";
        case StopReason::kSignal:
            return "signal";
    }
    return nullptr;
}

std::string iso8601(std::chrono::system_clock::time_point time) {
    return std::format("{:%FT%TZ}", std::chrono::floor<std::chrono::milliseconds>(time));
}

json shard_json(const std::optional<Shard>& shard) {
    if (!shard) {
        return nullptr;
    }
    return {{"index", shard->index}, {"total", shard->total}};
}

json scan_json(const ScanJob& job) {
    json ranges = json::array();
    for (const Ipv4Range& range : job.ranges) {
        ranges.push_back(format_ipv4_range(range));
    }
    const std::uint64_t address_count = count_addresses(job.ranges);
    const std::uint64_t port_count = count_ports(job.ports);
    return {
        {"targets", job.target_specs},
        {"exclude", job.exclude_specs},
        {"effective_ranges", std::move(ranges)},
        {"address_count", address_count},
        {"ports", format_port_ranges(job.ports)},
        {"port_count", port_count},
        {"probe_count", address_count * port_count},
        {"rate", job.rate},
        {"wait_seconds", job.wait.count()},
        {"retries", job.retries},
        {"max_duration_seconds",
         job.max_duration ? json(job.max_duration->count()) : json(nullptr)},
        {"seed", job.seed},
        {"shard", shard_json(job.shard)},
        {"resume_index", job.resume_index},
    };
}

// Fraction of masscan's index space done. masscan interleaves shards over one index space,
// so the per-shard fraction is unknown and left null.
std::optional<double> progress(ScanStatus status, const ScanJob* job, const ScanOutcome* outcome) {
    if (status == ScanStatus::kCompleted) {
        return 1.0;
    }
    if (job == nullptr || outcome == nullptr || !outcome->resume_index || job->shard) {
        return std::nullopt;
    }
    const auto total = static_cast<double>(count_addresses(job->ranges) * count_ports(job->ports));
    return total > 0 ? std::min(1.0, static_cast<double>(*outcome->resume_index) / total)
                     : std::optional<double>{};
}

}  // namespace

json build_report(const ReportInput& input) {
    const ReportTiming& timing = input.timing;
    const auto done = progress(input.status, input.job, input.outcome);

    json timing_json{
        {"started_at", iso8601(timing.started_at)},
        {"finished_at", iso8601(timing.finished_at)},
        {"duration_ms", timing.duration.count()},
        {"progress", done ? json(*done) : json(nullptr)},
        {"addresses_per_second", nullptr},
        {"probes_per_second", nullptr},
    };
    // Measured throughput lets the orchestrator size the next subgroups.
    if (done && input.job != nullptr && timing.duration.count() > 0) {
        const double seconds = std::chrono::duration<double>(timing.duration).count();
        const auto addresses = static_cast<double>(count_addresses(input.job->ranges));
        const auto ports = static_cast<double>(count_ports(input.job->ports));
        timing_json["addresses_per_second"] = addresses * *done / seconds;
        timing_json["probes_per_second"] = addresses * ports * *done / seconds;
    }

    json resume = nullptr;
    if (input.status == ScanStatus::kPartial && input.job != nullptr && input.outcome != nullptr &&
        input.outcome->resume_index) {
        resume = {{"seed", input.job->seed},
                  {"resume_index", *input.outcome->resume_index},
                  {"shard", shard_json(input.job->shard)}};
    }

    json error = nullptr;
    if (input.error) {
        error = {{"code", to_string(input.error->code)}, {"message", input.error->message}};
    }

    return {
        {"schema_version", kSchemaVersion},
        {"job_id", input.job_id},
        {"status", to_string(input.status)},
        {"stop_reason", input.outcome ? to_json(input.outcome->stop_reason) : json(nullptr)},
        {"error", std::move(error)},
        {"worker",
         {{"name", "masscan-worker"},
          {"version", MASSCAN_WORKER_VERSION},
          {"scanner", "masscan"},
          {"scanner_version",
           input.scanner_version ? json(*input.scanner_version) : json(nullptr)}}},
        {"scan", input.job ? scan_json(*input.job) : json(nullptr)},
        {"timing", std::move(timing_json)},
        {"resume", std::move(resume)},
        {"summary",
         {{"hosts_up", input.topology ? input.topology->host_count() : 0},
          {"open_ports", input.topology ? input.topology->open_port_count() : 0},
          {"subnets", input.topology ? input.topology->subnet_count() : 0}}},
        {"topology", input.topology ? input.topology->to_json() : json(nullptr)},
        {"warnings", input.warnings},
    };
}

}  // namespace masscan_worker
