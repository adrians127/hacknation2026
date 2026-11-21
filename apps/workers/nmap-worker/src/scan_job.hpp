#pragma once

#include <chrono>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace nmap_worker {

struct Error {
    std::string code;
    std::string message;
};

struct Target {
    std::string ip;
    std::optional<std::string> domain;
    std::vector<std::uint16_t> tcp_ports;
};

struct ScanLimits {
    std::size_t max_parallel = 2;
    std::uint32_t max_rate_per_process = 50;
    std::chrono::milliseconds host_timeout{120000};
};

struct ScanJob {
    std::string job_id;
    std::string lease_id;
    std::string subnet;
    std::chrono::system_clock::time_point deadline;
    ScanLimits limits;
    std::vector<Target> targets;
};

struct ScriptObservation {
    std::string id;
    std::string output;
};

struct ServiceObservation {
    std::string name;
    std::string product;
    std::string version;
    std::vector<std::string> cpe;
};

struct PortObservation {
    std::uint16_t number = 0;
    std::string protocol = "tcp";
    std::string state;
    std::optional<ServiceObservation> service;
    std::vector<ScriptObservation> scripts;
};

struct HostResult {
    std::string ip;
    std::optional<std::string> domain;
    std::string status = "pending";
    std::vector<PortObservation> ports;
    std::optional<Error> error;
};

struct JobResult {
    std::string job_id;
    std::string lease_id;
    std::string status;
    std::vector<HostResult> hosts;
    std::chrono::milliseconds duration{0};
};

}  // namespace nmap_worker
