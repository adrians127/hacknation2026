#include "report.hpp"

#include <format>
#include <nlohmann/json.hpp>
#include <string_view>

#include "address.hpp"

namespace masscan_worker {

namespace {

using json = nlohmann::ordered_json;

// Version of the `masscan` block; the rest follows docs/worker-result-format.md.
constexpr int kSchemaVersion = 2;
constexpr std::string_view kWorkerId = "masscan-worker";

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

json stop_reason_json(ScanStatus status, const ScanOutcome* outcome) {
    if (outcome != nullptr) {
        switch (outcome->stop_reason) {
            case StopReason::kTimeWindow:
                return "deadline";
            case StopReason::kSignal:
                return "stop-requested";
            case StopReason::kNone:
                break;
        }
    }
    return status == ScanStatus::kFailed ? json("error") : json(nullptr);
}

json nullable(const std::optional<std::string>& text) {
    return text && !text->empty() ? json(*text) : json(nullptr);
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

// The job's single CIDR, or null when its ranges are not exactly one aligned subnet.
json subnet_json(const ScanJob& job) {
    if (job.ranges.size() != 1) {
        return nullptr;
    }
    const Ipv4Range& range = job.ranges.front();
    const std::uint64_t size = range.size();
    if ((size & (size - 1)) != 0 || (range.first & (size - 1)) != 0) {
        return nullptr;
    }
    int prefix = 32;
    for (std::uint64_t block = 1; block < size; block <<= 1U) {
        --prefix;
    }
    return format_subnet(range.first, prefix);
}

json params_json(const ScanJob* job) {
    return {
        {"subnet", job ? subnet_json(*job) : json(nullptr)},
        {"ports", job ? json(format_port_ranges(job->ports)) : json(nullptr)},
        {"maxParallel", job ? json(1) : json(nullptr)},  // one masscan process per job
        {"maxRatePerProcess", job ? json(job->rate) : json(nullptr)},
        {"hostTimeoutMs", nullptr},  // masscan has no per-host timeout
        {"httpTimeoutMs", nullptr},  // no HTTP in a SYN sweep
        {"maxBodyBytes", nullptr},
        {"maxRedirects", nullptr},
        {"nmapArgs", json::array()},
    };
}

// hosts[] lists only live hosts: a masscan job can cover millions of addresses. `down` and
// `cancelled` are known only for a completed, unsharded scan that started from index 0.
json counts_json(const ReportInput& input) {
    const std::size_t up = input.topology ? input.topology->host_count() : 0;
    const std::size_t open_ports = input.topology ? input.topology->open_port_count() : 0;
    json addresses = nullptr;
    json down = nullptr;
    json cancelled = nullptr;
    if (input.job != nullptr) {
        const std::uint64_t total = count_addresses(input.job->ranges);
        addresses = total;
        if (input.status == ScanStatus::kCompleted && !input.job->shard &&
            input.job->resume_index == 0) {
            down = total - up;
            cancelled = 0;
        }
    }
    return {
        {"addresses", std::move(addresses)},
        {"up", up},
        {"down", std::move(down)},
        {"timeout", 0},
        {"cancelled", std::move(cancelled)},
        {"failed", 0},
        {"openPorts", open_ports},
        {"httpEndpoints", 0},
        {"httpRequests", 0},
    };
}

json job_json(const ScanJob& job) {
    json ranges = json::array();
    for (const Ipv4Range& range : job.ranges) {
        ranges.push_back(format_ipv4_range(range));
    }
    const std::uint64_t address_count = count_addresses(job.ranges);
    const std::uint64_t port_count = count_ports(job.ports);
    return {
        {"targets", job.target_specs},
        {"exclude", job.exclude_specs},
        {"effectiveRanges", std::move(ranges)},
        {"portCount", port_count},
        {"probeCount", address_count * port_count},
        {"rate", job.rate},
        {"waitSeconds", job.wait.count()},
        {"retries", job.retries},
        {"maxDurationSeconds", job.max_duration ? json(job.max_duration->count()) : json(nullptr)},
        {"groupPrefix", job.group_prefix},
        {"seed", job.seed},
        {"shard", shard_json(job.shard)},
        {"resumeIndex", job.resume_index},
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

json masscan_json(const ReportInput& input) {
    const ReportTiming& timing = input.timing;
    const auto done = progress(input.status, input.job, input.outcome);

    // Measured throughput lets the orchestrator size the next subgroups.
    json addresses_per_second = nullptr;
    json probes_per_second = nullptr;
    if (done && input.job != nullptr && timing.duration.count() > 0) {
        const double seconds = std::chrono::duration<double>(timing.duration).count();
        const auto addresses = static_cast<double>(count_addresses(input.job->ranges));
        const auto ports = static_cast<double>(count_ports(input.job->ports));
        addresses_per_second = addresses * *done / seconds;
        probes_per_second = addresses * ports * *done / seconds;
    }

    json resume = nullptr;
    if (input.status == ScanStatus::kPartial && input.job != nullptr && input.outcome != nullptr &&
        input.outcome->resume_index) {
        resume = {{"seed", input.job->seed},
                  {"resumeIndex", *input.outcome->resume_index},
                  {"shard", shard_json(input.job->shard)}};
    }

    return {
        {"schemaVersion", kSchemaVersion},
        {"scannerVersion", nullable(input.scanner_version)},
        {"job", input.job ? job_json(*input.job) : json(nullptr)},
        {"progress", done ? json(*done) : json(nullptr)},
        {"addressesPerSecond", std::move(addresses_per_second)},
        {"probesPerSecond", std::move(probes_per_second)},
        {"resume", std::move(resume)},
        {"topology", input.topology ? input.topology->to_json() : json(nullptr)},
        {"warnings", input.warnings},
    };
}

}  // namespace

json build_report(const ReportInput& input) {
    const ReportTiming& timing = input.timing;

    json error = nullptr;
    if (input.error) {
        error = {{"code", to_string(input.error->code)}, {"message", input.error->message}};
    }

    json scan{
        {"jobId", nullable(input.job_id)},
        {"leaseId", nullable(input.job ? input.job->lease_id : input.lease_id)},
        {"scanId", nullable(input.job ? input.job->scan_id : input.scan_id)},
        {"worker",
         {{"id", kWorkerId}, {"version", MASSCAN_WORKER_VERSION}, {"nmapVersion", nullptr}}},
        {"status", to_string(input.status)},
        {"stopReason", stop_reason_json(input.status, input.outcome)},
        {"startedAt", iso8601(timing.started_at)},
        {"finishedAt", iso8601(timing.finished_at)},
        {"durationMs", timing.duration.count()},
        // A SYN sweep finds hosts and ports in the same pass; it is counted as the port scan.
        {"phasesMs",
         {{"hostDiscovery", 0},
          {"portScan", timing.scan_duration.count()},
          {"serviceDetection", 0},
          {"http", 0}}},
        {"params", params_json(input.job)},
        {"counts", counts_json(input)},
        {"error", std::move(error)},
    };

    return {
        {"scan", std::move(scan)},
        {"hosts", input.topology ? input.topology->hosts_json() : json::array()},
        {"masscan", masscan_json(input)},
    };
}

}  // namespace masscan_worker
