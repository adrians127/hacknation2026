#include "job.hpp"
#include "process.hpp"
#include "result.hpp"

#include <charconv>
#include <algorithm>
#include <csignal>
#include <cstring>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>
#include <print>
#include <pthread.h>
#include <span>
#include <stop_token>
#include <thread>
#include <unistd.h>

namespace httpx_worker {
namespace {

struct Options { std::string input = "-"; std::string output = "-"; bool pretty = false; };

std::expected<Options, Error> parse_cli(std::span<char* const> args) {
    Options options;
    for (std::size_t i = 1; i < args.size(); ++i) {
        const std::string_view arg{args[i]};
        if ((arg == "--input" || arg == "--output") && i + 1 < args.size()) {
            if (arg == "--input") options.input = args[++i];
            else options.output = args[++i];
        } else if (arg == "--pretty") options.pretty = true;
        else return std::unexpected(Error{"invalid-input",
            "usage: httpx-worker [--input FILE] [--output FILE] [--pretty]"});
    }
    return options;
}

std::expected<std::string, Error> read_input(std::string_view path) {
    if (path == "-") {
        std::string input{std::istreambuf_iterator<char>{std::cin}, std::istreambuf_iterator<char>{}};
        if (input.size() > 4 * 1024 * 1024)
            return std::unexpected(Error{"invalid-input", "Job exceeds 4 MiB"});
        return input;
    }
    std::ifstream file{std::string{path}, std::ios::binary | std::ios::ate};
    if (!file) return std::unexpected(Error{"io-error", "Cannot open job file"});
    const auto size = file.tellg();
    if (size < 0 || size > 4 * 1024 * 1024)
        return std::unexpected(Error{"invalid-input", "Job file exceeds 4 MiB"});
    file.seekg(0);
    return std::string{std::istreambuf_iterator<char>{file}, std::istreambuf_iterator<char>{}};
}

bool write_output(std::string_view path, const OrderedJson& output, bool pretty) {
    const auto text = output.dump(pretty ? 2 : -1, ' ', false,
                                  OrderedJson::error_handler_t::replace) + "\n";
    if (path == "-") {
        std::cout << text;
        return static_cast<bool>(std::cout.flush());
    }
    auto temporary = std::filesystem::path{path};
    temporary += ".tmp-" + std::to_string(::getpid());
    {
        std::ofstream file{temporary, std::ios::binary | std::ios::trunc};
        file << text;
        if (!file.flush()) return false;
    }
    std::error_code ec;
    std::filesystem::rename(temporary, path, ec);
    if (ec) {
        std::filesystem::remove(temporary, ec);
        return false;
    }
    return true;
}

std::uint32_t env_limit(const char* key, std::uint32_t fallback) {
    const char* text = std::getenv(key);
    if (!text || !*text) return fallback;
    std::uint32_t value = 0;
    const auto [end, ec] = std::from_chars(text, text + std::strlen(text), value);
    if (ec != std::errc{} || *end != '\0' || value == 0) return fallback;
    return std::min(value, fallback);
}

class SignalStop {
public:
    static void block() {
        auto mask = signals();
        ::pthread_sigmask(SIG_BLOCK, &mask, nullptr);
    }
    explicit SignalStop(std::stop_source source) : source_(std::move(source)) {
        thread_ = std::jthread{[this] {
            auto mask = signals();
            while (true) {
                int signal = 0;
                if (::sigwait(&mask, &signal) != 0) continue;
                if (signal == SIGUSR1) return;
                source_.request_stop();
            }
        }};
    }
    ~SignalStop() { ::kill(::getpid(), SIGUSR1); }
    SignalStop(const SignalStop&) = delete;
    SignalStop& operator=(const SignalStop&) = delete;
private:
    static sigset_t signals() {
        sigset_t mask{};
        sigemptyset(&mask);
        sigaddset(&mask, SIGINT);
        sigaddset(&mask, SIGTERM);
        sigaddset(&mask, SIGUSR1);
        return mask;
    }
    std::stop_source source_;
    std::jthread thread_;
};

} // namespace
} // namespace httpx_worker

int main(int argc, char* argv[]) {
    using namespace httpx_worker;
    const auto options = parse_cli({argv, static_cast<std::size_t>(argc)});
    if (!options) {
        std::println(stderr, "httpx-worker: {}", options.error().message);
        return 2;
    }
    const auto input = read_input(options->input);
    if (!input) {
        if (!write_output(options->output, make_failed_result("", input.error()), options->pretty))
            return 1;
        return 2;
    }
    auto job = parse_job(*input);
    if (!job) {
        if (!write_output(options->output, make_failed_result(*input, job.error()), options->pretty))
            return 1;
        return 2;
    }
    job->limits.rate = std::min(job->limits.rate, env_limit("HTTPX_WORKER_MAX_RATE", 25));
    job->limits.threads = std::min(job->limits.threads, env_limit("HTTPX_WORKER_MAX_THREADS", 10));
    const char* configured = std::getenv("HTTPX_BINARY");
    const std::string binary = configured && *configured ? configured : "httpx";

    SignalStop::block();
    std::stop_source stop;
    const auto started = std::chrono::system_clock::now();
    const auto start_clock = std::chrono::steady_clock::now();
    std::vector<GroupResult> groups;
    std::size_t processed = 0;
    std::optional<Error> error;
    {
        const SignalStop signals{stop};
        for (std::size_t index = 0; index < job->targets.size(); ++index) {
            if (stop.stop_requested() || std::chrono::steady_clock::now() >= job->deadline)
                break;
            bool attempted = false;
            const auto& target = job->targets[index];
            std::vector<std::string> domains{""};
            domains.insert(domains.end(), target.domains.begin(), target.domains.end());
            for (const auto& domain : domains) {
                if (stop.stop_requested() || std::chrono::steady_clock::now() >= job->deadline)
                    break;
                attempted = true;
                auto outcome = run_httpx(*job, target, domain, binary, stop.get_token());
                if (!outcome) { error = outcome.error(); break; }
                if (outcome->exit_code != 0 && !outcome->stopped) {
                    error = Error{"scanner-failed", outcome->stderr_text.empty()
                        ? "httpx exited unsuccessfully" : outcome->stderr_text};
                }
                groups.push_back(GroupResult{index, domain, std::move(outcome->jsonl),
                                             outcome->stopped || outcome->exit_code != 0});
                if (outcome->stopped || error) break;
            }
            if (attempted) processed = index + 1;
            if (error || stop.stop_requested() || std::chrono::steady_clock::now() >= job->deadline)
                break;
        }
    }
    const bool stopped = stop.stop_requested();
    const bool deadline = std::chrono::steady_clock::now() >= job->deadline;
    const bool has_data = std::ranges::any_of(groups, [](const GroupResult& group) {
        return !group.jsonl.empty();
    });
    const std::string status = error ? (has_data ? "partial" : "failed")
        : stopped || deadline || processed < job->targets.size() ? "partial" : "completed";
    const std::string reason = error ? "error" : stopped ? "stop-requested"
        : deadline ? "deadline" : "";
    const auto duration = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - start_clock);
    const auto result = make_result(*job, groups, processed, status, reason, error,
                                    started, duration);
    std::println(stderr, "httpx-worker: job {} {}: targets={} groups={} duration_ms={}",
                 job->job_id, status, job->targets.size(), groups.size(), duration.count());
    if (!write_output(options->output, result, options->pretty)) return 1;
    return status == "failed" ? 1 : 0;
}
