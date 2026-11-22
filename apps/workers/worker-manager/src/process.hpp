#pragma once

#include <sys/types.h>

#include <expected>
#include <span>
#include <string>
#include <utility>

namespace worker_manager {

class UniqueFd {
public:
    UniqueFd() noexcept = default;
    explicit UniqueFd(int fd) noexcept : fd_{fd} {}
    UniqueFd(UniqueFd&& other) noexcept : fd_{std::exchange(other.fd_, -1)} {}
    UniqueFd& operator=(UniqueFd&& other) noexcept;
    UniqueFd(const UniqueFd&) = delete;
    UniqueFd& operator=(const UniqueFd&) = delete;
    ~UniqueFd() noexcept;

    [[nodiscard]] int get() const noexcept { return fd_; }
    [[nodiscard]] bool is_valid() const noexcept { return fd_ >= 0; }
    void reset() noexcept;

private:
    int fd_ = -1;
};

struct Pipe {
    UniqueFd read_end;
    UniqueFd write_end;
};

[[nodiscard]] std::expected<Pipe, std::string> make_pipe();

// Owns a child running in its own process group; signals go to the whole group.
// The destructor kills and reaps a child that was never waited for.
class ChildProcess {
public:
    explicit ChildProcess(pid_t pid) noexcept : pid_{pid} {}
    ChildProcess(ChildProcess&& other) noexcept : pid_{std::exchange(other.pid_, -1)} {}
    ChildProcess& operator=(ChildProcess&&) = delete;
    ChildProcess(const ChildProcess&) = delete;
    ChildProcess& operator=(const ChildProcess&) = delete;
    ~ChildProcess() noexcept;

    [[nodiscard]] pid_t pid() const noexcept { return pid_; }
    void send_signal(int signal) const noexcept;
    // Exit code, or 128 + signal number when the child was killed.
    [[nodiscard]] int wait() noexcept;

private:
    pid_t pid_;
};

struct SpawnOptions {
    std::span<const std::string> argv;  // argv[0] is looked up in PATH
    int stdout_fd = -1;                 // -1 keeps the parent's descriptor
    int stderr_fd = -1;
};

[[nodiscard]] std::expected<ChildProcess, std::string> spawn_process(const SpawnOptions& options);

// Writes all of `size` bytes, retrying on EINTR and short writes.
bool write_all(int fd, const char* data, std::size_t size) noexcept;

}  // namespace worker_manager
