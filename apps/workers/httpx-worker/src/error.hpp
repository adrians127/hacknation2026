#pragma once

#include <string>

namespace httpx_worker {

struct Error {
    std::string code{};
    std::string message{};
};

}  // namespace httpx_worker
