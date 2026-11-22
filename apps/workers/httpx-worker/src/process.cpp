#include "process.hpp"

#include <algorithm>
#include <cerrno>
#include <csignal>
#include <cstdio>
#include <cstring>
#include <fcntl.h>
#include <fstream>
#include <iterator>
#include <string>
#include <sys/wait.h>
#include <thread>
#include <unistd.h>

namespace httpx_worker {
namespace {

class TempFile {
public:
    explicit TempFile(const char* prefix) {
        path_ = std::string{"/tmp/"} + prefix + "-XXXXXX";
        fd_ = ::mkstemp(path_.data());
    }
    TempFile(const TempFile&) = delete;
    TempFile& operator=(const TempFile&) = delete;
    ~TempFile() {
        if (fd_ >= 0) ::close(fd_);
        if (fd_ >= 0) ::unlink(path_.c_str());
    }
    bool valid() const { return fd_ >= 0; }
    int fd() const { return fd_; }
    const std::string& path() const { return path_; }
private:
    std::string path_;
    int fd_ = -1;
};

bool write_all(int fd, const std::string& text) {
    std::size_t offset = 0;
    while (offset < text.size()) {
        const auto written = ::write(fd, text.data() + offset, text.size() - offset);
        if (written < 0 && errno == EINTR) continue;
        if (written <= 0) return false;
        offset += static_cast<std::size_t>(written);
    }
    return true;
}

std::string read_bounded(const std::string& path, std::size_t limit) {
    std::ifstream file{path, std::ios::binary};
    std::string content;
    content.reserve(8192);
    char buffer[8192];
    while (file.read(buffer, sizeof buffer) || file.gcount() > 0) {
        auto size = static_cast<std::size_t>(file.gcount());
        if (content.size() + size > limit) return {};
        content.append(buffer, size);
    }
    return content;
}

} // namespace

std::expected<ProcessResult, Error> run_httpx(const Job& job, const Target& target,
                                                const std::string& domain,
                                                const std::string& binary,
                                                std::stop_token stop) {
    TempFile urls{"httpx-worker-urls"};
    TempFile paths{"httpx-worker-paths"};
    TempFile output{"httpx-worker-output"};
    TempFile errors{"httpx-worker-errors"};
    if (!urls.valid() || !paths.valid() || !output.valid() || !errors.valid())
        return std::unexpected(Error{"io-error", "Cannot create httpx temporary files"});

    std::string url_text;
    for (const auto& range : target.ports) {
        for (std::uint32_t port = range.first; port <= range.last; ++port) {
            for (const auto& scheme : {"http", "https"})
                url_text += std::string{scheme} + "://" + target.ip + ":" +
                            std::to_string(port) + "/\n";
        }
    }
    if (!write_all(urls.fd(), url_text))
        return std::unexpected(Error{"io-error", "Cannot write httpx input"});
    std::string path_text = "/\n";
    if (std::ranges::find(job.probe_paths, kFaviconPath) == job.probe_paths.end())
        path_text += std::string{kFaviconPath} + "\n";
    for (const auto& path : job.probe_paths) path_text += path + "\n";
    if (!write_all(paths.fd(), path_text))
        return std::unexpected(Error{"io-error", "Cannot write httpx paths"});

    std::vector<std::string> args{binary, "-l", urls.path(), "-path", paths.path(),
        "-json", "-silent", "-no-color", "-nfs", "-no-stdin", "-duc",
        "-probe", "-sc", "-title", "-server", "-ct", "-cl", "-location",
        "-irr", "-timeout", std::to_string(job.limits.timeout_seconds),
        "-rstr", std::to_string(job.limits.max_body_bytes),
        "-rsts", std::to_string(job.limits.max_body_bytes),
        "-rl", std::to_string(job.limits.rate),
        "-t", std::to_string(job.limits.threads), "-retries", "0",
        "-hash", "mmh3,sha256",
        "-maxhr", std::to_string(request_paths(job))};
    if (!domain.empty()) {
        args.insert(args.end(), {"-H", "Host: " + domain, "-sni", domain});
    }
    std::vector<char*> argv;
    for (auto& arg : args) argv.push_back(arg.data());
    argv.push_back(nullptr);

    const pid_t pid = ::fork();
    if (pid < 0) return std::unexpected(Error{"spawn-failed", std::strerror(errno)});
    if (pid == 0) {
        ::setpgid(0, 0);
        sigset_t clear{};
        sigemptyset(&clear);
        ::sigprocmask(SIG_SETMASK, &clear, nullptr);
        ::dup2(output.fd(), STDOUT_FILENO);
        ::dup2(errors.fd(), STDERR_FILENO);
        ::execvp(binary.c_str(), argv.data());
        ::_exit(127);
    }
    ::setpgid(pid, pid);
    int status = 0;
    bool stopping = false;
    auto stopped_at = std::chrono::steady_clock::time_point{};
    while (true) {
        const pid_t waited = ::waitpid(pid, &status, WNOHANG);
        if (waited == pid) break;
        if (waited < 0 && errno != EINTR) {
            ::kill(-pid, SIGKILL);
            ::waitpid(pid, &status, 0);
            return std::unexpected(Error{"scanner-failed", "Cannot wait for httpx"});
        }
        const auto now = std::chrono::steady_clock::now();
        if (!stopping && (stop.stop_requested() || now >= job.deadline)) {
            ::kill(-pid, SIGTERM);
            stopping = true;
            stopped_at = now;
        }
        if (stopping && now - stopped_at > std::chrono::seconds{2}) ::kill(-pid, SIGKILL);
        std::this_thread::sleep_for(std::chrono::milliseconds{25});
    }
    ProcessResult result;
    result.exit_code = WIFEXITED(status) ? WEXITSTATUS(status) : 1;
    result.stopped = stopping;
    result.jsonl = read_bounded(output.path(), 128 * 1024 * 1024);
    if (result.jsonl.empty() && ::lseek(output.fd(), 0, SEEK_END) > 0)
        return std::unexpected(Error{"scanner-failed", "httpx output exceeded 128 MiB"});
    if (result.exit_code == 127)
        return std::unexpected(Error{"scanner-unavailable", "Cannot execute httpx binary"});
    if (result.exit_code != 0 && !result.stopped) {
        result.stderr_text = read_bounded(errors.path(), 65536).substr(0, 4096);
    }
    return result;
}

} // namespace httpx_worker
