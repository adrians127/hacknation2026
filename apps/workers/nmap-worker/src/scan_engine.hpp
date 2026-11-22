#pragma once

#include "nmap_process.hpp"
#include "scan_job.hpp"

#include <stop_token>
#include <string>

namespace nmap_worker {

// `stop_reason` is reported when `stop_token` ends the scan early: "lease-lost" in HTTP mode,
// "stop-requested" for SIGINT/SIGTERM in file mode.
[[nodiscard]] JobResult scan_job(const ScanJob& job, const NmapProcessConfig& process_config,
                                 std::stop_token stop_token, const std::string& stop_reason);

}  // namespace nmap_worker
