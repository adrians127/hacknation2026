#include "scan_engine.hpp"

#include "nmap_xml.hpp"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <exception>
#include <set>
#include <stop_token>
#include <string>
#include <thread>
#include <vector>

namespace nmap_worker {
namespace {
std::string all_ports(const ScanJob& job) {
    std::set<std::uint16_t> ports;
    for (const auto& target : job.targets)
        ports.insert(target.tcp_ports.begin(), target.tcp_ports.end());
    std::string result;
    for (const auto port : ports) {
        if (!result.empty()) result += ',';
        result += std::to_string(port);
    }
    return result;
}
}  // namespace

JobResult scan_job(const ScanJob& job, const NmapProcessConfig& process_config,
                   std::stop_token stop_token, const std::string& stop_reason) {
    const auto started = std::chrono::steady_clock::now();
    const auto remaining = job.deadline - std::chrono::system_clock::now();
    const auto deadline =
        started + std::chrono::duration_cast<std::chrono::steady_clock::duration>(remaining);
    // A job `rate` is the total for all processes: fewer processes if it is tiny, and each one
    // gets an equal share (never more than the configured per-process maximum).
    ScanLimits limits = job.limits;
    auto worker_count = std::min(limits.max_parallel, job.targets.size());
    if (job.rate) {
        worker_count = std::max<std::size_t>(std::min<std::size_t>(worker_count, *job.rate), 1);
        limits.max_rate_per_process = std::min(
            limits.max_rate_per_process,
            std::max<std::uint32_t>(*job.rate / static_cast<std::uint32_t>(worker_count), 1));
    }
    limits.max_parallel = worker_count;
    JobResult result{.job_id = job.job_id, .lease_id = job.lease_id, .scan_id = job.scan_id,
                     .started_at = std::chrono::system_clock::now(),
                     .subnet = job.subnet, .ports = all_ports(job), .limits = limits,
                     .nmap_args = {"-n", "-Pn", process_config.scan_type, "-sV", "--version-light",
                                   "--max-rate", std::to_string(limits.max_rate_per_process)}};
    result.hosts.reserve(job.targets.size());
    for (const auto& target : job.targets)
        result.hosts.push_back(HostResult{.ip = target.ip, .domains = target.domains});

    std::atomic_size_t next_target{0};
    std::vector<std::jthread> threads;
    threads.reserve(worker_count);
    for (std::size_t worker = 0; worker < worker_count; ++worker) {
        threads.emplace_back([&](std::stop_token thread_stop) noexcept {
            try {
                while (!thread_stop.stop_requested() && !stop_token.stop_requested() &&
                       std::chrono::steady_clock::now() < deadline) {
                    const std::size_t index = next_target.fetch_add(1);
                    if (index >= job.targets.size()) break;
                    const auto& target = job.targets[index];
                    HostResult host{.ip = target.ip, .domains = target.domains};
                    try {
                        const auto process_deadline = std::min(
                            deadline, std::chrono::steady_clock::now() + limits.host_timeout);
                        const auto output = run_nmap(target, limits, process_config,
                                                     process_deadline, stop_token);
                        if (!output) {
                            if (stop_token.stop_requested() ||
                                std::chrono::steady_clock::now() >= deadline ||
                                output.error().code == "cancelled") {
                                host.status = "cancelled";
                            } else if (output.error().code == "timeout") {
                                host.status = "timeout";
                                host.error = Error{"host-timeout", output.error().message};
                                host.observed_at = std::chrono::system_clock::now();
                            } else {
                                host.status = "failed";
                                host.error = output.error();
                                host.observed_at = std::chrono::system_clock::now();
                            }
                        } else {
                            const auto parsed = parse_nmap_xml(output->xml, target);
                            if (parsed) {
                                host = *parsed;
                            } else {
                                host.status = "failed";
                                host.error = parsed.error();
                                host.observed_at = std::chrono::system_clock::now();
                            }
                        }
                    } catch (const std::exception& error) {
                        host.status = "failed";
                        host.error = Error{"internal-error", error.what()};
                        host.observed_at = std::chrono::system_clock::now();
                    } catch (...) {
                        host.status = "failed";
                        host.error = Error{"internal-error", "Unknown worker error"};
                        host.observed_at = std::chrono::system_clock::now();
                    }
                    result.hosts[index] = std::move(host);
                }
            } catch (...) {
                // Unassigned targets remain cancelled.
            }
        });
    }
    for (auto& thread : threads) thread.join();

    for (const auto& host : result.hosts) {
        if (host.nmap_version) {
            result.nmap_version = host.nmap_version;
            break;
        }
    }
    const bool complete = std::ranges::all_of(result.hosts, [](const HostResult& host) {
        return host.status == "up" || host.status == "down";
    });
    result.status = complete ? "completed" : "partial";
    if (!complete) {
        if (stop_token.stop_requested()) result.stop_reason = stop_reason;
        else if (std::chrono::steady_clock::now() >= deadline) result.stop_reason = "deadline";
    }
    const bool all_spawn_failed = std::ranges::all_of(result.hosts, [](const HostResult& host) {
        return host.error && host.error->code == "spawn-failed";
    });
    if (all_spawn_failed) {
        result.status = "failed";
        result.stop_reason = "error";
        result.error = result.hosts.front().error;
    }
    result.finished_at = std::chrono::system_clock::now();
    result.duration = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - started);
    return result;
}

}  // namespace nmap_worker
