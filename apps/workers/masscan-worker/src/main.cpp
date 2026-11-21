// masscan-worker: one JSON job in (targets, ports, limits), one JSON topology out.
// See README.md for the input/output contract.

#include <unistd.h>

#include <array>
#include <chrono>
#include <csignal>
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

#include "config.hpp"
#include "error.hpp"
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

int run(const CliOptions& cli) {
    const auto started_wall = std::chrono::system_clock::now();
    const auto started = Clock::now();
    std::vector<std::string> warnings;

    const auto finish = [&](ReportInput report, int exit_code) {
        report.timing.started_at = started_wall;
        report.timing.finished_at = std::chrono::system_clock::now();
        report.timing.duration =
            std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - started);
        report.warnings = warnings;
        const auto text = build_report(report).dump(cli.is_pretty ? 2 : -1);
        if (!write_output(cli.output_path, text)) {
            std::println(stderr, "masscan-worker: cannot write result to '{}'", cli.output_path);
            return kExitFailed;
        }
        return exit_code;
    };
    const auto fail = [&](std::string job_id, Error error, int exit_code) {
        std::println(stderr, "masscan-worker: {}: {}", to_string(error.code), error.message);
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

    const Config config = read_config();
    auto job = parse_scan_job(input, config, warnings);
    if (!job) {
        std::string job_id;
        if (const auto it = input.find("job_id");
            input.is_object() && it != input.end() && it->is_string()) {
            job_id = it->get<std::string>();
        }
        return fail(std::move(job_id), job.error(), kExitInvalidInput);
    }

    const auto version = detect_masscan_version(config);
    if (!version) {
        return fail(job->job_id,
                    {ErrorCode::kScannerUnavailable,
                     std::format("'{}' not found or not runnable", config.masscan_binary)},
                    kExitFailed);
    }

    std::println(stderr, "masscan-worker: job '{}': {} addresses x {} ports at {} pps (masscan {})",
                 job->job_id, count_addresses(job->ranges), count_ports(job->ports), job->rate,
                 *version);

    TopologyBuilder topology{job->group_prefix};
    const auto outcome =
        run_masscan(*job, config, [&topology](const Finding& finding) { topology.add(finding); });
    if (!outcome) {
        return fail(job->job_id, outcome.error(), kExitFailed);
    }
    topology.finalize();

    if (outcome->malformed_lines > 0) {
        warnings.push_back(
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
            warnings.emplace_back("masscan ignored SIGINT and was killed");
        }
        if (!outcome->resume_index) {
            warnings.emplace_back("masscan did not save a resume point; rescan from the start");
        }
    } else if (outcome->exit_code != 0) {
        report.status = ScanStatus::kFailed;
        report.error = Error{
            ErrorCode::kScannerFailed,
            std::format("masscan exited with {}: {}", outcome->exit_code, outcome->diagnostics)};
        std::println(stderr, "masscan-worker: {}", report.error->message);
        exit_code = kExitFailed;
    } else {
        report.status = ScanStatus::kCompleted;
    }

    std::println(stderr, "masscan-worker: {} hosts up, {} open ports", topology.host_count(),
                 topology.open_port_count());
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
        // Before any thread exists, so every thread inherits the mask.
        masscan_worker::block_stop_signals();
        std::signal(SIGPIPE, SIG_IGN);
        return masscan_worker::run(*cli);
    } catch (const std::exception& error) {
        std::println(stderr, "masscan-worker: fatal: {}", error.what());
    } catch (...) {
        std::println(stderr, "masscan-worker: fatal: unknown exception");
    }
    return EXIT_FAILURE;
}
