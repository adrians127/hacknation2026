#include "http_client.hpp"

#include <curl/curl.h>

#include <cstddef>
#include <expected>
#include <limits>
#include <memory>
#include <string>
#include <string_view>
#include <utility>

namespace nmap_worker {
namespace {

struct ResponseBuffer {
    std::string body;
    bool is_too_large = false;
};

std::size_t append_response(char* data, std::size_t size, std::size_t count, void* context) {
    auto& response = *static_cast<ResponseBuffer*>(context);
    if (size != 0 && count > std::numeric_limits<std::size_t>::max() / size) {
        response.is_too_large = true;
        return 0;
    }
    const std::size_t bytes = size * count;
    if (bytes > 4 * 1024 * 1024 || response.body.size() > 4 * 1024 * 1024 - bytes) {
        response.is_too_large = true;
        return 0;
    }
    response.body.append(data, bytes);
    return bytes;
}

struct CurlCloser {
    void operator()(CURL* handle) const noexcept { curl_easy_cleanup(handle); }
};

struct HeaderCloser {
    void operator()(curl_slist* headers) const noexcept { curl_slist_free_all(headers); }
};

}  // namespace

HttpClient::HttpClient(std::string base_url, std::string token)
    : base_url_(std::move(base_url)), token_(std::move(token)) {
    while (!base_url_.empty() && base_url_.back() == '/') base_url_.pop_back();
}

std::expected<HttpResponse, Error> HttpClient::post(std::string_view path,
                                                    std::string_view body) const {
    std::unique_ptr<CURL, CurlCloser> handle{curl_easy_init()};
    if (!handle) return std::unexpected(Error{"http_init_failed", "Cannot create curl handle"});
    const std::string url = base_url_ + std::string{path};
    const std::string request{body};
    const std::string authorization = "Authorization: Bearer " + token_;
    curl_slist* raw_headers = curl_slist_append(nullptr, "Content-Type: application/json");
    if (raw_headers == nullptr) {
        return std::unexpected(Error{"http_init_failed", "Cannot allocate request headers"});
    }
    std::unique_ptr<curl_slist, HeaderCloser> headers{raw_headers};
    raw_headers = curl_slist_append(headers.get(), authorization.c_str());
    if (raw_headers == nullptr) {
        return std::unexpected(Error{"http_init_failed", "Cannot allocate authorization header"});
    }
    headers.release();
    headers.reset(raw_headers);
    ResponseBuffer response;
    curl_easy_setopt(handle.get(), CURLOPT_URL, url.c_str());
    curl_easy_setopt(handle.get(), CURLOPT_HTTPHEADER, headers.get());
    curl_easy_setopt(handle.get(), CURLOPT_POST, 1L);
    curl_easy_setopt(handle.get(), CURLOPT_POSTFIELDS, request.data());
    curl_easy_setopt(handle.get(), CURLOPT_POSTFIELDSIZE, static_cast<long>(request.size()));
    curl_easy_setopt(handle.get(), CURLOPT_WRITEFUNCTION, append_response);
    curl_easy_setopt(handle.get(), CURLOPT_WRITEDATA, &response);
    curl_easy_setopt(handle.get(), CURLOPT_TIMEOUT_MS, 10000L);
    curl_easy_setopt(handle.get(), CURLOPT_FOLLOWLOCATION, 0L);
    const CURLcode code = curl_easy_perform(handle.get());
    if (response.is_too_large) {
        return std::unexpected(Error{"http_response_too_large", "HTTP response exceeded 4 MiB"});
    }
    if (code != CURLE_OK) {
        return std::unexpected(Error{"http_failed", curl_easy_strerror(code)});
    }
    long status = 0;
    curl_easy_getinfo(handle.get(), CURLINFO_RESPONSE_CODE, &status);
    return HttpResponse{.status = status, .body = std::move(response.body)};
}

}  // namespace nmap_worker
