#pragma once

#include "scan_job.hpp"

#include <expected>
#include <string>
#include <string_view>

namespace nmap_worker {

struct HttpResponse {
    long status = 0;
    std::string body;
};

class HttpClient {
public:
    HttpClient(std::string base_url, std::string token);

    [[nodiscard]] std::expected<HttpResponse, Error> post(std::string_view path,
                                                          std::string_view body) const;

private:
    std::string base_url_;
    std::string token_;
};

}  // namespace nmap_worker
