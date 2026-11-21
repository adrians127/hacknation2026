#include "nmap_xml.hpp"

#include <pugixml.hpp>

#include <algorithm>
#include <cstdint>
#include <expected>
#include <chrono>
#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <utility>

namespace nmap_worker {
namespace {
std::optional<std::string> attribute_string(pugi::xml_node node, const char* name) {
    const auto attribute = node.attribute(name);
    if (!attribute || std::string_view{attribute.value()}.empty()) return std::nullopt;
    return std::string{attribute.value()};
}
}  // namespace

std::expected<HostResult, Error> parse_nmap_xml(std::string_view xml, const Target& target) {
    pugi::xml_document document;
    const auto parsed = document.load_buffer(xml.data(), xml.size(), pugi::parse_default);
    if (!parsed) {
        return std::unexpected(Error{"invalid-xml", parsed.description()});
    }
    const auto run = document.child("nmaprun");
    if (!run) {
        return std::unexpected(Error{"invalid-xml", "Missing nmaprun element"});
    }
    const auto finished = run.child("runstats").child("finished");
    if (!finished || std::string_view{finished.attribute("exit").value()} != "success") {
        return std::unexpected(Error{"incomplete-xml", "Nmap did not finish successfully"});
    }
    const auto host = run.child("host");
    if (!host) {
        return std::unexpected(Error{"missing-host", "Nmap did not report the target host"});
    }
    bool has_matching_address = false;
    for (const auto address : host.children("address")) {
        if (std::string_view{address.attribute("addrtype").value()} == "ipv4" &&
            std::string_view{address.attribute("addr").value()} == target.ip) {
            has_matching_address = true;
            break;
        }
    }
    if (!has_matching_address) {
        return std::unexpected(Error{"wrong-host", "Nmap XML reported an unexpected host"});
    }
    const auto status = host.child("status");
    const std::string_view state{status.attribute("state").value()};
    HostResult result{.ip = target.ip, .domains = target.domains,
                      .status = state == "down" ? "down" : "up",
                      .reason = attribute_string(status, "reason"),
                      .observed_at = std::chrono::system_clock::now(),
                      .nmap_version = attribute_string(run, "version")};
    if (const auto times = host.child("times"); times && times.attribute("srtt")) {
        const auto micros = times.attribute("srtt").as_llong(-1);
        if (micros >= 0) result.latency_ms = (micros + 500) / 1000;
    }
    for (const auto name : host.child("hostnames").children("hostname")) {
        if (const auto value = attribute_string(name, "name")) result.ptr_names.push_back(*value);
    }
    if (result.status == "down") return result;
    bool responded = false;
    std::optional<std::string> response_reason;
    for (const auto extra : host.child("ports").children("extraports")) {
        if (std::string_view{extra.attribute("state").value()} == "closed") {
            responded = true;
            if (!response_reason)
                response_reason = attribute_string(extra.child("extrareasons"), "reason");
        }
    }
    std::set<std::uint16_t> open_ports;
    for (const auto port : host.child("ports").children("port")) {
        if (std::string_view{port.attribute("protocol").value()} != "tcp") continue;
        const unsigned number = port.attribute("portid").as_uint();
        if (number == 0 || number > 65535) continue;
        const auto port_number = static_cast<std::uint16_t>(number);
        if (!std::ranges::binary_search(target.tcp_ports, port_number)) {
            return std::unexpected(
                Error{"unexpected-port", "Nmap XML reported an unrequested port"});
        }
        const auto port_state = port.child("state");
        const std::string_view port_state_name{port_state.attribute("state").value()};
        if (port_state_name == "open" || port_state_name == "closed") {
            responded = true;
            if (!response_reason)
                response_reason = attribute_string(port_state, "reason");
        }
        if (port_state_name != "open") continue;
        if (!open_ports.insert(port_number).second) continue;
        PortObservation observation{.number = port_number,
                                    .protocol = "tcp",
                                    .state = "open",
                                    .reason = attribute_string(port_state, "reason")};
        if (port_state.attribute("reason_ttl")) {
            const int ttl = port_state.attribute("reason_ttl").as_int(-1);
            if (ttl >= 0 && ttl <= 255) observation.ttl = ttl;
        }
        const auto service = port.child("service");
        if (service && attribute_string(service, "name")) {
            ServiceObservation details{.name = service.attribute("name").value(),
                                       .product = attribute_string(service, "product"),
                                       .version = attribute_string(service, "version"),
                                       .extra_info = attribute_string(service, "extrainfo")};
            if (const auto method = attribute_string(service, "method"); method &&
                (*method == "probed" || *method == "table")) details.method = *method;
            const int confidence = service.attribute("conf").as_int(0);
            details.confidence = std::clamp(confidence, 0, 10);
            for (const auto cpe : service.children("cpe"))
                details.cpe.emplace_back(cpe.text().get());
            observation.service = std::move(details);
        }
        for (const auto script : port.children("script")) {
            observation.scripts.push_back(
                ScriptObservation{.id = script.attribute("id").value(),
                                  .output = script.attribute("output").value()});
        }
        result.ports.push_back(std::move(observation));
    }
    // -Pn sets Nmap's host state to "up" before any packet is sent. Only an
    // open/closed port is evidence that the target actually responded.
    if (!responded) {
        result.status = "down";
        result.reason = "no-response";
    } else if (response_reason) {
        result.reason = std::move(response_reason);
    }
    std::ranges::sort(result.ports, {}, &PortObservation::number);
    return result;
}

}  // namespace nmap_worker
