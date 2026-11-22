#include "config.hpp"

#include <unistd.h>

#include <algorithm>
#include <array>
#include <charconv>
#include <cstdlib>
#include <format>
#include <optional>
#include <stdexcept>
#include <string_view>
#include <system_error>

#include "job.hpp"

namespace worker_manager {

namespace {

std::string env_or(const char* name, std::string_view fallback) {
    const char* value = std::getenv(name);
    return (value != nullptr && *value != '\0') ? std::string{value} : std::string{fallback};
}

std::uint32_t env_number(const char* name, std::uint32_t fallback, std::uint32_t min,
                         std::uint32_t max) {
    const char* value = std::getenv(name);
    if (value == nullptr || *value == '\0') {
        return fallback;
    }
    const std::string_view text{value};
    std::uint32_t number = 0;
    const auto [end, ec] = std::from_chars(text.data(), text.data() + text.size(), number);
    if (ec != std::errc{} || end != text.data() + text.size() || number < min || number > max) {
        throw std::runtime_error(
            std::format("{} must be an integer in {}..{}, got '{}'", name, min, max, text));
    }
    return number;
}

template <typename T>
T env_enum(const char* name, std::string_view fallback,
           std::optional<T> (*parse)(std::string_view)) {
    const std::string text = env_or(name, fallback);
    const auto value = parse(text);
    if (!value) {
        throw std::runtime_error(std::format("{} has an unknown value: '{}'", name, text));
    }
    return *value;
}

std::string_view trim(std::string_view text) {
    while (!text.empty() && text.front() == ' ') text.remove_prefix(1);
    while (!text.empty() && text.back() == ' ') text.remove_suffix(1);
    return text;
}

std::string manager_id() {
    std::string id = env_or("WORKER_MANAGER_ID", "");
    if (id.empty()) {
        std::array<char, 256> host{};
        id = ::gethostname(host.data(), host.size() - 1) == 0 ? std::string{host.data()}
                                                              : std::string{"worker-manager"};
    }
    if (!is_safe_id(id)) {
        throw std::runtime_error(std::format(
            "WORKER_MANAGER_ID may only contain A-Z a-z 0-9 . _ - (max 128), got '{}'", id));
    }
    return id;
}

}  // namespace

std::string parse_backend_url(std::string_view text) {
    const bool has_scheme = text.starts_with("http://") || text.starts_with("https://");
    const auto host_start = text.find("://") + 3;
    if (!has_scheme || host_start >= text.size() || text[host_start] == '/' ||
        text.find_first_of(" \t\r\n") != std::string_view::npos) {
        throw std::runtime_error(std::format(
            "WORKER_MANAGER_BACKEND_URL must be an http:// or https:// URL, got '{}'", text));
    }
    while (text.ends_with('/')) text.remove_suffix(1);
    return std::string{text};
}

std::vector<WorkerBinary> parse_worker_binaries(std::string_view text) {
    std::vector<WorkerBinary> workers;
    while (!text.empty()) {
        const auto comma = text.find(',');
        const std::string_view item = trim(text.substr(0, comma));
        text = comma == std::string_view::npos ? std::string_view{} : text.substr(comma + 1);
        if (item.empty()) {
            continue;
        }
        const auto equals = item.find('=');
        if (equals == std::string_view::npos) {
            throw std::runtime_error(
                std::format("WORKER_MANAGER_WORKERS: '{}' is not name=binary", item));
        }
        const std::string_view name = trim(item.substr(0, equals));
        const std::string_view binary = trim(item.substr(equals + 1));
        if (name.empty() || binary.empty()) {
            throw std::runtime_error(
                std::format("WORKER_MANAGER_WORKERS: '{}' is not name=binary", item));
        }
        for (const WorkerBinary& existing : workers) {
            if (existing.name == name) {
                throw std::runtime_error(
                    std::format("WORKER_MANAGER_WORKERS: '{}' is listed twice", name));
            }
        }
        workers.push_back({std::string{name}, std::string{binary}});
    }
    if (workers.empty()) {
        throw std::runtime_error("WORKER_MANAGER_WORKERS must list at least one worker");
    }
    return workers;
}

std::vector<WorkerRateCap> parse_worker_rate_caps(std::string_view text) {
    std::vector<WorkerRateCap> caps;
    while (!text.empty()) {
        const auto comma = text.find(',');
        const std::string_view item = trim(text.substr(0, comma));
        text = comma == std::string_view::npos ? std::string_view{} : text.substr(comma + 1);
        if (item.empty()) continue;
        const auto equals = item.find('=');
        const std::string_view name = trim(item.substr(0, equals));
        const std::string_view number =
            equals == std::string_view::npos ? std::string_view{} : trim(item.substr(equals + 1));
        std::uint64_t rate = 0;
        const auto [end, ec] = std::from_chars(number.data(), number.data() + number.size(), rate);
        if (name.empty() || number.empty() || ec != std::errc{} ||
            end != number.data() + number.size() || rate == 0) {
            throw std::runtime_error(std::format(
                "WORKER_MANAGER_WORKER_MAX_RATE: '{}' is not name=packets-per-second", item));
        }
        caps.push_back({std::string{name}, rate});
    }
    return caps;
}

std::vector<std::string> parse_stages(std::string_view text) {
    std::vector<std::string> stages;
    while (!text.empty()) {
        const auto comma = text.find(',');
        const std::string name{trim(text.substr(0, comma))};
        text = comma == std::string_view::npos ? std::string_view{} : text.substr(comma + 1);
        if (name.empty() || std::ranges::find(stages, name) != stages.end()) {
            throw std::runtime_error(
                std::format("WORKER_MANAGER_STAGES: empty or repeated worker name '{}'", name));
        }
        stages.push_back(name);
    }
    return stages;
}

Config read_config() {
    return Config{
        .workers =
            parse_worker_binaries(env_or("WORKER_MANAGER_WORKERS", "masscan=masscan-worker")),
        .worker_rate_caps =
            parse_worker_rate_caps(env_or("WORKER_MANAGER_WORKER_MAX_RATE", "nmap=100")),
        .stages = parse_stages(env_or("WORKER_MANAGER_STAGES", "masscan,nmap")),
        .max_parallel = env_number("WORKER_MANAGER_MAX_PARALLEL", 2, 1, 256),
        .max_rate = env_number("WORKER_MANAGER_MAX_RATE", 100'000, 1, 100'000'000),
        .min_task_rate = env_number("WORKER_MANAGER_MIN_TASK_RATE", 1'000, 1, 100'000'000),
        .max_tasks_per_job = env_number("WORKER_MANAGER_MAX_TASKS_PER_JOB", 16, 1, 1024),
        .deadline_margin =
            std::chrono::seconds{env_number("WORKER_MANAGER_DEADLINE_MARGIN", 10, 0, 3600)},
        .kill_grace = std::chrono::seconds{env_number("WORKER_MANAGER_KILL_GRACE", 30, 1, 3600)},
        .log_level = env_enum<LogLevel>("WORKER_MANAGER_LOG_LEVEL", "info", parse_log_level),
        .log_format = env_enum<LogFormat>("WORKER_MANAGER_LOG_FORMAT", "text", parse_log_format),
        .backend =
            {
                .url = parse_backend_url(
                    env_or("WORKER_MANAGER_BACKEND_URL", "http://localhost:3001/v1")),
                .token = env_or("WORKER_MANAGER_TOKEN", ""),
                .manager_id = manager_id(),
                .poll_wait =
                    std::chrono::seconds{env_number("WORKER_MANAGER_POLL_WAIT", 30, 1, 300)},
                .retry_delay =
                    std::chrono::seconds{env_number("WORKER_MANAGER_RETRY_DELAY", 5, 1, 3600)},
                .upload_attempts = env_number("WORKER_MANAGER_UPLOAD_ATTEMPTS", 5, 1, 100),
            },
    };
}

}  // namespace worker_manager
