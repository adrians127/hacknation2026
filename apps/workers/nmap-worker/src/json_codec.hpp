#pragma once

#include "scan_job.hpp"

#include <expected>
#include <string>
#include <string_view>

namespace nmap_worker {

[[nodiscard]] std::expected<ScanJob, Error> parse_scan_job(std::string_view input,
                                                           const ScanLimits& maximum_limits);
[[nodiscard]] std::string serialize_job_result(const JobResult& result);
[[nodiscard]] std::string serialize_error(const Error& error);
[[nodiscard]] std::string serialize_failed_job(std::string_view input, const Error& error,
                                               const ScanLimits& limits);

}  // namespace nmap_worker
