#include "http_client.hpp"
#include "json_codec.hpp"
#include "nmap_process.hpp"
#include "scan_engine.hpp"

#include <curl/curl.h>
#include <nlohmann/json.hpp>

#include <charconv>
#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <exception>
#include <expected>
#include <fstream>
#include <iterator>
#include <print>
#include <stop_token>
#include <string>
#include <string_view>
#include <thread>

namespace nmap_worker {
namespace {

class CurlGlobal {
public:
    CurlGlobal() : error_(curl_global_init(CURL_GLOBAL_DEFAULT)) {}
    CurlGlobal(const CurlGlobal&) = delete;
    CurlGlobal& operator=(const CurlGlobal&) = delete;
    ~CurlGlobal() noexcept {
        if (error_ == CURLE_OK) curl_global_cleanup();
    }
    [[nodiscard]] bool is_valid() const noexcept { return error_ == CURLE_OK; }

private:
    CURLcode error_;
};

std::string env_or(const char* name, std::string_view fallback) {
    const char* value = std::getenv(name);
    return value != nullptr && *value != '\0' ? std::string{value} : std::string{fallback};
}

std::expected<long, Error> env_positive(const char* name, long fallback, long maximum) {
    const char* value = std::getenv(name);
    if (value == nullptr || *value == '\0') return fallback;
    const std::string_view text{value};
    long number = 0;
    const auto [end, error] = std::from_chars(text.data(), text.data() + text.size(), number);
    if (error != std::errc{} || end != text.data() + text.size() || number < 1 ||
        number > maximum) {
        return std::unexpected(Error{"invalid_config", std::string{"Invalid variable: "} + name});
    }
    return number;
}

struct WorkerConfig {
    ScanLimits maximum_limits;
    NmapProcessConfig process;
    std::string backend_url;
    std::string token;
    std::chrono::milliseconds poll_interval{3000};
    std::chrono::milliseconds heartbeat_interval{5000};
};

std::expected<WorkerConfig, Error> read_config() {
    WorkerConfig config;
    const auto parallel = env_positive("NMAP_MAX_PARALLEL", 2, 64);
    const auto rate = env_positive("NMAP_MAX_RATE_PER_PROCESS", 50, 1000000);
    const auto timeout = env_positive("NMAP_HOST_TIMEOUT_MS", 120000, 3600000);
    const auto poll = env_positive("WORKER_POLL_INTERVAL_MS", 3000, 60000);
    const auto heartbeat = env_positive("WORKER_HEARTBEAT_INTERVAL_MS", 5000, 60000);
    if (!parallel) return std::unexpected(parallel.error());
    if (!rate) return std::unexpected(rate.error());
    if (!timeout) return std::unexpected(timeout.error());
    if (!poll) return std::unexpected(poll.error());
    if (!heartbeat) return std::unexpected(heartbeat.error());
    config.maximum_limits.max_parallel = static_cast<std::size_t>(*parallel);
    config.maximum_limits.max_rate_per_process = static_cast<std::uint32_t>(*rate);
    config.maximum_limits.host_timeout = std::chrono::milliseconds{*timeout};
    config.poll_interval = std::chrono::milliseconds{*poll};
    config.heartbeat_interval = std::chrono::milliseconds{*heartbeat};
    config.backend_url = env_or("BACKEND_URL", "http://localhost:3001/v1");
    config.token = env_or("WORKER_TOKEN", "");
    config.process.binary = env_or("NMAP_BINARY", "nmap");
    const auto scan_type = env_or("NMAP_SCAN_TYPE", "connect");
    if (scan_type == "connect") {
        config.process.scan_type = "-sT";
    } else if (scan_type == "syn") {
        config.process.scan_type = "-sS";
    } else {
        return std::unexpected(Error{"invalid_config", "NMAP_SCAN_TYPE must be connect or syn"});
    }
    return config;
}

std::expected<std::string, Error> read_job_file(std::string_view path) {
    std::ifstream stream{std::string{path}, std::ios::binary | std::ios::ate};
    if (!stream) return std::unexpected(Error{"file_failed", "Cannot open job file"});
    const auto size = stream.tellg();
    if (size < 0 || size > 4 * 1024 * 1024) {
        return std::unexpected(Error{"file_failed", "Job file exceeds 4 MiB"});
    }
    stream.seekg(0);
    return std::string{std::istreambuf_iterator<char>{stream}, std::istreambuf_iterator<char>{}};
}

int run_file_mode(std::string_view path, const WorkerConfig& config) {
    const auto input = read_job_file(path);
    if (!input) {
        std::println("{}", serialize_error(input.error()));
        return EXIT_FAILURE;
    }
    const auto job = parse_scan_job(*input, config.maximum_limits);
    if (!job) {
        std::println("{}", serialize_error(job.error()));
        return EXIT_FAILURE;
    }
    const auto result = scan_job(*job, config.process, std::stop_token{});
    std::println("{}", serialize_job_result(result));
    return result.status == "completed" ? EXIT_SUCCESS : EXIT_FAILURE;
}

void wait_interval(std::chrono::milliseconds duration, std::stop_token stop_token) {
    const auto until = std::chrono::steady_clock::now() + duration;
    while (!stop_token.stop_requested() && std::chrono::steady_clock::now() < until) {
        std::this_thread::sleep_for(std::chrono::milliseconds{100});
    }
}

void run_http_mode(const WorkerConfig& config) {
    const HttpClient client{config.backend_url, config.token};
    while (true) {
        const auto lease = client.post("/workers/nmap/lease", "{}");
        if (!lease) {
            std::println(stderr, "lease error: {}", lease.error().message);
            wait_interval(config.poll_interval, std::stop_token{});
            continue;
        }
        if (lease->status == 204) {
            wait_interval(config.poll_interval, std::stop_token{});
            continue;
        }
        if (lease->status != 200) {
            std::println(stderr, "lease HTTP status: {}", lease->status);
            wait_interval(config.poll_interval, std::stop_token{});
            continue;
        }
        const auto job = parse_scan_job(lease->body, config.maximum_limits);
        if (!job) {
            std::println(stderr, "invalid lease: {}", job.error().message);
            wait_interval(config.poll_interval, std::stop_token{});
            continue;
        }
        std::stop_source scan_stop;
        const std::string heartbeat_body =
            nlohmann::json{{"job_id", job->job_id}, {"lease_id", job->lease_id}}.dump();
        std::jthread heartbeat([&](std::stop_token thread_stop) {
            try {
                while (!thread_stop.stop_requested()) {
                    wait_interval(config.heartbeat_interval, thread_stop);
                    if (thread_stop.stop_requested()) break;
                    const auto response = client.post("/workers/nmap/heartbeat", heartbeat_body);
                    if (!response || response->status < 200 || response->status >= 300) {
                        scan_stop.request_stop();
                        break;
                    }
                }
            } catch (...) {
                scan_stop.request_stop();
            }
        });
        const auto result = scan_job(*job, config.process, scan_stop.get_token());
        const std::string body = serialize_job_result(result);
        bool is_sent = false;
        for (int attempt = 0; attempt < 3 && !is_sent; ++attempt) {
            const auto response = client.post("/workers/nmap/results", body);
            is_sent = response && response->status >= 200 && response->status < 300;
            if (!is_sent) wait_interval(std::chrono::seconds{2}, std::stop_token{});
        }
        heartbeat.request_stop();
        heartbeat.join();
        if (!is_sent) std::println(stderr, "result delivery failed for job {}", job->job_id);
    }
}

}  // namespace
}  // namespace nmap_worker

int main(int argc, char* argv[]) {
    try {
        const auto config = nmap_worker::read_config();
        if (!config) {
            std::println(stderr, "configuration error: {}", config.error().message);
            return EXIT_FAILURE;
        }
        if (argc == 3 && std::string_view{argv[1]} == "--job-file") {
            return nmap_worker::run_file_mode(argv[2], *config);
        }
        if (argc != 1) {
            std::println(stderr, "usage: nmap-worker [--job-file path]");
            return EXIT_FAILURE;
        }
        if (config->token.empty()) {
            std::println(stderr, "WORKER_TOKEN is required in HTTP mode");
            return EXIT_FAILURE;
        }
        const nmap_worker::CurlGlobal curl_global;
        if (!curl_global.is_valid()) {
            std::println(stderr, "curl initialization failed");
            return EXIT_FAILURE;
        }
        std::println(stderr, "nmap-worker {} polling {}", NMAP_WORKER_VERSION, config->backend_url);
        nmap_worker::run_http_mode(*config);
    } catch (const std::exception& error) {
        std::println(stderr, "fatal: {}", error.what());
        return EXIT_FAILURE;
    } catch (...) {
        std::println(stderr, "fatal: unknown error");
        return EXIT_FAILURE;
    }
    return EXIT_SUCCESS;
}
