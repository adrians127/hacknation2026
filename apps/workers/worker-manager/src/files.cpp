#include "files.hpp"

#include <unistd.h>

#include <cstdlib>
#include <format>
#include <fstream>
#include <iterator>
#include <string_view>
#include <system_error>

namespace worker_manager {

std::expected<std::string, std::string> read_text_file(const std::filesystem::path& path) {
    std::ifstream file{path, std::ios::binary};
    if (!file) {
        return std::unexpected(std::format("cannot read '{}'", path.string()));
    }
    return std::string{std::istreambuf_iterator<char>{file}, {}};
}

bool write_json_file(const std::filesystem::path& path, const Json& value) {
    std::filesystem::path temp = path;
    temp += std::format(".tmp-{}", ::getpid());
    {
        std::ofstream file{temp, std::ios::binary | std::ios::trunc};
        file << value.dump(2, ' ', false, Json::error_handler_t::replace) << '\n';
        if (!file.flush()) {
            return false;
        }
    }
    std::error_code ec;
    std::filesystem::rename(temp, path, ec);
    if (ec) {
        std::filesystem::remove(temp, ec);
        return false;
    }
    return true;
}

std::optional<std::filesystem::path> find_executable(const std::string& name) {
    if (name.empty()) {
        return std::nullopt;
    }
    const auto is_executable = [](const std::filesystem::path& candidate) {
        std::error_code ec;
        return std::filesystem::is_regular_file(candidate, ec) &&
               ::access(candidate.c_str(), X_OK) == 0;
    };
    if (name.find('/') != std::string::npos) {
        std::error_code ec;
        const auto absolute = std::filesystem::absolute(name, ec);
        if (!ec && is_executable(absolute)) {
            return absolute;
        }
        return std::nullopt;
    }
    const char* path_env = std::getenv("PATH");
    std::string_view dirs = path_env != nullptr ? path_env : "/usr/local/bin:/usr/bin:/bin";
    while (true) {
        const auto colon = dirs.find(':');
        const std::string_view dir = dirs.substr(0, colon);
        if (!dir.empty()) {
            const std::filesystem::path candidate = std::filesystem::path{dir} / name;
            if (is_executable(candidate)) {
                return candidate;
            }
        }
        if (colon == std::string_view::npos) {
            return std::nullopt;
        }
        dirs.remove_prefix(colon + 1);
    }
}

}  // namespace worker_manager
