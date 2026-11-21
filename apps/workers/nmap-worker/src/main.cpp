// Scan worker skeleton. For now it only proves the toolchain and the nmap binary
// work; the HTTP pull loop (lease job -> run nmap -> post results) lands later,
// see apps/workers/README.md.

#include <array>
#include <cstdio>
#include <cstdlib>
#include <memory>
#include <optional>
#include <print>
#include <string>
#include <string_view>

namespace {

std::string env_or(const char* name, std::string_view fallback) {
    const char* value = std::getenv(name);
    return (value != nullptr && *value != '\0') ? std::string{value} : std::string{fallback};
}

// First line of `nmap --version`, or nullopt when nmap is missing or fails.
std::optional<std::string> nmap_version() {
    struct PipeCloser {
        void operator()(FILE* pipe) const { pclose(pipe); }
    };
    std::unique_ptr<FILE, PipeCloser> pipe{popen("nmap --version 2>/dev/null", "r")};
    if (!pipe) {
        return std::nullopt;
    }

    std::array<char, 256> buffer{};
    if (std::fgets(buffer.data(), static_cast<int>(buffer.size()), pipe.get()) == nullptr) {
        return std::nullopt;
    }

    std::string line{buffer.data()};
    if (!line.empty() && line.back() == '\n') {
        line.pop_back();
    }
    return line;
}

}  // namespace

int main() {
    const std::string backend_url = env_or("BACKEND_URL", "http://localhost:3001/v1");

    std::println("nmap-worker {} starting", NMAP_WORKER_VERSION);
    std::println("backend: {}", backend_url);

    const auto version = nmap_version();
    if (!version) {
        std::println(stderr, "error: nmap not found or not runnable");
        return EXIT_FAILURE;
    }

    std::println("{}", *version);
    return EXIT_SUCCESS;
}
