#pragma once

#include <chrono>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace nmap_worker {

struct Error {
    std::string code{};
    std::string message{};
};

struct Target {
    std::string ip{};
    std::vector<std::string> domains{};
    std::vector<std::uint16_t> tcp_ports{};
};

struct ScanLimits {
    std::size_t max_parallel = 2;
    std::uint32_t max_rate_per_process = 50;
    std::chrono::milliseconds host_timeout{120000};
    std::chrono::milliseconds http_timeout{10000};
    std::size_t max_body_bytes = 524288;
    std::size_t max_redirects = 5;
};

struct ScanJob {
    std::string job_id{};
    std::string lease_id{};
    std::string scan_id{};
    std::string subnet{};
    // The earlier of `deadline` and now + `max_duration_seconds`.
    std::chrono::system_clock::time_point deadline{};
    ScanLimits limits{};
    // Total packets per second for the job (worker-manager's shared `rate`), split across the
    // parallel Nmap processes; it only ever lowers `limits`.
    std::optional<std::uint32_t> rate{};
    std::vector<std::string> probe_paths{};
    std::vector<Target> targets{};
};

struct ScriptObservation {
    std::string id{};
    std::string output{};
};

struct ServiceObservation {
    std::string name{};
    std::optional<std::string> product{};
    std::optional<std::string> version{};
    std::optional<std::string> extra_info{};
    std::vector<std::string> cpe{};
    std::string method = "table";
    int confidence = 0;
};

struct PortObservation {
    std::uint16_t number = 0;
    std::string protocol = "tcp";
    std::string state = "open";
    std::optional<std::string> reason{};
    std::optional<int> ttl{};
    std::optional<ServiceObservation> service{};
    std::vector<ScriptObservation> scripts{};
};

struct HostResult {
    std::string ip{};
    std::vector<std::string> domains{};
    std::vector<std::string> ptr_names{};
    std::string status = "cancelled";
    std::optional<std::string> reason{};
    std::optional<std::chrono::system_clock::time_point> observed_at{};
    std::optional<std::int64_t> latency_ms{};
    std::optional<std::string> nmap_version{};
    std::vector<PortObservation> ports{};
    std::optional<Error> error{};
};

struct JobResult {
    std::string job_id{};
    std::string lease_id{};
    std::string scan_id{};
    std::string status{};
    std::optional<std::string> stop_reason{};
    std::optional<Error> error{};
    std::vector<HostResult> hosts{};
    std::chrono::milliseconds duration{0};
    std::chrono::system_clock::time_point started_at{};
    std::chrono::system_clock::time_point finished_at{};
    std::optional<std::string> nmap_version{};
    std::string subnet{};
    std::string ports{};
    ScanLimits limits{};
    std::vector<std::string> nmap_args{};
};

}  // namespace nmap_worker
