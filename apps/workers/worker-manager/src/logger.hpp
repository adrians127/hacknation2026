#pragma once

#include <mutex>
#include <nlohmann/json.hpp>
#include <optional>
#include <string_view>

namespace worker_manager {

enum class LogLevel { kDebug, kInfo, kWarn, kError };
enum class LogFormat { kText, kJson };

[[nodiscard]] std::optional<LogLevel> parse_log_level(std::string_view text);
[[nodiscard]] std::optional<LogFormat> parse_log_format(std::string_view text);

// One line per event to stderr. Thread-safe and never throws, so worker threads and the
// signal thread share one instance.
class Logger {
public:
    using Fields = nlohmann::ordered_json;

    Logger(LogLevel min_level, LogFormat format) noexcept
        : min_level_{min_level}, format_{format} {}

    [[nodiscard]] bool is_enabled(LogLevel level) const noexcept { return level >= min_level_; }

    void log(LogLevel level, std::string_view event, std::string_view message,
             const Fields& fields = Fields::object()) const noexcept;

    void debug(std::string_view event, std::string_view message,
               const Fields& fields = Fields::object()) const noexcept {
        log(LogLevel::kDebug, event, message, fields);
    }
    void info(std::string_view event, std::string_view message,
              const Fields& fields = Fields::object()) const noexcept {
        log(LogLevel::kInfo, event, message, fields);
    }
    void warn(std::string_view event, std::string_view message,
              const Fields& fields = Fields::object()) const noexcept {
        log(LogLevel::kWarn, event, message, fields);
    }
    void error(std::string_view event, std::string_view message,
               const Fields& fields = Fields::object()) const noexcept {
        log(LogLevel::kError, event, message, fields);
    }

    // A line a worker wrote to its stderr, passed through with the task it belongs to.
    // Text: "[task_id] line" unchanged; json: {"event":"worker.output","task_id",...,"line"}.
    void worker_output(std::string_view task_id, std::string_view line) const noexcept;

private:
    void write_line(const std::string& line) const noexcept;

    LogLevel min_level_;
    LogFormat format_;
    mutable std::mutex mutex_;
};

}  // namespace worker_manager
