// masscan-worker: one JSON job in (targets, ports, limits), one JSON topology out.
// See README.md for the input/output contract.

#include <unistd.h>

#include <array>
#include <chrono>
#include <csignal>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <exception>
#include <expected>
#include <filesystem>
#include <format>
#include <fstream>
#include <iterator>
#include <nlohmann/json.hpp>
#include <optional>
#include <print>
#include <span>
#include <string>
#include <string_view>
#include <system_error>
#include <vector>

#include "address.hpp"
#include "config.hpp"
#include "error.hpp"
#include "logger.hpp"
#include "masscan_runner.hpp"
#include "report.hpp"
#include "scan_job.hpp"
#include "topology.hpp"

namespace masscan_worker {

namespace {

using Clock = std::chrono::steady_clock;

constexpr int kExitFailed = 1;
constexpr int kExitInvalidInput = 2;

constexpr std::string_view kUsage =
    R"(usage: masscan-worker [--input FILE] [--output FILE] [--pretty]

  --input FILE    job JSON (default: stdin, also "-")
  --output FILE   result JSON (default: stdout, also "-"); written atomically
  --pretty        indent the result JSON
  --version       print version and exit

Exit codes: 0 completed or partial, 1 scan failed, 2 invalid input or usage.
)";

struct CliOptions {
    std::string input_path = "-";
    std::string output_path = "-";
    bool is_pretty = false;
};

std::optional<CliOptions> parse_cli(std::span<char* const> args) {
    CliOptions options;
    for (std::size_t i = 1; i < args.size(); ++i) {
        const std::string_view arg{args[i]};
        const bool has_value = i + 1 < args.size();
        if (arg == "--input" && has_value) {
            options.input_path = args[++i];
        } else if (arg == "--output" && has_value) {
            options.output_path = args[++i];
        } else if (arg == "--pretty") {
            options.is_pretty = true;
        } else {
            return std::nullopt;
        }
    }
    return options;
}

std::expected<std::string, Error> read_input(const std::string& path) {
    if (path == "-") {
        std::string text;
        std::array<char, 64 * 1024> buffer{};
        std::size_t count = 0;
        while ((count = std::fread(buffer.data(), 1, buffer.size(), stdin)) > 0) {
            text.append(buffer.data(), count);
        }
        if (std::ferror(stdin) != 0) {
            return std::unexpected(Error{ErrorCode::kIo, "cannot read stdin"});
        }
        return text;
    }
    std::ifstream file{path, std::ios::binary};
    if (!file) {
        return std::unexpected(Error{ErrorCode::kIo, std::format("cannot read '{}'", path)});
    }
    return std::string{std::istreambuf_iterator<char>{file}, {}};
}

// Temp file + rename, so an orchestrator polling the path never sees half a document.
bool write_output(const std::string& path, const std::string& text) {
    if (path == "-") {
        std::println("{}", text);
        return std::fflush(stdout) == 0;
    }
    const std::filesystem::path target{path};
    std::filesystem::path temp = target;
    temp += std::format(".tmp-{}", ::getpid());
    {
        std::ofstream file{temp, std::ios::binary | std::ios::trunc};
        file << text << '\n';
        if (!file.flush()) {
            return false;
        }
    }
    std::error_code ec;
    std::filesystem::rename(temp, target, ec);
    if (ec) {
        std::filesystem::remove(temp, ec);
        return false;
    }
    return true;
}

std::int64_t to_seconds(Clock::duration duration) {
    return std::chrono::duration_cast<std::chrono::seconds>(duration).count();
}

std::string truncate(std::string text, std::size_t max_size) {
    if (text.size() > max_size) {
        text.resize(max_size);
        text += "...";
    }
    return text;
}

void log_job(const Logger& logger, const ScanJob& job) {
    const std::uint64_t addresses = count_addresses(job.ranges);
    const std::uint64_t ports = count_ports(job.ports);
    const std::uint64_t shards = job.shard ? job.shard->total : 1;
    const std::uint64_t probes = addresses * ports;
    const auto estimate = static_cast<std::int64_t>(probes / shards / job.rate) + job.wait.count();
    Logger::Fields fields{
        {"job_id", job.job_id},
        {"targets", truncate(format_ipv4_range(job.ranges.front()) +
                                 (job.ranges.size() > 1
                                      ? std::format(" (+{} more ranges)", job.ranges.size() - 1)
                                      : ""),
                             80)},
        {"addresses", addresses},
        {"ports", truncate(format_port_ranges(job.ports), 60)},
        {"port_count", ports},
        {"probes", probes},
        {"rate_pps", job.rate},
        {"estimated_s", estimate},
        {"max_duration_s",
         job.max_duration ? Logger::Fields(job.max_duration->count()) : Logger::Fields(nullptr)},
    };
    if (job.shard) {
        fields["shard"] = std::format("{}/{}", job.shard->index, job.shard->total);
    }
    if (job.resume_index > 0) {
        fields["resume_index"] = job.resume_index;
    }
    fields["seed"] = job.seed;
    logger.info("job.accepted", "job accepted", fields);
    if (job.max_duration && estimate > job.max_duration->count()) {
        logger.warn("job.window",
                    "estimated duration exceeds the time window; expect a partial result",
                    {{"estimated_s", estimate}, {"max_duration_s", job.max_duration->count()}});
    }
}

void log_progress(const Logger& logger, const ScanProgress& progress,
                  const TopologyBuilder& topology) {
    if (!progress.status) {
        logger.info("scan.progress", "masscan is starting up",
                    {{"elapsed_s", to_seconds(progress.elapsed)}});
        return;
    }
    const MasscanStatus& status = *progress.status;
    Logger::Fields fields{
        {"rate_pps", static_cast<std::int64_t>(status.rate_pps)},
        {"hosts_up", topology.host_count()},
        {"open_ports", progress.open_ports_reported},
        {"elapsed_s", to_seconds(progress.elapsed)},
    };
    if (status.waiting) {
        fields["waiting_s"] = status.waiting->count();
    } else if (status.remaining) {
        fields["eta_s"] = status.remaining->count();
    }
    logger.info("scan.progress",
                status.waiting
                    ? std::format("{:.2f}% sent, waiting for late replies", status.percent_done)
                    : std::format("{:.2f}% done", status.percent_done),
                fields);
}

int run(const CliOptions& cli, const Config& config, const Logger& logger) {
    const auto started_wall = std::chrono::system_clock::now();
    const auto started = Clock::now();
    std::vector<std::string> warnings;
    const auto add_warning = [&](std::string warning) {
        logger.warn("job.warning", warning);
        warnings.push_back(std::move(warning));
    };

    logger.info("worker.start", "masscan-worker starting",
                {{"version", MASSCAN_WORKER_VERSION},
                 {"input", cli.input_path == "-" ? "stdin" : cli.input_path},
                 {"output", cli.output_path == "-" ? "stdout" : cli.output_path},
                 {"max_rate_pps", config.max_rate}});

    const auto finish = [&](ReportInput report, int exit_code) {
        report.timing.started_at = started_wall;
        report.timing.finished_at = std::chrono::system_clock::now();
        report.timing.duration =
            std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - started);
        report.warnings = warnings;
        const auto text = build_report(report).dump(
            cli.is_pretty ? 2 : -1, ' ', false, nlohmann::ordered_json::error_handler_t::replace);
        if (!write_output(cli.output_path, text)) {
            logger.error("result.write_failed", "cannot write the result",
                         {{"output", cli.output_path}});
            return kExitFailed;
        }
        logger.info("result.written", "result written",
                    {{"output", cli.output_path == "-" ? "stdout" : cli.output_path},
                     {"bytes", text.size()},
                     {"exit_code", exit_code}});
        return exit_code;
    };
    const auto fail = [&](std::string job_id, Error error, int exit_code) {
        logger.error("job.failed", error.message, {{"code", to_string(error.code)}});
        return finish(
            {.status = ScanStatus::kFailed, .job_id = std::move(job_id), .error = std::move(error)},
            exit_code);
    };

    const auto input_text = read_input(cli.input_path);
    if (!input_text) {
        return fail("", input_text.error(), kExitInvalidInput);
    }
    const auto input = nlohmann::json::parse(*input_text, nullptr, /*allow_exceptions=*/false);
    if (input.is_discarded()) {
        return fail("", {ErrorCode::kInvalidInput, "input is not valid JSON"}, kExitInvalidInput);
    }

    std::vector<std::string> job_warnings;
    auto job = parse_scan_job(input, config, job_warnings);
    for (std::string& warning : job_warnings) {
        add_warning(std::move(warning));
    }
    if (!job) {
        std::string job_id;
        if (const auto it = input.find("job_id");
            input.is_object() && it != input.end() && it->is_string()) {
            job_id = it->get<std::string>();
        }
        return fail(std::move(job_id), job.error(), kExitInvalidInput);
    }
    log_job(logger, *job);

    const auto version = detect_masscan_version(config);
    if (!version) {
        return fail(job->job_id,
                    {ErrorCode::kScannerUnavailable,
                     std::format("'{}' not found or not runnable", config.masscan_binary)},
                    kExitFailed);
    }
    logger.info("scanner.detected", "masscan found",
                {{"version", *version}, {"binary", config.masscan_binary}});

    TopologyBuilder topology{job->group_prefix};
    const ScanCallbacks callbacks{
        .on_finding =
            [&](const Finding& finding) {
                const std::size_t hosts_before = topology.host_count();
                topology.add(finding);
                if (logger.is_enabled(LogLevel::kDebug)) {
                    logger.debug(topology.host_count() > hosts_before ? "host.up" : "port.open",
                                 topology.host_count() > hosts_before ? "host up" : "open port",
                                 {{"ip", format_ipv4(finding.ip)},
                                  {"port", finding.port},
                                  {"ttl", finding.ttl}});
                }
            },
        .on_progress =
            [&](const ScanProgress& progress) { log_progress(logger, progress, topology); },
    };
    const auto outcome = run_masscan(*job, config, logger, callbacks);
    if (!outcome) {
        return fail(job->job_id, outcome.error(), kExitFailed);
    }
    topology.finalize();

    if (outcome->malformed_lines > 0) {
        add_warning(
            std::format("{} masscan output lines could not be parsed", outcome->malformed_lines));
    }

    ReportInput report{.job_id = job->job_id,
                       .job = &*job,
                       .outcome = &*outcome,
                       .topology = &topology,
                       .scanner_version = version};
    int exit_code = EXIT_SUCCESS;
    if (outcome->stop_reason != StopReason::kNone) {
        report.status = ScanStatus::kPartial;
        if (outcome->was_killed) {
            add_warning("masscan ignored SIGINT and was killed");
        }
        if (!outcome->resume_index) {
            add_warning("masscan did not save a resume point; rescan from the start");
        }
    } else if (outcome->exit_code != 0) {
        report.status = ScanStatus::kFailed;
        report.error = Error{
            ErrorCode::kScannerFailed,
            std::format("masscan exited with {}: {}", outcome->exit_code, outcome->diagnostics)};
        logger.error("scan.failed", report.error->message);
        exit_code = kExitFailed;
    } else {
        report.status = ScanStatus::kCompleted;
    }

    Logger::Fields summary{
        {"status", report.status == ScanStatus::kCompleted ? "completed"
                   : report.status == ScanStatus::kPartial ? "partial"
                                                           : "failed"},
        {"hosts_up", topology.host_count()},
        {"open_ports", topology.open_port_count()},
        {"subnets", topology.subnet_count()},
        {"duration_s", to_seconds(Clock::now() - started)},
    };
    if (report.status == ScanStatus::kPartial && outcome->resume_index) {
        summary["resume_index"] = *outcome->resume_index;
        summary["seed"] = job->seed;
    }
    logger.info("scan.finished", "scan finished", summary);
    return finish(std::move(report), exit_code);
}

}  // namespace

}  // namespace masscan_worker

int main(int argc, char** argv) {
    try {
        const std::span<char* const> args{argv, static_cast<std::size_t>(argc)};
        if (args.size() == 2 && std::string_view{args[1]} == "--version") {
            std::println("masscan-worker {}", MASSCAN_WORKER_VERSION);
            return EXIT_SUCCESS;
        }
        if (args.size() == 2 && std::string_view{args[1]} == "--help") {
            std::print("{}", masscan_worker::kUsage);
            return EXIT_SUCCESS;
        }
        const auto cli = masscan_worker::parse_cli(args);
        if (!cli) {
            std::print(stderr, "{}", masscan_worker::kUsage);
            return masscan_worker::kExitInvalidInput;
        }
        const masscan_worker::Config config = masscan_worker::read_config();
        const masscan_worker::Logger logger{config.log_level, config.log_format};
        // Before any thread exists, so every thread inherits the mask.
        masscan_worker::block_stop_signals();
        std::signal(SIGPIPE, SIG_IGN);
        return masscan_worker::run(*cli, config, logger);
    } catch (const std::exception& error) {
        std::println(stderr, "masscan-worker: fatal: {}", error.what());
    } catch (...) {
        std::println(stderr, "masscan-worker: fatal: unknown exception");
    }
    return EXIT_FAILURE;
}
