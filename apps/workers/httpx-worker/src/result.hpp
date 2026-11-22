#pragma once

#include "job.hpp"

#include <chrono>
#include <nlohmann/json.hpp>
#include <optional>
#include <string>
#include <vector>

namespace httpx_worker {

using OrderedJson = nlohmann::ordered_json;

struct GroupResult {
    std::size_t target_index;
    std::string domain;
    std::string jsonl;
    bool stopped = false;
};

[[nodiscard]] OrderedJson make_result(const Job& job, const std::vector<GroupResult>& groups,
                                      std::size_t processed_targets,
                                      const std::string& status,
                                      const std::string& stop_reason,
                                      const std::optional<Error>& error,
                                      std::chrono::system_clock::time_point started,
                                      std::chrono::milliseconds duration);

[[nodiscard]] OrderedJson make_failed_result(std::string_view input, const Error& error);

} // namespace httpx_worker
