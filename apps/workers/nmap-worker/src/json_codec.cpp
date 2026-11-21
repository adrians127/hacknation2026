#include "json_codec.hpp"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <arpa/inet.h>
#include <charconv>
#include <chrono>
#include <cstdint>
#include <expected>
#include <limits>
#include <set>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace nmap_worker {
namespace {

using Json = nlohmann::json;

std::expected<int, Error> decimal(std::string_view input) {
    int value = 0;
    const auto [end, error] = std::from_chars(input.data(), input.data() + input.size(), value);
    if (error != std::errc{} || end != input.data() + input.size()) {
        return std::unexpected(Error{"invalid_deadline", "Deadline must be UTC ISO 8601"});
    }
    return value;
}

std::expected<std::chrono::system_clock::time_point, Error> parse_deadline(std::string_view input) {
    if (input.size() != 20 || input[4] != '-' || input[7] != '-' || input[10] != 'T' ||
        input[13] != ':' || input[16] != ':' || input[19] != 'Z') {
        return std::unexpected(Error{"invalid_deadline", "Deadline must be YYYY-MM-DDTHH:MM:SSZ"});
    }
    const auto year = decimal(input.substr(0, 4));
    const auto month = decimal(input.substr(5, 2));
    const auto day = decimal(input.substr(8, 2));
    const auto hour = decimal(input.substr(11, 2));
    const auto minute = decimal(input.substr(14, 2));
    const auto second = decimal(input.substr(17, 2));
    if (!year || !month || !day || !hour || !minute || !second || *year < 1 || *month < 1 ||
        *month > 12 || *day < 1 || *day > 31 || *hour < 0 || *hour > 23 || *minute < 0 ||
        *minute > 59 || *second < 0 || *second > 59) {
        return std::unexpected(
            Error{"invalid_deadline", "Deadline contains an invalid date or time"});
    }
    const std::chrono::year_month_day date{std::chrono::year{*year},
                                           std::chrono::month{static_cast<unsigned>(*month)},
                                           std::chrono::day{static_cast<unsigned>(*day)}};
    if (!date.ok()) {
        return std::unexpected(Error{"invalid_deadline", "Deadline contains an invalid date"});
    }
    return std::chrono::sys_days{date} + std::chrono::hours{*hour} + std::chrono::minutes{*minute} +
           std::chrono::seconds{*second};
}

std::expected<std::pair<std::uint32_t, unsigned>, Error> parse_subnet(std::string_view subnet) {
    const auto slash = subnet.find('/');
    if (slash == std::string_view::npos || slash == 0 || slash + 1 == subnet.size()) {
        return std::unexpected(Error{"invalid_subnet", "Expected an IPv4 CIDR"});
    }
    const std::string address{subnet.substr(0, slash)};
    in_addr parsed{};
    if (inet_pton(AF_INET, address.c_str(), &parsed) != 1) {
        return std::unexpected(Error{"invalid_subnet", "Expected an IPv4 CIDR"});
    }
    int prefix = 0;
    const auto digits = subnet.substr(slash + 1);
    const auto [end, error] = std::from_chars(digits.data(), digits.data() + digits.size(), prefix);
    if (error != std::errc{} || end != digits.data() + digits.size() || prefix < 0 || prefix > 32) {
        return std::unexpected(Error{"invalid_subnet", "IPv4 prefix must be between 0 and 32"});
    }
    return std::pair{ntohl(parsed.s_addr), static_cast<unsigned>(prefix)};
}

bool is_in_subnet(std::string_view ip, std::uint32_t network, unsigned prefix) {
    const std::string address{ip};
    in_addr parsed{};
    if (inet_pton(AF_INET, address.c_str(), &parsed) != 1) {
        return false;
    }
    const std::uint32_t mask =
        prefix == 0 ? 0 : (std::numeric_limits<std::uint32_t>::max() << (32U - prefix));
    return (ntohl(parsed.s_addr) & mask) == (network & mask);
}

std::expected<std::string, Error> required_string(const Json& object, const char* key) {
    if (!object.contains(key) || !object.at(key).is_string()) {
        return std::unexpected(Error{"invalid_job", std::string{"Missing string: "} + key});
    }
    const std::string value = object.at(key).get<std::string>();
    if (value.empty() || value.size() > 256) {
        return std::unexpected(Error{"invalid_job", std::string{"Invalid string: "} + key});
    }
    return value;
}

Json error_json(const Error& error) {
    return Json{{"code", error.code}, {"message", error.message}};
}

}  // namespace

std::expected<ScanJob, Error> parse_scan_job(std::string_view input,
                                             const ScanLimits& maximum_limits) {
    try {
        const Json json = Json::parse(input);
        if (!json.is_object()) {
            return std::unexpected(Error{"invalid_job", "Job must be a JSON object"});
        }
        const auto job_id = required_string(json, "job_id");
        const auto lease_id = required_string(json, "lease_id");
        const auto subnet = required_string(json, "subnet");
        const auto deadline_text = required_string(json, "deadline");
        if (!job_id) return std::unexpected(job_id.error());
        if (!lease_id) return std::unexpected(lease_id.error());
        if (!subnet) return std::unexpected(subnet.error());
        if (!deadline_text) return std::unexpected(deadline_text.error());
        const auto deadline = parse_deadline(*deadline_text);
        const auto network = parse_subnet(*subnet);
        if (!deadline) return std::unexpected(deadline.error());
        if (!network) return std::unexpected(network.error());
        if (!json.contains("targets") || !json.at("targets").is_array() ||
            json.at("targets").empty() || json.at("targets").size() > 1024) {
            return std::unexpected(Error{"invalid_job", "targets must contain 1 to 1024 hosts"});
        }

        ScanLimits limits = maximum_limits;
        if (json.contains("limits")) {
            const auto& requested = json.at("limits");
            if (!requested.is_object()) {
                return std::unexpected(Error{"invalid_job", "limits must be an object"});
            }
            if (requested.contains("max_parallel")) {
                const auto value = requested.at("max_parallel").get<std::size_t>();
                if (value == 0)
                    return std::unexpected(Error{"invalid_job", "max_parallel must be positive"});
                limits.max_parallel = std::min(value, maximum_limits.max_parallel);
            }
            if (requested.contains("max_rate_per_process")) {
                const auto value = requested.at("max_rate_per_process").get<std::uint32_t>();
                if (value == 0)
                    return std::unexpected(
                        Error{"invalid_job", "max_rate_per_process must be positive"});
                limits.max_rate_per_process = std::min(value, maximum_limits.max_rate_per_process);
            }
            if (requested.contains("host_timeout_ms")) {
                const auto value = requested.at("host_timeout_ms").get<std::int64_t>();
                if (value <= 0)
                    return std::unexpected(
                        Error{"invalid_job", "host_timeout_ms must be positive"});
                limits.host_timeout =
                    std::min(std::chrono::milliseconds{value}, maximum_limits.host_timeout);
            }
        }

        std::vector<Target> targets;
        targets.reserve(json.at("targets").size());
        std::set<std::string> seen_ips;
        for (const auto& target_json : json.at("targets")) {
            if (!target_json.is_object()) {
                return std::unexpected(Error{"invalid_job", "Each target must be an object"});
            }
            const auto ip = required_string(target_json, "ip");
            if (!ip) return std::unexpected(ip.error());
            if (!is_in_subnet(*ip, network->first, network->second)) {
                return std::unexpected(Error{"invalid_target", "Target IP is outside job subnet"});
            }
            if (!seen_ips.insert(*ip).second) {
                return std::unexpected(Error{"invalid_target", "Duplicate target IP"});
            }
            Target target{.ip = *ip};
            if (target_json.contains("domain") && !target_json.at("domain").is_null()) {
                if (!target_json.at("domain").is_string()) {
                    return std::unexpected(Error{"invalid_target", "domain must be a string"});
                }
                target.domain = target_json.at("domain").get<std::string>();
                if (target.domain->size() > 253) {
                    return std::unexpected(Error{"invalid_target", "domain is too long"});
                }
            }
            if (!target_json.contains("tcp_ports") || !target_json.at("tcp_ports").is_array() ||
                target_json.at("tcp_ports").empty() || target_json.at("tcp_ports").size() > 4096) {
                return std::unexpected(
                    Error{"invalid_target", "tcp_ports must contain 1 to 4096 ports"});
            }
            for (const auto& port_json : target_json.at("tcp_ports")) {
                if (!port_json.is_number_integer()) {
                    return std::unexpected(Error{"invalid_target", "tcp_ports must be integers"});
                }
                const auto port = port_json.get<int>();
                if (port < 1 || port > 65535) {
                    return std::unexpected(Error{"invalid_target", "TCP port is outside 1-65535"});
                }
                target.tcp_ports.push_back(static_cast<std::uint16_t>(port));
            }
            std::ranges::sort(target.tcp_ports);
            target.tcp_ports.erase(std::ranges::unique(target.tcp_ports).begin(),
                                   target.tcp_ports.end());
            targets.push_back(std::move(target));
        }
        return ScanJob{.job_id = *job_id,
                       .lease_id = *lease_id,
                       .subnet = *subnet,
                       .deadline = *deadline,
                       .limits = limits,
                       .targets = std::move(targets)};
    } catch (const Json::exception& error) {
        return std::unexpected(Error{"invalid_json", error.what()});
    }
}

std::string serialize_job_result(const JobResult& result) {
    Json json{{"job_id", result.job_id},
              {"lease_id", result.lease_id},
              {"status", result.status},
              {"duration_ms", result.duration.count()},
              {"hosts", Json::array()}};
    for (const auto& host : result.hosts) {
        Json host_json{{"ip", host.ip},
                       {"domain", host.domain ? Json{*host.domain} : Json{nullptr}},
                       {"status", host.status},
                       {"ports", Json::array()}};
        if (host.error) host_json["error"] = error_json(*host.error);
        for (const auto& port : host.ports) {
            Json port_json{{"number", port.number},
                           {"protocol", port.protocol},
                           {"state", port.state},
                           {"scripts", Json::array()}};
            if (port.service) {
                port_json["service"] = Json{{"name", port.service->name},
                                            {"product", port.service->product},
                                            {"version", port.service->version},
                                            {"cpe", port.service->cpe}};
            } else {
                port_json["service"] = nullptr;
            }
            for (const auto& script : port.scripts) {
                port_json["scripts"].push_back(Json{{"id", script.id}, {"output", script.output}});
            }
            host_json["ports"].push_back(std::move(port_json));
        }
        json["hosts"].push_back(std::move(host_json));
    }
    return json.dump();
}

std::string serialize_error(const Error& error) { return error_json(error).dump(); }

}  // namespace nmap_worker
