#include "config.hpp"

#include <charconv>
#include <cstdlib>
#include <format>
#include <optional>
#include <stdexcept>
#include <string_view>
#include <system_error>

namespace masscan_worker {

namespace {

std::string env_or(const char* name, std::string_view fallback) {
    const char* value = std::getenv(name);
    return (value != nullptr && *value != '\0') ? std::string{value} : std::string{fallback};
}

std::uint64_t env_number(const char* name, std::uint64_t fallback) {
    const char* value = std::getenv(name);
    if (value == nullptr || *value == '\0') {
        return fallback;
    }
    const std::string_view text{value};
    std::uint64_t number = 0;
    const auto [end, ec] = std::from_chars(text.data(), text.data() + text.size(), number);
    if (ec != std::errc{} || end != text.data() + text.size() || number == 0) {
        throw std::runtime_error(
            std::format("{} must be a positive integer, got '{}'", name, text));
    }
    return number;
}

std::uint32_t env_rate(const char* name, std::uint32_t fallback) {
    const std::uint64_t rate = env_number(name, fallback);
    if (rate > 100'000'000) {
        throw std::runtime_error(std::format("{} is unreasonably high: {}", name, rate));
    }
    return static_cast<std::uint32_t>(rate);
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

}  // namespace

Config read_config() {
    Config config{
        .masscan_binary = env_or("MASSCAN_BINARY", "masscan"),
        .default_rate = env_rate("MASSCAN_WORKER_DEFAULT_RATE", 10'000),
        .max_rate = env_rate("MASSCAN_WORKER_MAX_RATE", 100'000),
        .max_target_addresses = env_number("MASSCAN_WORKER_MAX_TARGETS", std::uint64_t{1} << 24),
        .log_level = env_enum<LogLevel>("MASSCAN_WORKER_LOG_LEVEL", "info", parse_log_level),
        .log_format = env_enum<LogFormat>("MASSCAN_WORKER_LOG_FORMAT", "text", parse_log_format),
        .progress_interval =
            std::chrono::seconds{env_number("MASSCAN_WORKER_PROGRESS_INTERVAL", 5)},
    };
    if (config.default_rate > config.max_rate) {
        config.default_rate = config.max_rate;
    }
    return config;
}

}  // namespace masscan_worker
