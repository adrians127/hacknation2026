#pragma once

#include <string>
#include <string_view>

namespace masscan_worker {

enum class ErrorCode { kInvalidInput, kScannerUnavailable, kScannerFailed, kIo };

// Kebab-case, as docs/worker-result-format.md requires for error codes.
[[nodiscard]] constexpr std::string_view to_string(ErrorCode code) noexcept {
    switch (code) {
        case ErrorCode::kInvalidInput:
            return "invalid-input";
        case ErrorCode::kScannerUnavailable:
            return "scanner-unavailable";
        case ErrorCode::kScannerFailed:
            return "scanner-failed";
        case ErrorCode::kIo:
            return "io-error";
    }
    return "unknown";
}

struct Error {
    ErrorCode code;
    std::string message;
};

}  // namespace masscan_worker
