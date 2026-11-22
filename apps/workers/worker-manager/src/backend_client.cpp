#include "backend_client.hpp"

#include <algorithm>
#include <condition_variable>
#include <format>
#include <mutex>
#include <utility>

#include "http_client.hpp"

namespace worker_manager {

namespace {

constexpr std::string_view kLeasePath = "/workers/manager/lease";
constexpr std::string_view kResultsPath = "/workers/manager/results";
// On top of the wait: the backend still has to build and send the job list.
constexpr auto kResponseSlack = std::chrono::seconds{15};
constexpr std::size_t kMaxLeaseBytes = 16 * 1024 * 1024;
// Ingest writes up to 1024 hosts in one transaction; the backend allows itself 60 s.
constexpr auto kUploadTimeout = std::chrono::seconds{120};
constexpr std::size_t kMaxUploadReplyBytes = 1024 * 1024;
constexpr std::size_t kMaxErrorMessage = 300;
constexpr auto kMaxNextPoll = std::chrono::milliseconds{5 * 60 * 1000};
constexpr auto kMaxRetryDelay = std::chrono::milliseconds{60 * 1000};

// "HTTP 400: <error.message>" from the backend's error envelope, or just the status.
std::string describe_status(long status, std::string_view body) {
    const Json reply = Json::parse(body, nullptr, false);
    if (reply.is_object()) {
        if (const auto error = reply.find("error"); error != reply.end() && error->is_object()) {
            if (const auto message = error->find("message");
                message != error->end() && message->is_string()) {
                std::string text = message->get<std::string>();
                if (text.size() > kMaxErrorMessage) text = text.substr(0, kMaxErrorMessage) + "…";
                return std::format("HTTP {}: {}", status, text);
            }
        }
    }
    return std::format("HTTP {}", status);
}

}  // namespace

Json lease_request_body(const LeaseRequest& request) {
    Json body = Json::object();
    body["manager_id"] = request.manager_id;
    body["version"] = WORKER_MANAGER_VERSION;
    body["workers"] = request.workers;
    body["max_parallel"] = request.max_parallel;
    body["wait_seconds"] = request.wait.count();
    return body;
}

std::chrono::milliseconds next_poll_delay(const Json& job_list) {
    const auto it = job_list.find("next_poll_ms");
    if (it == job_list.end() || !it->is_number_unsigned()) return std::chrono::milliseconds{0};
    const auto value = it->get<std::uint64_t>();
    return value >= static_cast<std::uint64_t>(kMaxNextPoll.count())
               ? kMaxNextPoll
               : std::chrono::milliseconds{static_cast<std::int64_t>(value)};
}

std::chrono::milliseconds retry_delay(std::chrono::seconds base, std::uint32_t failures) {
    const std::chrono::milliseconds cap = std::max<std::chrono::milliseconds>(base, kMaxRetryDelay);
    std::chrono::milliseconds delay = base;
    for (std::uint32_t i = 1; i < failures && delay < cap; ++i) delay *= 2;
    return std::min(delay, cap);
}

Json upload_body(std::uint32_t task_index, std::uint32_t task_count, Json result) {
    Json body = Json::object();
    body["task_index"] = task_index;
    body["task_count"] = task_count;
    body["result"] = std::move(result);
    return body;
}

bool is_retryable_status(long status) noexcept {
    return status == 408 || status == 429 || status >= 500;
}

bool sleep_unless_stopped(std::chrono::milliseconds duration, const std::stop_token& stop) {
    if (duration.count() > 0) {
        std::mutex mutex;
        std::condition_variable_any woken;
        std::unique_lock lock{mutex};
        (void)woken.wait_for(lock, stop, duration, [] { return false; });
    }
    return !stop.stop_requested();
}

BackendClient::BackendClient(std::string backend_url, std::string token)
    : token_{std::move(token)} {
    while (!backend_url.empty() && backend_url.back() == '/') backend_url.pop_back();
    lease_url_ = backend_url + std::string{kLeasePath};
    results_url_ = std::move(backend_url) + std::string{kResultsPath};
}

std::expected<LeaseResponse, std::string> BackendClient::lease(const LeaseRequest& request,
                                                               const std::stop_token& stop) const {
    const std::string body = lease_request_body(request).dump();
    const auto response = post_json({.url = lease_url_,
                                     .body = body,
                                     .bearer_token = token_,
                                     .timeout = request.wait + kResponseSlack,
                                     .max_response_bytes = kMaxLeaseBytes},
                                    stop);
    if (!response) return std::unexpected(response.error());
    switch (response->status) {
        case 204:
            return LeaseResponse{};
        case 200:
            break;
        case 401:
        case 403:
            return std::unexpected(
                std::format("the backend rejected the token (HTTP {})", response->status));
        default:
            return std::unexpected(
                std::format("unexpected HTTP status {} from {}", response->status, lease_url_));
    }
    Json document = Json::parse(response->body, nullptr, false);
    if (document.is_discarded() || !document.is_object()) {
        return std::unexpected(std::string{"the lease response is not a JSON object"});
    }
    LeaseResponse lease{.job_list = std::nullopt, .next_poll = next_poll_delay(document)};
    if (const auto jobs = document.find("jobs");
        jobs == document.end() || !jobs->is_array() || !jobs->empty()) {
        lease.job_list = std::move(document);  // a missing jobs[] is reported by parse_job_list
    }
    return lease;
}

std::expected<UploadReceipt, UploadError> BackendClient::upload_result(
    std::string_view body, const std::stop_token& stop) const {
    const auto response = post_json({.url = results_url_,
                                     .body = body,
                                     .bearer_token = token_,
                                     .timeout = kUploadTimeout,
                                     .max_response_bytes = kMaxUploadReplyBytes},
                                    stop);
    if (!response) {
        return std::unexpected(
            UploadError{.message = response.error(), .status = std::nullopt, .is_retryable = true});
    }
    if (response->status < 200 || response->status >= 300) {
        return std::unexpected(
            UploadError{.message = describe_status(response->status, response->body),
                        .status = response->status,
                        .is_retryable = is_retryable_status(response->status)});
    }
    Json reply = Json::parse(response->body, nullptr, false);
    return UploadReceipt{.status = response->status,
                         .body = reply.is_discarded() ? Json(nullptr) : std::move(reply)};
}

}  // namespace worker_manager
