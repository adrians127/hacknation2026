#include "process.hpp"

#include <fcntl.h>
#include <sys/prctl.h>
#include <sys/wait.h>
#include <unistd.h>

#include <array>
#include <cerrno>
#include <csignal>
#include <cstring>
#include <format>
#include <vector>

namespace masscan_worker {

UniqueFd& UniqueFd::operator=(UniqueFd&& other) noexcept {
    if (this != &other) {
        reset();
        fd_ = std::exchange(other.fd_, -1);
    }
    return *this;
}

UniqueFd::~UniqueFd() noexcept { reset(); }

void UniqueFd::reset() noexcept {
    if (fd_ >= 0) {
        ::close(fd_);
        fd_ = -1;
    }
}

std::expected<Pipe, Error> make_pipe() {
    std::array<int, 2> fds{};
    if (::pipe2(fds.data(), O_CLOEXEC) != 0) {
        return std::unexpected(
            Error{ErrorCode::kIo, std::format("pipe2: {}", std::strerror(errno))});
    }
    return Pipe{UniqueFd{fds[0]}, UniqueFd{fds[1]}};
}

ChildProcess::~ChildProcess() noexcept {
    if (pid_ > 0) {
        ::kill(-pid_, SIGKILL);
        int status = 0;
        ::waitpid(pid_, &status, 0);
    }
}

void ChildProcess::send_signal(int signal) const noexcept {
    if (pid_ > 0) {
        ::kill(-pid_, signal);
    }
}

int ChildProcess::wait() noexcept {
    if (pid_ <= 0) {
        return -1;
    }
    int status = 0;
    while (::waitpid(pid_, &status, 0) < 0) {
        if (errno != EINTR) {
            pid_ = -1;
            return -1;
        }
    }
    pid_ = -1;
    if (WIFEXITED(status)) {
        return WEXITSTATUS(status);
    }
    return WIFSIGNALED(status) ? 128 + WTERMSIG(status) : -1;
}

std::expected<ChildProcess, Error> spawn_process(const SpawnOptions& options) {
    if (options.argv.empty()) {
        return std::unexpected(Error{ErrorCode::kScannerUnavailable, "empty argv"});
    }
    // Everything the child needs is prepared before fork: only async-signal-safe calls after it.
    std::vector<char*> argv;
    argv.reserve(options.argv.size() + 1);
    for (const std::string& arg : options.argv) {
        // execvp's signature predates const-correctness; it never writes to the strings.
        argv.push_back(const_cast<char*>(arg.c_str()));
    }
    argv.push_back(nullptr);
    const std::string cwd = options.working_directory ? options.working_directory->string() : "";
    const pid_t parent_pid = ::getpid();

    const pid_t pid = ::fork();
    if (pid < 0) {
        return std::unexpected(
            Error{ErrorCode::kScannerUnavailable, std::format("fork: {}", std::strerror(errno))});
    }
    if (pid == 0) {
        // The parent blocks SIGINT/SIGTERM for its signal thread; the mask survives exec.
        sigset_t all{};
        sigemptyset(&all);
        ::sigprocmask(SIG_SETMASK, &all, nullptr);
        // Own process group: a terminal ^C reaches only the worker, which decides how to stop
        // masscan, and signals reach anything masscan forks.
        ::setpgid(0, 0);
        // masscan must not outlive a worker that was SIGKILLed by its orchestrator.
        ::prctl(PR_SET_PDEATHSIG, SIGKILL);
        if (::getppid() != parent_pid) {
            ::_exit(127);
        }
        if (options.stdout_fd >= 0 && ::dup2(options.stdout_fd, STDOUT_FILENO) < 0) {
            ::_exit(127);
        }
        if (options.stderr_fd >= 0 && ::dup2(options.stderr_fd, STDERR_FILENO) < 0) {
            ::_exit(127);
        }
        if (!cwd.empty() && ::chdir(cwd.c_str()) != 0) {
            ::_exit(127);
        }
        ::execvp(argv[0], argv.data());
        ::_exit(127);
    }
    // Also set from the parent so a signal sent right after fork already finds the group.
    ::setpgid(pid, pid);
    return ChildProcess{pid};
}

}  // namespace masscan_worker
