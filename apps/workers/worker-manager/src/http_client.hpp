#pragma once

#include <chrono>
#include <cstddef>
#include <expected>
#include <stop_token>
#include <string>
#include <string_view>

namespace worker_manager {

// curl_global_init/cleanup for the process: create one before any HTTP request, on the main
// thread, before other threads start. Throws std::runtime_error when libcurl cannot start.
class CurlGlobal {
public:
    CurlGlobal();
    CurlGlobal(const CurlGlobal&) = delete;
    CurlGlobal& operator=(const CurlGlobal&) = delete;
    ~CurlGlobal() noexcept;
};

struct HttpRequest {
    std::string url;
    std::string_view body;  // JSON
    std::string_view bearer_token;
    std::chrono::milliseconds timeout;
    std::size_t max_response_bytes;
};

struct HttpResponse {
    long status = 0;
    std::string body;
};

// A JSON POST. Gives up within about a second once `stop` is requested. Never throws.
[[nodiscard]] std::expected<HttpResponse, std::string> post_json(const HttpRequest& request,
                                                                 const std::stop_token& stop);

}  // namespace worker_manager
