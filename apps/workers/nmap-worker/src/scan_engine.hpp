#pragma once

#include "nmap_process.hpp"
#include "scan_job.hpp"

#include <stop_token>

namespace nmap_worker {

[[nodiscard]] JobResult scan_job(const ScanJob& job, const NmapProcessConfig& process_config,
                                 std::stop_token stop_token);

}  // namespace nmap_worker
