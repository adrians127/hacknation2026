#pragma once

#include "scan_job.hpp"

#include <expected>
#include <string_view>

namespace nmap_worker {

[[nodiscard]] std::expected<HostResult, Error> parse_nmap_xml(std::string_view xml,
                                                              const Target& target);

}  // namespace nmap_worker
