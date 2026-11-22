#include "logger.hpp"

#include <chrono>
#include <cstdio>
#include <format>
#include <print>
#include <string>

namespace worker_manager {

namespace {

using Json = nlohmann::ordered_json;

std::string_view level_name(LogLevel level) {
    switch (level) {
        case LogLevel::kDebug:
            return "debug";
        case LogLevel::kInfo:
            return "info";
        case LogLevel::kWarn:
            return "warn";
        case LogLevel::kError:
            return "error";
    }
    return "info";
}

// Worker output is not guaranteed UTF-8; replace instead of throwing.
std::string dump(const Json& value) {
    return value.dump(-1, ' ', false, Json::error_handler_t::replace);
}

std::string text_value(const Json& value) {
    if (value.is_string()) {
        const auto& text = value.get_ref<const std::string&>();
        const bool needs_quotes = text.empty() || text.find_first_of(" \"=") != std::string::npos;
        return needs_quotes ? dump(value) : text;
    }
    return dump(value);
}

std::string timestamp() {
    return std::format("{:%FT%TZ}", std::chrono::floor<std::chrono::milliseconds>(
                                        std::chrono::system_clock::now()));
}

}  // namespace

std::optional<LogLevel> parse_log_level(std::string_view text) {
    if (text == "debug") return LogLevel::kDebug;
    if (text == "info") return LogLevel::kInfo;
    if (text == "warn" || text == "warning") return LogLevel::kWarn;
    if (text == "error") return LogLevel::kError;
    return std::nullopt;
}

std::optional<LogFormat> parse_log_format(std::string_view text) {
    if (text == "text") return LogFormat::kText;
    if (text == "json") return LogFormat::kJson;
    return std::nullopt;
}

void Logger::write_line(const std::string& line) const noexcept {
    try {
        const std::scoped_lock lock{mutex_};
        std::println(stderr, "{}", line);
        std::fflush(stderr);
    } catch (...) {
    }
}

void Logger::log(LogLevel level, std::string_view event, std::string_view message,
                 const Fields& fields) const noexcept {
    if (!is_enabled(level)) {
        return;
    }
    try {
        std::string line;
        if (format_ == LogFormat::kJson) {
            Json record{{"ts", timestamp()},
                        {"level", level_name(level)},
                        {"event", event},
                        {"msg", message}};
            if (fields.is_object()) {
                for (const auto& [key, value] : fields.items()) {
                    record[key] = value;
                }
            }
            line = dump(record);
        } else {
            line = std::format("{} {:<5} {}", timestamp(), level_name(level), message);
            if (fields.is_object()) {
                for (const auto& [key, value] : fields.items()) {
                    line += std::format(" {}={}", key, text_value(value));
                }
            }
        }
        write_line(line);
    } catch (...) {
        // Logging must never take the manager down.
    }
}

void Logger::worker_output(std::string_view task_id, std::string_view line) const noexcept {
    if (!is_enabled(LogLevel::kInfo)) {
        return;
    }
    try {
        if (format_ == LogFormat::kJson) {
            write_line(dump(Json{{"ts", timestamp()},
                                 {"level", "info"},
                                 {"event", "worker.output"},
                                 {"task_id", task_id},
                                 {"line", line}}));
        } else {
            write_line(std::format("[{}] {}", task_id, line));
        }
    } catch (...) {
    }
}

}  // namespace worker_manager
