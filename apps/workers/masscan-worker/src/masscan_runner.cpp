#include "masscan_runner.hpp"

#include <fcntl.h>
#include <poll.h>
#include <unistd.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <cerrno>
#include <charconv>
#include <chrono>
#include <csignal>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <deque>
#include <format>
#include <fstream>
#include <nlohmann/json.hpp>
#include <span>
#include <stop_token>
#include <system_error>
#include <thread>
#include <utility>

#include "process.hpp"

namespace masscan_worker {

namespace {

using namespace std::chrono_literals;

constexpr std::size_t kReadChunk = 64 * 1024;
constexpr auto kSupervisorTick = 200ms;
// After SIGINT masscan keeps listening for --wait seconds; beyond this extra it gets SIGKILL.
constexpr auto kKillGrace = 10s;
constexpr int kPollTimeoutMs = 250;
constexpr std::size_t kKeptMessages = 6;

class TempDir {
public:
    static std::expected<TempDir, Error> create() {
        std::error_code ec;
        const auto base = std::filesystem::temp_directory_path(ec);
        if (ec) {
            return std::unexpected(
                Error{ErrorCode::kIo, std::format("temp dir: {}", ec.message())});
        }
        std::string pattern = (base / "masscan-worker-XXXXXX").string();
        if (::mkdtemp(pattern.data()) == nullptr) {
            return std::unexpected(
                Error{ErrorCode::kIo, std::format("mkdtemp: {}", std::strerror(errno))});
        }
        return TempDir{std::filesystem::path{pattern}};
    }

    TempDir(TempDir&& other) noexcept : path_{std::exchange(other.path_, {})} {}
    TempDir& operator=(TempDir&&) = delete;
    TempDir(const TempDir&) = delete;
    TempDir& operator=(const TempDir&) = delete;
    ~TempDir() noexcept {
        if (!path_.empty()) {
            std::error_code ec;
            std::filesystem::remove_all(path_, ec);
        }
    }

    [[nodiscard]] const std::filesystem::path& path() const noexcept { return path_; }

private:
    explicit TempDir(std::filesystem::path path) : path_{std::move(path)} {}
    std::filesystem::path path_;
};

std::expected<void, Error> write_target_file(const std::filesystem::path& path,
                                             std::span<const Ipv4Range> ranges) {
    std::ofstream file{path, std::ios::trunc};
    for (const Ipv4Range& range : ranges) {
        file << format_ipv4_range(range) << '\n';
    }
    file.close();
    if (!file) {
        return std::unexpected(
            Error{ErrorCode::kIo, std::format("cannot write {}", path.string())});
    }
    return {};
}

// masscan writes paused.conf into its working directory when a scan is interrupted.
std::optional<std::uint64_t> read_resume_index(const std::filesystem::path& paused_conf) {
    std::ifstream file{paused_conf};
    std::string line;
    while (std::getline(file, line)) {
        constexpr std::string_view kKey = "resume-index";
        if (!line.starts_with(kKey)) {
            continue;
        }
        const std::size_t equals = line.find('=');
        if (equals == std::string::npos) {
            return std::nullopt;
        }
        std::size_t begin = line.find_first_not_of(' ', equals + 1);
        if (begin == std::string::npos) {
            return std::nullopt;
        }
        std::uint64_t index = 0;
        const char* first = line.data() + begin;
        const char* last = line.data() + line.size();
        if (std::from_chars(first, last, index).ec != std::errc{}) {
            return std::nullopt;
        }
        return index;
    }
    return std::nullopt;
}

std::string_view trim(std::string_view text) {
    const std::size_t begin = text.find_first_not_of(' ');
    if (begin == std::string_view::npos) {
        return {};
    }
    return text.substr(begin, text.find_last_not_of(' ') - begin + 1);
}

template <typename T>
std::optional<T> parse_number(std::string_view text) {
    T value{};
    const auto [end, ec] = std::from_chars(text.data(), text.data() + text.size(), value);
    if (ec != std::errc{} || end != text.data() + text.size()) {
        return std::nullopt;
    }
    return value;
}

// Calls `on_line` for each complete line in `pending` and keeps the unfinished tail.
template <typename OnLine>
void drain_lines(std::string& pending, std::string_view delimiters, OnLine&& on_line) {
    std::size_t start = 0;
    for (std::size_t end = pending.find_first_of(delimiters); end != std::string::npos;
         end = pending.find_first_of(delimiters, start)) {
        if (end > start) {
            on_line(std::string_view{pending}.substr(start, end - start));
        }
        start = end + 1;
    }
    pending.erase(0, start);
}

// false on EOF or a read error: either way the stream is done.
bool read_available(int fd, std::string& pending) {
    std::array<char, kReadChunk> buffer{};
    while (true) {
        const ssize_t count = ::read(fd, buffer.data(), buffer.size());
        if (count > 0) {
            pending.append(buffer.data(), static_cast<std::size_t>(count));
            return true;
        }
        if (count < 0 && errno == EINTR) {
            continue;
        }
        return false;
    }
}

bool looks_like_problem(std::string_view line) {
    for (const std::string_view marker : {"FAIL", "ERROR", "error", "WARN", "warning"}) {
        if (line.find(marker) != std::string_view::npos) {
            return true;
        }
    }
    return false;
}

std::string_view signal_name(int signal) {
    return signal == SIGINT ? "SIGINT" : signal == SIGTERM ? "SIGTERM" : "signal";
}

}  // namespace

void block_stop_signals() {
    sigset_t signals{};
    sigemptyset(&signals);
    sigaddset(&signals, SIGINT);
    sigaddset(&signals, SIGTERM);
    if (const int rc = ::pthread_sigmask(SIG_BLOCK, &signals, nullptr); rc != 0) {
        throw std::system_error(rc, std::generic_category(), "pthread_sigmask");
    }
}

std::optional<std::string> detect_masscan_version(const Config& config) {
    auto pipe = make_pipe();
    if (!pipe) {
        return std::nullopt;
    }
    const UniqueFd dev_null{::open("/dev/null", O_WRONLY | O_CLOEXEC)};
    const std::array<std::string, 2> argv{config.masscan_binary, "--version"};
    auto child = spawn_process({.argv = argv,
                                .working_directory = std::nullopt,
                                .stdout_fd = pipe->write_end.get(),
                                .stderr_fd = dev_null.get()});
    if (!child) {
        return std::nullopt;
    }
    pipe->write_end.reset();

    std::string output;
    std::array<char, 1024> buffer{};
    ssize_t count = 0;
    while ((count = ::read(pipe->read_end.get(), buffer.data(), buffer.size())) != 0) {
        if (count < 0) {
            if (errno == EINTR) continue;
            break;
        }
        output.append(buffer.data(), static_cast<std::size_t>(count));
    }
    // masscan 1.3.2 exits with 1 after printing its version, so only the output counts.
    static_cast<void>(child->wait());
    constexpr std::string_view kMarker = "Masscan version ";
    const std::size_t at = output.find(kMarker);
    if (at == std::string::npos) {
        return std::nullopt;
    }
    const std::size_t begin = at + kMarker.size();
    return output.substr(begin, output.find_first_of(" \r\n", begin) - begin);
}

std::vector<std::string> build_masscan_args(const ScanJob& job, const Config& config,
                                            const std::filesystem::path& target_file) {
    std::vector<std::string> args{
        config.masscan_binary,
        "-iL",
        target_file.string(),
        "-p",
        format_port_ranges(job.ports),
        "--rate",
        std::to_string(job.rate),
        "--wait",
        std::to_string(job.wait.count()),
        "--retries",
        std::to_string(job.retries),
        "--seed",
        std::to_string(job.seed),
        "-oD",
        "-",  // NDJSON on stdout, parsed as it streams
    };
    if (config.log_level == LogLevel::kDebug) {
        args.emplace_back("-v");  // masscan then prints its interface, source IP and router MAC
    }
    if (job.resume_index > 0) {
        args.insert(args.end(), {"--resume-index", std::to_string(job.resume_index)});
    }
    if (job.shard) {
        args.insert(args.end(),
                    {"--shards", std::format("{}/{}", job.shard->index, job.shard->total)});
    }
    if (job.adapter) {
        args.insert(args.end(), {"--adapter", *job.adapter});
    }
    if (job.adapter_ip) {
        args.insert(args.end(), {"--adapter-ip", *job.adapter_ip});
    }
    if (job.router_mac) {
        args.insert(args.end(), {"--router-mac", *job.router_mac});
    }
    return args;
}

std::optional<Finding> parse_finding(std::string_view line) {
    const auto record = nlohmann::json::parse(line, nullptr, /*allow_exceptions=*/false);
    if (!record.is_object()) {
        return std::nullopt;
    }
    const auto rec_type = record.find("rec_type");
    const auto ip = record.find("ip");
    const auto port = record.find("port");
    const auto proto = record.find("proto");
    const auto data = record.find("data");
    if (rec_type == record.end() || *rec_type != "status" || ip == record.end() ||
        !ip->is_string() || port == record.end() || !port->is_number_unsigned() ||
        proto == record.end() || *proto != "tcp" || data == record.end() || !data->is_object()) {
        return std::nullopt;
    }
    if (const auto status = data->find("status"); status == data->end() || *status != "open") {
        return std::nullopt;
    }
    const auto address = parse_ipv4(ip->get_ref<const std::string&>());
    const auto port_number = port->get<std::uint64_t>();
    if (!address || port_number == 0 || port_number > 65535) {
        return std::nullopt;
    }
    std::uint64_t ttl = 0;
    if (const auto it = data->find("ttl"); it != data->end() && it->is_number_unsigned()) {
        ttl = std::min<std::uint64_t>(it->get<std::uint64_t>(), 255);
    }
    Finding finding{*address, static_cast<std::uint16_t>(port_number),
                    static_cast<std::uint8_t>(ttl)};
    if (const auto it = data->find("reason"); it != data->end() && it->is_string()) {
        finding.reason = it->get<std::string>();
    }
    // masscan writes the timestamp as a string of Unix seconds ("1795277913").
    if (const auto it = record.find("timestamp"); it != record.end()) {
        if (it->is_number_integer()) {
            finding.timestamp = it->get<std::int64_t>();
        } else if (it->is_string()) {
            const std::string& text = it->get_ref<const std::string&>();
            std::int64_t seconds = 0;
            const auto [end, ec] = std::from_chars(text.data(), text.data() + text.size(), seconds);
            if (ec == std::errc{} && end == text.data() + text.size() && seconds > 0) {
                finding.timestamp = seconds;
            }
        }
    }
    return finding;
}

std::optional<MasscanStatus> parse_masscan_status(std::string_view line) {
    // "rate:  1.00-kpps, 85.70% done,   0:00:01 remaining, found=3"
    // "rate:  0.00-kpps, 100.00% done, waiting 2-secs, found=3"
    if (!line.starts_with("rate:")) {
        return std::nullopt;
    }
    std::vector<std::string_view> parts;
    for (std::string_view rest = line.substr(5); !rest.empty();) {
        const std::size_t comma = rest.find(',');
        parts.push_back(trim(rest.substr(0, comma)));
        rest = comma == std::string_view::npos ? std::string_view{} : rest.substr(comma + 1);
    }
    if (parts.size() < 4) {
        return std::nullopt;
    }

    MasscanStatus status{};
    const std::size_t dash = parts[0].find('-');
    const auto rate = parse_number<double>(parts[0].substr(0, dash));
    if (!rate || dash == std::string_view::npos) {
        return std::nullopt;
    }
    const std::string_view unit = parts[0].substr(dash + 1);
    status.rate_pps = *rate * (unit == "kpps" ? 1e3 : unit == "Mpps" ? 1e6 : 1.0);

    const std::size_t percent_sign = parts[1].find('%');
    const auto percent = parse_number<double>(parts[1].substr(0, percent_sign));
    if (!percent || percent_sign == std::string_view::npos) {
        return std::nullopt;
    }
    status.percent_done = *percent;

    const std::string_view timing = parts[2];
    if (timing.starts_with("waiting ")) {
        const std::string_view value = timing.substr(8);
        if (const auto seconds = parse_number<std::int64_t>(value.substr(0, value.find('-')))) {
            status.waiting = std::chrono::seconds{*seconds};
        }
    } else if (timing.ends_with(" remaining")) {
        // H:MM:SS, where H can be large early in a scan.
        std::int64_t total = 0;
        bool is_valid = true;
        std::string_view rest = timing.substr(0, timing.size() - 10);
        while (!rest.empty() && is_valid) {
            const std::size_t colon = rest.find(':');
            const auto value = parse_number<std::int64_t>(rest.substr(0, colon));
            is_valid = value.has_value();
            total = total * 60 + value.value_or(0);
            rest = colon == std::string_view::npos ? std::string_view{} : rest.substr(colon + 1);
        }
        if (is_valid) {
            status.remaining = std::chrono::seconds{total};
        }
    }

    const std::string_view found = parts.back();
    if (found.starts_with("found=")) {
        status.found = parse_number<std::uint64_t>(found.substr(6)).value_or(0);
    }
    return status;
}

std::expected<ScanOutcome, Error> run_masscan(const ScanJob& job, const Config& config,
                                              const Logger& logger,
                                              const ScanCallbacks& callbacks) {
    auto work_dir = TempDir::create();
    if (!work_dir) return std::unexpected(work_dir.error());
    const auto target_file = work_dir->path() / "targets.txt";
    if (auto written = write_target_file(target_file, job.ranges); !written) {
        return std::unexpected(written.error());
    }

    auto stdout_pipe = make_pipe();
    if (!stdout_pipe) return std::unexpected(stdout_pipe.error());
    auto stderr_pipe = make_pipe();
    if (!stderr_pipe) return std::unexpected(stderr_pipe.error());

    const auto args = build_masscan_args(job, config, target_file);
    if (logger.is_enabled(LogLevel::kDebug)) {
        std::string command;
        for (const std::string& arg : args) {
            command += command.empty() ? arg : " " + arg;
        }
        logger.debug("masscan.command", "masscan command line", {{"argv", command}});
    }
    const auto started = std::chrono::steady_clock::now();
    auto child = spawn_process({.argv = args,
                                .working_directory = work_dir->path(),
                                .stdout_fd = stdout_pipe->write_end.get(),
                                .stderr_fd = stderr_pipe->write_end.get()});
    if (!child) return std::unexpected(child.error());
    stdout_pipe->write_end.reset();
    stderr_pipe->write_end.reset();
    logger.info("scan.started", "masscan started", {{"pid", child->pid()}});

    std::optional<std::chrono::steady_clock::time_point> deadline;
    if (job.max_duration) {
        deadline = started + *job.max_duration;
    }
    std::atomic<StopReason> stop_reason{StopReason::kNone};
    std::atomic<bool> was_killed{false};
    const auto kill_after = job.wait + kKillGrace;
    const auto max_duration = job.max_duration;

    // The child is reaped only after this thread is joined, so its pid cannot be recycled
    // while the thread may still signal it.
    std::jthread supervisor{[&child, &stop_reason, &was_killed, &logger, deadline, kill_after,
                             max_duration](const std::stop_token& token) noexcept {
        sigset_t signals{};
        sigemptyset(&signals);
        sigaddset(&signals, SIGINT);
        sigaddset(&signals, SIGTERM);
        constexpr timespec kTick{0, std::chrono::nanoseconds{kSupervisorTick}.count()};
        std::optional<std::chrono::steady_clock::time_point> interrupted_at;
        bool has_killed = false;
        while (!token.stop_requested()) {
            const int signal = ::sigtimedwait(&signals, nullptr, &kTick);
            const auto now = std::chrono::steady_clock::now();
            if (!interrupted_at) {
                if (signal == SIGINT || signal == SIGTERM) {
                    stop_reason = StopReason::kSignal;
                    logger.warn("scan.stopping", "stop signal received, stopping masscan",
                                {{"signal", signal_name(signal)}});
                } else if (deadline && now >= *deadline) {
                    stop_reason = StopReason::kTimeWindow;
                    logger.warn("scan.stopping", "time window reached, stopping masscan",
                                {{"max_duration_s", max_duration ? max_duration->count() : 0}});
                }
                if (stop_reason != StopReason::kNone) {
                    child->send_signal(SIGINT);  // graceful: masscan writes paused.conf
                    interrupted_at = now;
                }
            } else if (!has_killed && (signal > 0 || now - *interrupted_at >= kill_after)) {
                logger.error("scan.killing",
                             signal > 0 ? "second stop signal, killing masscan"
                                        : "masscan did not stop in time, killing it",
                             {{"grace_s", kill_after.count()}});
                child->send_signal(SIGKILL);
                was_killed = true;
                has_killed = true;
            }
        }
    }};

    ScanOutcome outcome;
    std::uint64_t open_ports_reported = 0;
    std::optional<MasscanStatus> last_status;
    std::deque<std::string> recent_messages;  // non-status stderr lines, for error reports

    const auto on_stdout_line = [&](std::string_view line) {
        if (const auto finding = parse_finding(line)) {
            ++open_ports_reported;
            callbacks.on_finding(*finding);
        } else if (line.front() == '{' && line.find("\"status\"") != line.npos) {
            ++outcome.malformed_lines;
        }
    };
    const auto on_stderr_line = [&](std::string_view line) {
        if (line.starts_with("rate:")) {
            if (auto status = parse_masscan_status(line)) {
                last_status = *status;
            }
            return;
        }
        const std::string_view text = trim(line);
        if (text.empty()) {
            return;
        }
        const LogLevel level = looks_like_problem(text) ? LogLevel::kWarn : LogLevel::kDebug;
        if (logger.is_enabled(level)) {
            logger.log(level, "masscan.message", std::format("masscan: {}", text));
        }
        recent_messages.emplace_back(text);
        if (recent_messages.size() > kKeptMessages) {
            recent_messages.pop_front();
        }
    };

    std::string stdout_pending;
    std::string stderr_pending;
    std::array<pollfd, 2> fds{
        {{stdout_pipe->read_end.get(), POLLIN, 0}, {stderr_pipe->read_end.get(), POLLIN, 0}}};
    auto next_progress = started + config.progress_interval;
    while (fds[0].fd >= 0 || fds[1].fd >= 0) {
        const int ready = ::poll(fds.data(), fds.size(), kPollTimeoutMs);
        if (ready < 0 && errno != EINTR) {
            break;
        }
        if (ready > 0) {
            if (fds[0].fd >= 0 && fds[0].revents != 0) {
                if (!read_available(fds[0].fd, stdout_pending)) fds[0].fd = -1;
                drain_lines(stdout_pending, "\n", on_stdout_line);
            }
            if (fds[1].fd >= 0 && fds[1].revents != 0) {
                if (!read_available(fds[1].fd, stderr_pending)) fds[1].fd = -1;
                // masscan redraws its status line with \r, other messages end with \n.
                drain_lines(stderr_pending, "\r\n", on_stderr_line);
            }
        }
        const auto now = std::chrono::steady_clock::now();
        if (now >= next_progress && callbacks.on_progress) {
            callbacks.on_progress({.status = last_status,
                                   .elapsed = now - started,
                                   .open_ports_reported = open_ports_reported});
            next_progress = now + config.progress_interval;
        }
    }

    supervisor.request_stop();
    supervisor.join();
    outcome.exit_code = child->wait();
    outcome.stop_reason = stop_reason.load();
    outcome.was_killed = was_killed.load();
    outcome.resume_index = read_resume_index(work_dir->path() / "paused.conf");
    for (const std::string& message : recent_messages) {
        outcome.diagnostics += outcome.diagnostics.empty() ? message : " | " + message;
    }
    logger.info("masscan.exited", "masscan exited",
                {{"exit_code", outcome.exit_code},
                 {"elapsed_s", std::chrono::duration_cast<std::chrono::seconds>(
                                   std::chrono::steady_clock::now() - started)
                                   .count()},
                 {"open_ports_reported", open_ports_reported}});
    return outcome;
}

}  // namespace masscan_worker
