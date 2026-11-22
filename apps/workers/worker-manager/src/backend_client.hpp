#pragma once

#include <chrono>
#include <cstdint>
#include <expected>
#include <optional>
#include <stop_token>
#include <string>
#include <string_view>
#include <vector>

#include "files.hpp"

namespace worker_manager {

struct LeaseRequest {
    std::string manager_id;
    std::vector<std::string> workers;  // only workers whose binary is installed
    std::uint32_t max_parallel;
    std::chrono::seconds wait;  // how long the backend may hold the request
};

struct LeaseResponse {
    std::optional<Json> job_list;  // nullopt: no work within the wait (204, or an empty jobs[])
    std::chrono::milliseconds next_poll{0};
};

struct UploadReceipt {
    long status = 0;
    Json body;  // the backend's reply ({status, resultId}), null when it is not JSON
};

struct UploadError {
    std::string message;
    std::optional<long> status;  // none: transport error or stop
    bool is_retryable = false;
};

// The POST body of the lease request (README.md, "Poll mode").
[[nodiscard]] Json lease_request_body(const LeaseRequest& request);

// The job list's `next_poll_ms`, at most 5 minutes; 0 when absent or not a non-negative integer.
[[nodiscard]] std::chrono::milliseconds next_poll_delay(const Json& job_list);

// Delay after the n-th failed request in a row: `base`, doubled per failure, capped at
// max(base, 60 s).
[[nodiscard]] std::chrono::milliseconds retry_delay(std::chrono::seconds base,
                                                    std::uint32_t failures);

// The POST body of a result upload (README.md, "Result upload"): one worker run's result.
[[nodiscard]] Json upload_body(std::uint32_t task_index, std::uint32_t task_count, Json result);

// 408, 429 and 5xx may succeed on a resend; any other status will not change.
[[nodiscard]] bool is_retryable_status(long status) noexcept;

// False when `stop` was requested before or during the wait.
bool sleep_unless_stopped(std::chrono::milliseconds duration, const std::stop_token& stop);

// The backend's worker-manager endpoints. Safe to share between threads: every request has its
// own curl handle. Create it after CurlGlobal.
class BackendClient {
public:
    BackendClient(std::string backend_url, std::string token);

    [[nodiscard]] const std::string& lease_url() const noexcept { return lease_url_; }

    // POST /workers/manager/lease. Fails on a transport error, a stop, an unexpected status or a
    // body that is not a JSON object; the job list itself is validated by parse_job_list().
    [[nodiscard]] std::expected<LeaseResponse, std::string> lease(
        const LeaseRequest& request, const std::stop_token& stop) const;

    // POST /workers/manager/results with an upload_body(). Succeeds on any 2xx.
    [[nodiscard]] std::expected<UploadReceipt, UploadError> upload_result(
        std::string_view body, const std::stop_token& stop) const;

private:
    std::string lease_url_;
    std::string results_url_;
    std::string token_;
};

}  // namespace worker_manager
