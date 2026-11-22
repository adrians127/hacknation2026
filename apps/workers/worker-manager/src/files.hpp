#pragma once

#include <expected>
#include <filesystem>
#include <nlohmann/json.hpp>
#include <optional>
#include <string>

namespace worker_manager {

using Json = nlohmann::ordered_json;

[[nodiscard]] std::expected<std::string, std::string> read_text_file(
    const std::filesystem::path& path);

// Indented JSON, written to a temp file and renamed, so a reader never sees half a document.
[[nodiscard]] bool write_json_file(const std::filesystem::path& path, const Json& value);

// The binary as an absolute path: `name` itself when it contains a '/', otherwise the first
// executable match in PATH.
[[nodiscard]] std::optional<std::filesystem::path> find_executable(const std::string& name);

}  // namespace worker_manager
