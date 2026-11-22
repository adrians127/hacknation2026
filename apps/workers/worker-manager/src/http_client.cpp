#include "http_client.hpp"

#include <curl/curl.h>

#include <format>
#include <memory>
#include <stdexcept>

namespace worker_manager {

namespace {

constexpr auto kConnectTimeout = std::chrono::seconds{10};

struct CurlCloser {
    void operator()(CURL* handle) const noexcept { curl_easy_cleanup(handle); }
};

struct HeaderCloser {
    void operator()(curl_slist* headers) const noexcept { curl_slist_free_all(headers); }
};

struct ResponseBuffer {
    std::string body;
    std::size_t max_bytes = 0;
    bool is_too_large = false;
};

// libcurl callbacks: nothing may throw through the C library.
std::size_t append_response(char* data, std::size_t size, std::size_t count,
                            void* context) noexcept {
    auto& response = *static_cast<ResponseBuffer*>(context);
    const std::size_t bytes = size * count;  // curl guarantees size == 1
    if (bytes > response.max_bytes - response.body.size()) {
        response.is_too_large = true;
        return 0;
    }
    try {
        response.body.append(data, bytes);
    } catch (...) {
        return 0;
    }
    return bytes;
}

// Called about once a second even while the server holds the request, so a stop is noticed.
int abort_on_stop(void* context, curl_off_t, curl_off_t, curl_off_t, curl_off_t) noexcept {
    return static_cast<const std::stop_token*>(context)->stop_requested() ? 1 : 0;
}

// Appends one header; a failed allocation leaves the list as it was and returns false.
bool add_header(std::unique_ptr<curl_slist, HeaderCloser>& headers, const std::string& header) {
    curl_slist* const extended = curl_slist_append(headers.get(), header.c_str());
    if (extended == nullptr) return false;
    (void)headers.release();  // now owned by `extended`
    headers.reset(extended);
    return true;
}

std::expected<HttpResponse, std::string> post_json_impl(const HttpRequest& request,
                                                        const std::stop_token& stop) {
    const std::unique_ptr<CURL, CurlCloser> handle{curl_easy_init()};
    if (!handle) return std::unexpected(std::string{"cannot create a curl handle"});

    std::unique_ptr<curl_slist, HeaderCloser> headers;
    if (!add_header(headers, "Content-Type: application/json") ||
        !add_header(headers, "Accept: application/json") ||
        (!request.bearer_token.empty() &&
         !add_header(headers, std::format("Authorization: Bearer {}", request.bearer_token)))) {
        return std::unexpected(std::string{"cannot allocate request headers"});
    }

    ResponseBuffer response{.body = {}, .max_bytes = request.max_response_bytes};
    CURL* const curl = handle.get();
    curl_easy_setopt(curl, CURLOPT_URL, request.url.c_str());
    curl_easy_setopt(curl, CURLOPT_PROTOCOLS_STR, "http,https");
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers.get());
    curl_easy_setopt(curl, CURLOPT_POST, 1L);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, request.body.data());
    curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE_LARGE,
                     static_cast<curl_off_t>(request.body.size()));
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, append_response);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);
    curl_easy_setopt(curl, CURLOPT_NOPROGRESS, 0L);
    curl_easy_setopt(curl, CURLOPT_XFERINFOFUNCTION, abort_on_stop);
    curl_easy_setopt(curl, CURLOPT_XFERINFODATA, &stop);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT_MS, static_cast<long>(request.timeout.count()));
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT_MS,
                     static_cast<long>(std::chrono::milliseconds{kConnectTimeout}.count()));
    // Without it libcurl times out DNS lookups with SIGALRM, which is not thread-safe.
    curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 0L);

    const CURLcode code = curl_easy_perform(curl);
    if (response.is_too_large) {
        return std::unexpected(
            std::format("the response exceeded {} bytes", request.max_response_bytes));
    }
    if (code == CURLE_ABORTED_BY_CALLBACK) {
        return std::unexpected(std::string{"stopped"});
    }
    if (code != CURLE_OK) {
        return std::unexpected(std::format("{}: {}", request.url, curl_easy_strerror(code)));
    }
    long status = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &status);
    return HttpResponse{.status = status, .body = std::move(response.body)};
}

}  // namespace

CurlGlobal::CurlGlobal() {
    if (curl_global_init(CURL_GLOBAL_DEFAULT) != CURLE_OK) {
        throw std::runtime_error("cannot initialize libcurl");
    }
}

CurlGlobal::~CurlGlobal() noexcept { curl_global_cleanup(); }

std::expected<HttpResponse, std::string> post_json(const HttpRequest& request,
                                                   const std::stop_token& stop) {
    try {
        return post_json_impl(request, stop);
    } catch (const std::exception& error) {
        return std::unexpected(std::format("HTTP request failed: {}", error.what()));
    }
}

}  // namespace worker_manager
