#pragma once

#include "scan_job.hpp"

#include <chrono>
#include <expected>
#include <stop_token>
#include <string>

namespace nmap_worker {

struct NmapProcessConfig {
    std::string binary = "nmap";
    std::string scan_type = "-sT";
};

struct NmapOutput {
    std::string xml;
    std::string stderr_text;
};

[[nodiscard]] std::expected<NmapOutput, Error> run_nmap(
    const Target& target, const ScanLimits& limits, const NmapProcessConfig& config,
    std::chrono::steady_clock::time_point deadline, std::stop_token stop_token);

}  // namespace nmap_worker
