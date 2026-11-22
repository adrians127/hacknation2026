#include "result_uploader.hpp"

#include <format>
#include <utility>

#include "files.hpp"

namespace worker_manager {

std::string_view to_string(UploadStatus status) noexcept {
    switch (status) {
        case UploadStatus::kUploaded:
            return "uploaded";
        case UploadStatus::kRejected:
            return "rejected";
        case UploadStatus::kFailed:
            return "failed";
    }
    return "failed";
}

ResultUploader::ResultUploader(const BackendClient& client, UploadPolicy policy,
                               std::stop_token stop, std::stop_token force, const Logger& logger)
    : client_{client},
      policy_{policy},
      stop_{std::move(stop)},
      force_{std::move(force)},
      logger_{logger},
      thread_{[this](const std::stop_token& thread_stop) { run(thread_stop); }} {}

void ResultUploader::submit(UploadRequest request, UploadOutcome& outcome) {
    {
        const std::scoped_lock lock{mutex_};
        queue_.push_back({.request = std::move(request), .outcome = &outcome});
    }
    changed_.notify_all();
}

void ResultUploader::wait_idle() {
    std::unique_lock lock{mutex_};
    changed_.wait(lock, [this] { return queue_.empty() && !is_busy_; });
}

void ResultUploader::run(const std::stop_token& thread_stop) noexcept {
    while (true) {
        Item item;
        {
            std::unique_lock lock{mutex_};
            if (!changed_.wait(lock, thread_stop, [this] { return !queue_.empty(); })) return;
            item = std::move(queue_.front());
            queue_.pop_front();
            is_busy_ = true;
        }
        UploadOutcome outcome;
        try {
            outcome = upload(item.request);
        } catch (const std::exception& error) {
            outcome.error = std::format("unexpected error: {}", error.what());
            logger_.error("upload.failed", *outcome.error, {{"task_id", item.request.task_id}});
        } catch (...) {
            outcome.error = "unexpected error";
            logger_.error("upload.failed", *outcome.error, {{"task_id", item.request.task_id}});
        }
        {
            const std::scoped_lock lock{mutex_};
            *item.outcome = std::move(outcome);
            is_busy_ = false;
        }
        changed_.notify_all();
    }
}

UploadOutcome ResultUploader::upload(const UploadRequest& request) const {
    UploadOutcome outcome;
    const auto text = read_text_file(request.result_path);
    Json result = text ? Json::parse(*text, nullptr, false) : Json(nullptr);
    if (!result.is_object()) {
        outcome.error = std::format("cannot read '{}'", request.result_path.string());
        logger_.error("upload.failed", *outcome.error, {{"task_id", request.task_id}});
        return outcome;
    }
    const std::string body = upload_body(request.task_index, request.task_count, std::move(result))
                                 .dump(-1, ' ', false, Json::error_handler_t::replace);

    for (std::uint32_t attempt = 1;; ++attempt) {
        outcome.attempts = attempt;
        const auto reply = client_.upload_result(body, force_);
        if (reply) {
            outcome.status = UploadStatus::kUploaded;
            outcome.http_status = reply->status;
            outcome.error.reset();
            if (reply->body.is_object()) {
                if (const auto id = reply->body.find("resultId");
                    id != reply->body.end() && id->is_string()) {
                    outcome.result_id = id->get<std::string>();
                }
                outcome.is_duplicate = reply->body.value("status", std::string{}) == "duplicate";
            }
            logger_.info(
                "upload.done", "result uploaded",
                {{"task_id", request.task_id},
                 {"result_id", outcome.result_id ? Json(*outcome.result_id) : Json(nullptr)},
                 {"duplicate", outcome.is_duplicate},
                 {"attempts", attempt}});
            return outcome;
        }
        outcome.http_status = reply.error().status;
        outcome.error = reply.error().message;
        if (!reply.error().is_retryable) {
            outcome.status = UploadStatus::kRejected;
            logger_.error("upload.rejected", "the backend refused the result",
                          {{"task_id", request.task_id}, {"error", *outcome.error}});
            return outcome;
        }
        if (attempt >= policy_.attempts || stop_.stop_requested()) {
            outcome.status = UploadStatus::kFailed;
            logger_.error(
                "upload.failed", "giving up; the result stays on disk",
                {{"task_id", request.task_id}, {"error", *outcome.error}, {"attempts", attempt}});
            return outcome;
        }
        const auto delay = retry_delay(policy_.retry_delay, attempt);
        logger_.warn(
            "upload.retry", *outcome.error,
            {{"task_id", request.task_id}, {"attempt", attempt}, {"retry_in_ms", delay.count()}});
        (void)sleep_unless_stopped(delay, stop_);
    }
}

}  // namespace worker_manager
