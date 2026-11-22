#include "manifest.hpp"

#include <algorithm>
#include <array>
#include <cstdint>
#include <format>
#include <string>
#include <system_error>
#include <utility>

#include "job.hpp"

namespace worker_manager {

namespace {

constexpr std::array<std::string_view, 6> kKnownKeys = {
    "display_name", "description", "inputs", "split_strategies", "param_fields", "max_rate"};
constexpr std::array<std::string_view, 2> kInputs = {"targets", "hosts"};
constexpr std::array<SplitStrategy, 4> kSplitStrategies = {
    SplitStrategy::kNone, SplitStrategy::kShard, SplitStrategy::kRanges, SplitStrategy::kChunk};
constexpr std::size_t kMaxDisplayName = 100;
constexpr std::size_t kMaxDescription = 500;
constexpr std::size_t kMaxParamFields = 32;
// The backend's WORKER_MAX_RATE_LIMIT.
constexpr std::uint64_t kMaxRate = 100'000;

bool is_split_strategy(std::string_view name) {
    return std::ranges::any_of(
        kSplitStrategies, [name](SplitStrategy strategy) { return to_string(strategy) == name; });
}

// A non-empty array of distinct strings that `is_allowed` accepts.
std::expected<void, std::string> check_names(const Json& manifest, std::string_view key,
                                             bool (*is_allowed)(std::string_view)) {
    const auto it = manifest.find(key);
    if (it == manifest.end() || !it->is_array() || it->empty()) {
        return std::unexpected(std::format("'{}' must be a non-empty array", key));
    }
    for (std::size_t i = 0; i < it->size(); ++i) {
        const Json& item = (*it)[i];
        if (!item.is_string() || !is_allowed(item.get<std::string>())) {
            return std::unexpected(std::format("'{}' has an unknown value: {}", key, item.dump()));
        }
        for (std::size_t j = 0; j < i; ++j) {
            if ((*it)[j] == item) {
                return std::unexpected(std::format("'{}' lists {} twice", key, item.dump()));
            }
        }
    }
    return {};
}

std::expected<void, std::string> check_optional_string(const Json& manifest, std::string_view key,
                                                       std::size_t max_length, bool non_blank) {
    const auto it = manifest.find(key);
    if (it == manifest.end()) return {};
    if (!it->is_string()) return std::unexpected(std::format("'{}' must be a string", key));
    const auto& text = it->get_ref<const std::string&>();
    if (text.size() > max_length) {
        return std::unexpected(std::format("'{}' is longer than {} characters", key, max_length));
    }
    if (non_blank && text.find_first_not_of(" \t\r\n") == std::string::npos) {
        return std::unexpected(std::format("'{}' must not be blank", key));
    }
    return {};
}

std::expected<void, std::string> check_param_fields(const Json& manifest) {
    const auto it = manifest.find("param_fields");
    if (it == manifest.end()) return {};
    if (!it->is_array() || it->size() > kMaxParamFields) {
        return std::unexpected(
            std::format("'param_fields' must be an array of at most {} fields", kMaxParamFields));
    }
    for (const Json& field : *it) {
        const bool has_key = field.is_object() && field.contains("key") && field["key"].is_string();
        const bool has_type = has_key && field.contains("type") && field["type"].is_string();
        if (!has_type) {
            return std::unexpected(std::string{
                "every 'param_fields' entry must be an object with a 'key' and a 'type'"});
        }
    }
    return {};
}

std::expected<void, std::string> check_max_rate(const Json& manifest) {
    const auto it = manifest.find("max_rate");
    if (it == manifest.end()) return {};
    if (!it->is_number_unsigned() || it->get<std::uint64_t>() == 0 ||
        it->get<std::uint64_t>() > kMaxRate) {
        return std::unexpected(std::format("'max_rate' must be an integer in 1..{}", kMaxRate));
    }
    return {};
}

}  // namespace

std::expected<Json, std::string> worker_spec(std::string_view name, const Json& manifest) {
    if (!manifest.is_object()) return std::unexpected(std::string{"not a JSON object"});
    for (const auto& [key, value] : manifest.items()) {
        if (std::ranges::find(kKnownKeys, key) == kKnownKeys.end()) {
            return std::unexpected(std::format("unknown field '{}'", key));
        }
    }
    const auto is_input = [](std::string_view value) {
        return std::ranges::find(kInputs, value) != kInputs.end();
    };
    for (const auto& checked :
         {check_names(manifest, "inputs", is_input),
          check_names(manifest, "split_strategies", is_split_strategy),
          check_optional_string(manifest, "display_name", kMaxDisplayName, true),
          check_optional_string(manifest, "description", kMaxDescription, false),
          check_param_fields(manifest), check_max_rate(manifest)}) {
        if (!checked) return std::unexpected(checked.error());
    }

    Json spec = Json::object();
    spec["name"] = std::string{name};
    for (const auto& [key, value] : manifest.items()) spec[key] = value;
    return spec;
}

std::expected<std::optional<Json>, std::string> load_worker_spec(const std::filesystem::path& dir,
                                                                 std::string_view name) {
    const std::filesystem::path path = dir / std::format("{}.json", name);
    std::error_code error;
    if (!std::filesystem::exists(path, error)) {
        if (error) return std::unexpected(std::format("{}: {}", path.string(), error.message()));
        return std::optional<Json>{};
    }
    const auto text = read_text_file(path);
    if (!text) return std::unexpected(std::format("{}: {}", path.string(), text.error()));
    const Json manifest = Json::parse(*text, nullptr, false);
    if (manifest.is_discarded()) {
        return std::unexpected(std::format("{}: not valid JSON", path.string()));
    }
    auto spec = worker_spec(name, manifest);
    if (!spec) return std::unexpected(std::format("{}: {}", path.string(), spec.error()));
    return std::optional<Json>{std::move(*spec)};
}

}  // namespace worker_manager
