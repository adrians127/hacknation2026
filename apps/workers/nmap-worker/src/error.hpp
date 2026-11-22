#pragma once

#include <string>

namespace nmap_worker {

struct Error {
    std::string code{};
    std::string message{};
};

}  // namespace nmap_worker
