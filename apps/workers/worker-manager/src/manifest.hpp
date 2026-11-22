#pragma once

#include <expected>
#include <filesystem>
#include <optional>
#include <string>
#include <string_view>

#include "files.hpp"

namespace worker_manager {

// A worker's manifest, `<dir>/<name>.json`, tells the backend what the worker can do (README.md,
// "Worker manifests"). It is sent with every lease request as one entry of `worker_specs[]`.

// The `worker_specs[]` entry: `name` followed by the manifest's fields. Checks the shape and the
// values the manager itself knows (inputs, split strategies); the backend checks `param_fields`.
[[nodiscard]] std::expected<Json, std::string> worker_spec(std::string_view name,
                                                           const Json& manifest);

// nullopt when the worker has no manifest file; an error when it is unreadable or invalid.
[[nodiscard]] std::expected<std::optional<Json>, std::string> load_worker_spec(
    const std::filesystem::path& dir, std::string_view name);

}  // namespace worker_manager
