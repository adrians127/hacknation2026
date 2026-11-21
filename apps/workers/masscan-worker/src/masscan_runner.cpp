#include "masscan_runner.hpp"

#include <fcntl.h>
#include <unistd.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <cerrno>
#include <charconv>
#include <chrono>
#include <csignal>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <format>
#include <fstream>
#include <nlohmann/json.hpp>
#include <span>
#include <sstream>
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

std::string read_file(const std::filesystem::path& path) {
    std::ifstream file{path, std::ios::binary};
    std::ostringstream content;
    content << file.rdbuf();
    return std::move(content).str();
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

// Drops the \r-separated progress lines masscan prints to stderr; keeps the last few real ones.
std::string summarize_stderr(std::string_view log) {
    std::vector<std::string_view> lines;
    while (!log.empty()) {
        const std::size_t end = log.find_first_of("\r\n");
        const std::string_view line = log.substr(0, end);
        if (!line.empty() && !line.starts_with("rate:") &&
            line.find_first_not_of(' ') != line.npos) {
            lines.push_back(line);
        }
        log = end == std::string_view::npos ? std::string_view{} : log.substr(end + 1);
    }
    constexpr std::size_t kKeep = 6;
    std::string out;
    for (std::size_t i = lines.size() > kKeep ? lines.size() - kKeep : 0; i < lines.size(); ++i) {
        if (!out.empty()) {
            out += " | ";
        }
        out += lines[i];
    }
    return out;
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
    return Finding{*address, static_cast<std::uint16_t>(port_number),
                   static_cast<std::uint8_t>(ttl)};
}

std::expected<ScanOutcome, Error> run_masscan(const ScanJob& job, const Config& config,
                                              const FindingSink& on_finding) {
    auto work_dir = TempDir::create();
    if (!work_dir) return std::unexpected(work_dir.error());
    const auto target_file = work_dir->path() / "targets.txt";
    const auto log_file = work_dir->path() / "masscan.log";
    if (auto written = write_target_file(target_file, job.ranges); !written) {
        return std::unexpected(written.error());
    }

    auto pipe = make_pipe();
    if (!pipe) return std::unexpected(pipe.error());
    const UniqueFd log_fd{::open(log_file.c_str(), O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0600)};
    if (!log_fd.is_valid()) {
        return std::unexpected(Error{
            ErrorCode::kIo, std::format("open {}: {}", log_file.string(), std::strerror(errno))});
    }

    const auto args = build_masscan_args(job, config, target_file);
    auto child = spawn_process({.argv = args,
                                .working_directory = work_dir->path(),
                                .stdout_fd = pipe->write_end.get(),
                                .stderr_fd = log_fd.get()});
    if (!child) return std::unexpected(child.error());
    pipe->write_end.reset();

    std::optional<std::chrono::steady_clock::time_point> deadline;
    if (job.max_duration) {
        deadline = std::chrono::steady_clock::now() + *job.max_duration;
    }
    std::atomic<StopReason> stop_reason{StopReason::kNone};
    std::atomic<bool> was_killed{false};
    const auto kill_after = job.wait + kKillGrace;

    // The child is reaped only after this thread is joined, so its pid cannot be recycled
    // while the thread may still signal it.
    std::jthread supervisor{[&child, &stop_reason, &was_killed, deadline,
                             kill_after](const std::stop_token& token) noexcept {
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
                StopReason reason = StopReason::kNone;
                if (signal == SIGINT || signal == SIGTERM) {
                    reason = StopReason::kSignal;
                } else if (deadline && now >= *deadline) {
                    reason = StopReason::kTimeWindow;
                }
                if (reason != StopReason::kNone) {
                    stop_reason = reason;
                    child->send_signal(SIGINT);  // graceful: masscan writes paused.conf
                    interrupted_at = now;
                }
            } else if (!has_killed && (signal > 0 || now - *interrupted_at >= kill_after)) {
                child->send_signal(SIGKILL);
                was_killed = true;
                has_killed = true;
            }
        }
    }};

    ScanOutcome outcome;
    std::string pending;
    std::array<char, kReadChunk> buffer{};
    while (true) {
        const ssize_t count = ::read(pipe->read_end.get(), buffer.data(), buffer.size());
        if (count == 0) break;
        if (count < 0) {
            if (errno == EINTR) continue;
            break;
        }
        pending.append(buffer.data(), static_cast<std::size_t>(count));
        std::size_t line_start = 0;
        for (std::size_t newline = pending.find('\n'); newline != std::string::npos;
             newline = pending.find('\n', line_start)) {
            const std::string_view line{pending.data() + line_start, newline - line_start};
            if (!line.empty()) {
                if (const auto finding = parse_finding(line)) {
                    on_finding(*finding);
                } else if (line.front() == '{' && line.find("\"status\"") != line.npos) {
                    ++outcome.malformed_lines;
                }
            }
            line_start = newline + 1;
        }
        pending.erase(0, line_start);
    }

    supervisor.request_stop();
    supervisor.join();
    outcome.exit_code = child->wait();
    outcome.stop_reason = stop_reason.load();
    outcome.was_killed = was_killed.load();
    outcome.resume_index = read_resume_index(work_dir->path() / "paused.conf");
    outcome.diagnostics = summarize_stderr(read_file(log_file));
    return outcome;
}

}  // namespace masscan_worker
