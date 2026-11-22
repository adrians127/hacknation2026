#pragma once

#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <filesystem>
#include <mutex>
#include <optional>
#include <stop_token>
#include <string>
#include <string_view>
#include <thread>

#include "backend_client.hpp"
#include "logger.hpp"

namespace worker_manager {

// kRejected: the backend refused it (4xx), a resend would not help. kFailed: gave up retrying.
enum class UploadStatus { kUploaded, kRejected, kFailed };

[[nodiscard]] std::string_view to_string(UploadStatus status) noexcept;

struct UploadOutcome {
    UploadStatus status = UploadStatus::kFailed;
    std::uint32_t attempts = 0;
    std::optional<long> http_status;
    std::optional<std::string> error;
    std::optional<std::string> result_id;  // the backend's id for the stored result
    bool is_duplicate = false;             // the backend already had this lease and task
};

struct UploadRequest {
    std::string task_id;
    std::uint32_t task_index = 1;
    std::uint32_t task_count = 1;
    std::filesystem::path result_path;
};

struct UploadPolicy {
    std::uint32_t attempts;
    std::chrono::seconds retry_delay;  // first delay, doubled per failed attempt (up to 60 s)
};

// Uploads task results one at a time on its own thread, so the worker pool never waits for the
// backend. Transport errors, 408, 429 and 5xx are retried; after the first stop request each
// upload gets one attempt, and the second one aborts requests in flight.
class ResultUploader {
public:
    ResultUploader(const BackendClient& client, UploadPolicy policy, std::stop_token stop,
                   std::stop_token force, const Logger& logger);
    ResultUploader(const ResultUploader&) = delete;
    ResultUploader& operator=(const ResultUploader&) = delete;
    ~ResultUploader() noexcept = default;

    // The uploader thread writes `outcome`; read it only after wait_idle() returns.
    void submit(UploadRequest request, UploadOutcome& outcome);
    // Blocks until everything submitted so far is uploaded or given up.
    void wait_idle();

private:
    struct Item {
        UploadRequest request;
        UploadOutcome* outcome = nullptr;
    };

    void run(const std::stop_token& thread_stop) noexcept;
    [[nodiscard]] UploadOutcome upload(const UploadRequest& request) const;

    const BackendClient& client_;
    UploadPolicy policy_;
    std::stop_token stop_;
    std::stop_token force_;
    const Logger& logger_;

    std::mutex mutex_;
    std::condition_variable_any changed_;
    std::deque<Item> queue_;
    bool is_busy_ = false;
    std::jthread thread_;  // last: stopped and joined before the members it uses go away
};

}  // namespace worker_manager
