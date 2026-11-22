#include "nmap_process.hpp"

#include <cerrno>
#include <chrono>
#include <csignal>
#include <cstdint>
#include <expected>
#include <fcntl.h>
#include <fstream>
#include <iterator>
#include <spawn.h>
#include <string>
#include <string_view>
#include <sys/wait.h>
#include <system_error>
#include <thread>
#include <unistd.h>
#include <utility>
#include <vector>

extern char** environ;

namespace nmap_worker {
namespace {

class TemporaryFile {
public:
    TemporaryFile(const TemporaryFile&) = delete;
    TemporaryFile& operator=(const TemporaryFile&) = delete;

    TemporaryFile(TemporaryFile&& other) noexcept
        : path_(std::exchange(other.path_, {})),
          descriptor_(std::exchange(other.descriptor_, -1)) {}

    TemporaryFile& operator=(TemporaryFile&& other) noexcept {
        if (this != &other) {
            cleanup();
            path_ = std::exchange(other.path_, {});
            descriptor_ = std::exchange(other.descriptor_, -1);
        }
        return *this;
    }

    ~TemporaryFile() noexcept { cleanup(); }

    [[nodiscard]] static std::expected<TemporaryFile, Error> create() {
        std::string pattern = "/tmp/nmap-worker-XXXXXX";
        const int descriptor = mkstemp(pattern.data());
        if (descriptor < 0) {
            return std::unexpected(Error{
                "temp-file-failed", std::error_code{errno, std::generic_category()}.message()});
        }
        return TemporaryFile{std::move(pattern), descriptor};
    }

    [[nodiscard]] const std::string& path() const noexcept { return path_; }
    [[nodiscard]] int descriptor() const noexcept { return descriptor_; }

private:
    TemporaryFile(std::string path, int descriptor)
        : path_(std::move(path)), descriptor_(descriptor) {}

    void cleanup() noexcept {
        if (descriptor_ >= 0) close(descriptor_);
        if (!path_.empty()) unlink(path_.c_str());
        descriptor_ = -1;
        path_.clear();
    }

    std::string path_;
    int descriptor_ = -1;
};

class SpawnActions {
public:
    SpawnActions() : error_(posix_spawn_file_actions_init(&actions_)) {}
    SpawnActions(const SpawnActions&) = delete;
    SpawnActions& operator=(const SpawnActions&) = delete;
    ~SpawnActions() noexcept {
        if (error_ == 0) posix_spawn_file_actions_destroy(&actions_);
    }

    [[nodiscard]] bool is_valid() const noexcept { return error_ == 0; }
    [[nodiscard]] int error() const noexcept { return error_; }
    [[nodiscard]] posix_spawn_file_actions_t* get() noexcept { return &actions_; }

private:
    posix_spawn_file_actions_t actions_{};
    int error_ = 0;
};

class SpawnAttributes {
public:
    SpawnAttributes()
        : error_(posix_spawnattr_init(&attributes_)), is_initialized_(error_ == 0) {
        if (!is_initialized_) return;
        sigset_t none{};
        sigemptyset(&none);
        error_ = posix_spawnattr_setsigmask(&attributes_, &none);
        if (error_ == 0) {
            error_ = posix_spawnattr_setflags(&attributes_, POSIX_SPAWN_SETSIGMASK);
        }
    }
    SpawnAttributes(const SpawnAttributes&) = delete;
    SpawnAttributes& operator=(const SpawnAttributes&) = delete;
    ~SpawnAttributes() noexcept {
        if (is_initialized_) posix_spawnattr_destroy(&attributes_);
    }

    [[nodiscard]] bool is_valid() const noexcept { return error_ == 0; }
    [[nodiscard]] int error() const noexcept { return error_; }
    [[nodiscard]] posix_spawnattr_t* get() noexcept { return &attributes_; }

private:
    posix_spawnattr_t attributes_{};
    int error_;
    bool is_initialized_;
};

class ChildProcess {
public:
    explicit ChildProcess(pid_t pid) : pid_(pid) {}
    ChildProcess(const ChildProcess&) = delete;
    ChildProcess& operator=(const ChildProcess&) = delete;
    ~ChildProcess() noexcept {
        if (pid_ > 0) {
            kill(pid_, SIGKILL);
            int status = 0;
            while (waitpid(pid_, &status, 0) < 0 && errno == EINTR) {
            }
        }
    }

    void mark_reaped() noexcept { pid_ = -1; }
    void terminate() const noexcept {
        if (pid_ > 0) kill(pid_, SIGTERM);
    }
    void force_kill() const noexcept {
        if (pid_ > 0) kill(pid_, SIGKILL);
    }
    [[nodiscard]] pid_t pid() const noexcept { return pid_; }

private:
    pid_t pid_;
};

std::expected<std::string, Error> read_bounded(std::string_view path, std::size_t maximum_size) {
    std::ifstream stream{std::string{path}, std::ios::binary | std::ios::ate};
    if (!stream) return std::unexpected(Error{"output-read-failed", "Cannot read Nmap output"});
    const auto size = stream.tellg();
    if (size < 0 || static_cast<std::uintmax_t>(size) > maximum_size) {
        return std::unexpected(Error{"output-too-large", "Nmap output exceeded the size limit"});
    }
    stream.seekg(0);
    return std::string{std::istreambuf_iterator<char>{stream}, std::istreambuf_iterator<char>{}};
}

// Ranges, not one entry per port: a single argv string is limited to 128 KiB.
std::string port_list(const Target& target) { return format_port_ranges(target.ports); }

}  // namespace

std::expected<NmapOutput, Error> run_nmap(const Target& target, const ScanLimits& limits,
                                          const NmapProcessConfig& config,
                                          std::chrono::steady_clock::time_point deadline,
                                          std::stop_token stop_token) {
    auto xml_file = TemporaryFile::create();
    if (!xml_file) return std::unexpected(xml_file.error());
    auto stderr_file = TemporaryFile::create();
    if (!stderr_file) return std::unexpected(stderr_file.error());

    std::vector<std::string> arguments{config.binary,
                                       "-n",
                                       "-Pn",
                                       config.scan_type,
                                       "-sV",
                                       "--version-light",
                                       "--max-rate",
                                       std::to_string(limits.max_rate_per_process),
                                       "-p",
                                       port_list(target),
                                       "-oX",
                                       xml_file->path(),
                                       target.ip};
    std::vector<char*> argument_pointers;
    argument_pointers.reserve(arguments.size() + 1);
    for (auto& argument : arguments) argument_pointers.push_back(argument.data());
    argument_pointers.push_back(nullptr);

    SpawnActions actions;
    if (!actions.is_valid()) {
        return std::unexpected(Error{
            "spawn-failed", std::error_code{actions.error(), std::generic_category()}.message()});
    }
    int action_error =
        posix_spawn_file_actions_addopen(actions.get(), STDOUT_FILENO, "/dev/null", O_WRONLY, 0);
    if (action_error == 0) {
        action_error = posix_spawn_file_actions_adddup2(actions.get(), stderr_file->descriptor(),
                                                        STDERR_FILENO);
    }
    if (action_error == 0) {
        action_error = posix_spawn_file_actions_addclose(actions.get(), stderr_file->descriptor());
    }
    if (action_error == 0) {
        action_error = posix_spawn_file_actions_addclose(actions.get(), xml_file->descriptor());
    }
    if (action_error != 0) {
        return std::unexpected(Error{
            "spawn-failed", std::error_code{action_error, std::generic_category()}.message()});
    }

    // The worker blocks SIGINT/SIGTERM for its signal thread and the mask survives exec;
    // Nmap must start with none blocked, or terminate() could not stop it.
    SpawnAttributes attributes;
    if (!attributes.is_valid()) {
        return std::unexpected(Error{
            "spawn-failed", std::error_code{attributes.error(), std::generic_category()}.message()});
    }
    pid_t pid = -1;
    const int spawn_error = posix_spawnp(&pid, config.binary.c_str(), actions.get(),
                                         attributes.get(), argument_pointers.data(), environ);
    if (spawn_error != 0) {
        return std::unexpected(
            Error{"spawn-failed", std::error_code{spawn_error, std::generic_category()}.message()});
    }
    ChildProcess child{pid};
    bool is_stopping = false;
    bool is_timed_out = false;
    auto stop_started = std::chrono::steady_clock::time_point{};
    int status = 0;
    while (true) {
        const pid_t waited = waitpid(child.pid(), &status, WNOHANG);
        if (waited == child.pid()) {
            child.mark_reaped();
            break;
        }
        if (waited < 0 && errno != EINTR) {
            return std::unexpected(
                Error{"wait-failed", std::error_code{errno, std::generic_category()}.message()});
        }
        const auto now = std::chrono::steady_clock::now();
        if (!is_stopping && (stop_token.stop_requested() || now >= deadline)) {
            is_stopping = true;
            is_timed_out = !stop_token.stop_requested();
            stop_started = now;
            child.terminate();
        }
        if (is_stopping && now - stop_started > std::chrono::seconds{1}) child.force_kill();
        std::this_thread::sleep_for(std::chrono::milliseconds{25});
    }
    if (is_stopping) {
        return std::unexpected(
            Error{is_timed_out ? "timeout" : "cancelled",
                  is_timed_out ? "Nmap exceeded the deadline" : "Scan was cancelled"});
    }
    const auto stderr_text = read_bounded(stderr_file->path(), 65536);
    if (!stderr_text) return std::unexpected(stderr_text.error());
    if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) {
        return std::unexpected(Error{
            "nmap-exit", stderr_text->empty() ? "Nmap exited with an error" : *stderr_text});
    }
    const auto xml = read_bounded(xml_file->path(), 4 * 1024 * 1024);
    if (!xml) return std::unexpected(xml.error());
    return NmapOutput{.xml = *xml, .stderr_text = *stderr_text};
}

}  // namespace nmap_worker
