#pragma once

#include "job.hpp"

#include <expected>
#include <stop_token>
#include <string>
#include <vector>

namespace httpx_worker {

struct ProcessResult {
    std::string jsonl;
    std::string stderr_text;
    int exit_code = 0;
    bool stopped = false;
};

[[nodiscard]] std::expected<ProcessResult, Error> run_httpx(
    const Job& job, const Target& target, const std::string& domain,
    const std::string& binary, std::stop_token stop);

} // namespace httpx_worker
