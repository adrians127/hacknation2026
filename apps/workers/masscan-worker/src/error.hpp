#pragma once

#include <string>
#include <string_view>

namespace masscan_worker {

enum class ErrorCode { kInvalidInput, kScannerUnavailable, kScannerFailed, kIo };

[[nodiscard]] constexpr std::string_view to_string(ErrorCode code) noexcept {
    switch (code) {
        case ErrorCode::kInvalidInput:
            return "invalid_input";
        case ErrorCode::kScannerUnavailable:
            return "scanner_unavailable";
        case ErrorCode::kScannerFailed:
            return "scanner_failed";
        case ErrorCode::kIo:
            return "io_error";
    }
    return "unknown";
}

struct Error {
    ErrorCode code;
    std::string message;
};

}  // namespace masscan_worker
