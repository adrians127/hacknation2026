#include "scan_engine.hpp"

#include "nmap_xml.hpp"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <exception>
#include <stop_token>
#include <string>
#include <thread>
#include <vector>

namespace nmap_worker {

JobResult scan_job(const ScanJob& job, const NmapProcessConfig& process_config,
                   std::stop_token stop_token) {
    const auto started = std::chrono::steady_clock::now();
    const auto remaining = job.deadline - std::chrono::system_clock::now();
    const auto deadline =
        started + std::chrono::duration_cast<std::chrono::steady_clock::duration>(remaining);
    JobResult result{.job_id = job.job_id, .lease_id = job.lease_id};
    result.hosts.reserve(job.targets.size());
    for (const auto& target : job.targets) {
        result.hosts.push_back(HostResult{.ip = target.ip, .domain = target.domain});
    }
    std::atomic_size_t next_target{0};
    const auto worker_count = std::min(job.limits.max_parallel, job.targets.size());
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
                    HostResult host{.ip = target.ip, .domain = target.domain};
                    try {
                        const auto process_deadline = std::min(
                            deadline, std::chrono::steady_clock::now() + job.limits.host_timeout);
                        const auto output = run_nmap(target, job.limits, process_config,
                                                     process_deadline, stop_token);
                        if (!output) {
                            host.error = output.error();
                            host.status = output.error().code == "timeout" ? "timeout" : "failed";
                            if (output.error().code == "cancelled") host.status = "cancelled";
                        } else {
                            const auto parsed = parse_nmap_xml(output->xml, target);
                            if (parsed) {
                                host = *parsed;
                            } else {
                                host.error = parsed.error();
                                host.status = "failed";
                            }
                        }
                    } catch (const std::exception& error) {
                        host.error = Error{"internal_error", error.what()};
                        host.status = "failed";
                    } catch (...) {
                        host.error = Error{"internal_error", "Unknown worker error"};
                        host.status = "failed";
                    }
                    result.hosts[index] = std::move(host);
                }
            } catch (...) {
                // Unassigned targets stay pending and can be retried.
            }
        });
    }
    for (auto& thread : threads) thread.join();
    const bool is_complete = std::ranges::all_of(
        result.hosts, [](const HostResult& host) { return host.status == "scanned"; });
    result.status = is_complete ? "completed" : "partial";
    result.duration = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - started);
    return result;
}

}  // namespace nmap_worker
