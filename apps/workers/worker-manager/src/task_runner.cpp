#include "task_runner.hpp"

#include <fcntl.h>
#include <poll.h>
#include <unistd.h>

#include <algorithm>
#include <array>
#include <cerrno>
#include <csignal>
#include <cstring>
#include <format>
#include <vector>

#include "files.hpp"
#include "process.hpp"

namespace worker_manager {

namespace {

using SteadyClock = std::chrono::steady_clock;

constexpr auto kPollInterval = std::chrono::milliseconds{250};
constexpr auto kTermToKill = std::chrono::seconds{10};
// After SIGKILL, stop waiting for EOF: a grandchild may still hold the pipe open.
constexpr auto kKillToGiveUp = std::chrono::seconds{5};
constexpr int kExecFailed = 127;
// The longest max_duration_seconds every worker accepts (masscan-worker and nmap-worker).
constexpr auto kMaxWorkerDuration = std::chrono::seconds{7 * 24 * 3600};

TaskStatus status_from_result(const Json& result) {
    const auto scan = result.find("scan");
    if (scan == result.end() || !scan->is_object()) return TaskStatus::kFailed;
    const auto status = scan->find("status");
    if (status == scan->end() || !status->is_string()) return TaskStatus::kFailed;
    if (*status == "completed") return TaskStatus::kCompleted;
    if (*status == "partial") return TaskStatus::kPartial;
    return TaskStatus::kFailed;
}

// Splits worker output into lines for the log passthrough; the raw bytes go to the .log file.
class LineForwarder {
public:
    LineForwarder(const Logger& logger, std::string_view task_id)
        : logger_{logger}, task_id_{task_id} {}

    void append(std::string_view chunk) {
        pending_.append(chunk);
        std::size_t start = 0;
        for (std::size_t newline = pending_.find('\n'); newline != std::string::npos;
             newline = pending_.find('\n', start)) {
            emit(std::string_view{pending_}.substr(start, newline - start));
            start = newline + 1;
        }
        pending_.erase(0, start);
    }

    void flush() {
        if (!pending_.empty()) {
            emit(pending_);
            pending_.clear();
        }
    }

private:
    void emit(std::string_view line) {
        if (!line.empty() && line.back() == '\r') line.remove_suffix(1);
        if (!line.empty()) logger_.worker_output(task_id_, line);
    }

    const Logger& logger_;
    std::string_view task_id_;
    std::string pending_;
};

TaskOutcome run_task_impl(const TaskContext& context, const Logger& logger) {
    const Task& task = context.task;
    TaskOutcome outcome;
    const auto fields = [&](Logger::Fields extra = Logger::Fields::object()) {
        Logger::Fields result{{"task_id", task.task_id}};
        for (const auto& [key, value] : extra.items()) result[key] = value;
        return result;
    };
    const auto fail = [&](std::string code, std::string message) {
        logger.error("task.failed", message, fields({{"error", code}}));
        outcome.status = TaskStatus::kFailed;
        outcome.error_code = std::move(code);
        outcome.error_message = std::move(message);
        outcome.finished_at = SysClock::now();
        return outcome;
    };

    if (context.stop.stop_requested()) {
        logger.info("task.cancelled", "task cancelled before it started", fields());
        outcome.status = TaskStatus::kCancelled;
        return outcome;
    }
    const auto now = SysClock::now();
    outcome.started_at = now;

    Json input = task.input;
    input["rate"] = context.rate;
    std::optional<std::chrono::seconds> time_limit;
    if (const auto it = input.find("max_duration_seconds");
        it != input.end() && it->is_number_unsigned()) {
        time_limit = std::chrono::seconds{it->get<std::int64_t>()};
    }
    if (context.job.deadline) {
        const auto remaining =
            std::chrono::floor<std::chrono::seconds>(*context.job.deadline - now) -
            context.deadline_margin;
        if (remaining.count() <= 0) {
            return fail("deadline-exceeded", std::format("job deadline {} has passed (margin {})",
                                                         format_timestamp(*context.job.deadline),
                                                         context.deadline_margin));
        }
        const auto window = std::min(remaining, kMaxWorkerDuration);
        if (!time_limit || window < *time_limit) {
            time_limit = window;
            input["max_duration_seconds"] = window.count();
        }
    }

    const std::string stem = task_file_stem(task.index);
    const auto input_path = context.job_dir / (stem + ".input.json");
    const auto result_path = context.job_dir / (stem + ".result.json");
    const auto log_path = context.job_dir / (stem + ".log");
    if (!write_json_file(input_path, input)) {
        return fail("io-error", std::format("cannot write '{}'", input_path.string()));
    }
    const UniqueFd log_file{
        ::open(log_path.c_str(), O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0644)};
    if (!log_file.is_valid()) {
        return fail("io-error",
                    std::format("cannot write '{}': {}", log_path.string(), std::strerror(errno)));
    }
    auto pipe = make_pipe();
    if (!pipe) return fail("io-error", pipe.error());

    const std::vector<std::string> argv{context.binary.string(), "--input", input_path.string(),
                                        "--output", result_path.string()};
    auto child = spawn_process(
        {.argv = argv, .stdout_fd = pipe->write_end.get(), .stderr_fd = pipe->write_end.get()});
    if (!child) return fail("worker-unavailable", child.error());
    pipe->write_end.reset();
    logger.info(
        "task.started", "worker started",
        fields({{"worker", context.job.worker},
                {"pid", child->pid()},
                {"task", std::format("{}/{}", task.index, task.count)},
                {"rate_pps", context.rate},
                {"max_duration_s", time_limit ? Json(time_limit->count()) : Json(nullptr)}}));

    const auto hard_limit =
        time_limit ? std::optional{SteadyClock::now() + *time_limit + context.kill_grace}
                   : std::nullopt;
    std::optional<SteadyClock::time_point> term_sent_at;
    std::optional<SteadyClock::time_point> kill_sent_at;
    {
        // Scoped to the read loop: the callbacks run on the signal thread and must be gone
        // before wait() touches the child.
        const std::stop_callback on_stop{context.stop, [&] { child->send_signal(SIGTERM); }};
        const std::stop_callback on_force{context.force, [&] { child->send_signal(SIGKILL); }};

        LineForwarder forwarder{logger, task.task_id};
        std::array<char, 8192> buffer{};
        pollfd poll_fd{.fd = pipe->read_end.get(), .events = POLLIN, .revents = 0};
        while (true) {
            const int ready = ::poll(&poll_fd, 1, static_cast<int>(kPollInterval.count()));
            if (ready < 0 && errno != EINTR) break;
            if (ready > 0) {
                const ssize_t size = ::read(poll_fd.fd, buffer.data(), buffer.size());
                if (size < 0 && errno != EINTR) break;
                if (size == 0) break;
                if (size > 0) {
                    const auto bytes = static_cast<std::size_t>(size);
                    (void)write_all(log_file.get(), buffer.data(), bytes);
                    forwarder.append({buffer.data(), bytes});
                }
            }
            const auto current = SteadyClock::now();
            if (hard_limit && !term_sent_at && current > *hard_limit) {
                logger.warn("task.watchdog", "worker overran its time limit; sending SIGTERM",
                            fields({{"kill_grace_s", context.kill_grace.count()}}));
                child->send_signal(SIGTERM);
                term_sent_at = current;
            }
            if (term_sent_at && !kill_sent_at && current > *term_sent_at + kTermToKill) {
                logger.error("task.watchdog", "worker ignored SIGTERM; sending SIGKILL", fields());
                child->send_signal(SIGKILL);
                kill_sent_at = current;
            }
            if (kill_sent_at && current > *kill_sent_at + kKillToGiveUp) break;
        }
        forwarder.flush();
    }
    outcome.exit_code = child->wait();
    outcome.finished_at = SysClock::now();

    const auto text = read_text_file(result_path);
    Json result = text ? Json::parse(*text, nullptr, false) : Json(nullptr);
    if (!result.is_object()) {
        if (*outcome.exit_code == kExecFailed) {
            return fail("worker-unavailable",
                        std::format("cannot run '{}' (exit code 127)", context.binary.string()));
        }
        return fail("no-result", std::format("worker exited with code {} without a valid result",
                                             *outcome.exit_code));
    }
    outcome.has_result = true;
    outcome.status = status_from_result(result);
    if (const auto scan = result.find("scan"); scan != result.end() && scan->is_object()) {
        outcome.counts = scan->value("counts", Json(nullptr));
        if (const auto error = scan->find("error"); error != scan->end() && error->is_object()) {
            outcome.error_code = error->value("code", std::string{});
            outcome.error_message = error->value("message", std::string{});
        }
    }
    if (outcome.status == TaskStatus::kFailed && !outcome.error_code) {
        outcome.error_code = "worker-failed";
        outcome.error_message = "the result has no usable scan.status";
    }
    logger.log(
        outcome.status == TaskStatus::kFailed ? LogLevel::kError : LogLevel::kInfo, "task.finished",
        "worker finished",
        fields({{"status", to_string(outcome.status)},
                {"exit_code", *outcome.exit_code},
                {"hosts_up", outcome.counts.is_object() ? outcome.counts.value("up", Json(nullptr))
                                                        : Json(nullptr)}}));
    return outcome;
}

}  // namespace

std::string_view to_string(TaskStatus status) noexcept {
    switch (status) {
        case TaskStatus::kCompleted:
            return "completed";
        case TaskStatus::kPartial:
            return "partial";
        case TaskStatus::kFailed:
            return "failed";
        case TaskStatus::kCancelled:
            return "cancelled";
    }
    return "failed";
}

std::string task_file_stem(std::uint32_t index) { return std::format("task-{:03}", index); }

TaskOutcome run_task(const TaskContext& context, const Logger& logger) noexcept {
    try {
        return run_task_impl(context, logger);
    } catch (const std::exception& error) {
        logger.error("task.failed", "unexpected error",
                     {{"task_id", context.task.task_id}, {"error", error.what()}});
    } catch (...) {
        logger.error("task.failed", "unexpected error", {{"task_id", context.task.task_id}});
    }
    TaskOutcome outcome;
    outcome.status = TaskStatus::kFailed;
    outcome.error_code = "manager-error";
    outcome.error_message = "unexpected error in the manager";
    outcome.finished_at = SysClock::now();
    return outcome;
}

std::string_view aggregate_status(std::span<const std::string_view> statuses) {
    const auto all = [&](std::string_view value) {
        return std::ranges::all_of(statuses, [&](std::string_view s) { return s == value; });
    };
    const auto any = [&](std::string_view value) {
        return std::ranges::any_of(statuses, [&](std::string_view s) { return s == value; });
    };
    if (all("completed")) return "completed";  // also for an empty set: nothing left to do
    if (all("cancelled")) return "cancelled";
    if (any("completed") || any("partial")) return "partial";
    return "failed";
}

}  // namespace worker_manager
