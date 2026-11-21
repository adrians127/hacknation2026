#include "nmap_xml.hpp"

#include <pugixml.hpp>

#include <algorithm>
#include <cstdint>
#include <expected>
#include <set>
#include <string>
#include <string_view>
#include <utility>

namespace nmap_worker {

std::expected<HostResult, Error> parse_nmap_xml(std::string_view xml, const Target& target) {
    pugi::xml_document document;
    const auto parsed = document.load_buffer(xml.data(), xml.size(), pugi::parse_default);
    if (!parsed) {
        return std::unexpected(Error{"invalid_xml", parsed.description()});
    }
    const auto run = document.child("nmaprun");
    if (!run) {
        return std::unexpected(Error{"invalid_xml", "Missing nmaprun element"});
    }
    const auto finished = run.child("runstats").child("finished");
    if (!finished || std::string_view{finished.attribute("exit").value()} != "success") {
        return std::unexpected(Error{"incomplete_xml", "Nmap did not finish successfully"});
    }
    const auto host = run.child("host");
    if (!host) {
        return std::unexpected(Error{"missing_host", "Nmap did not report the target host"});
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
        return std::unexpected(Error{"wrong_host", "Nmap XML reported an unexpected host"});
    }
    HostResult result{.ip = target.ip, .domain = target.domain, .status = "scanned"};
    std::set<std::uint16_t> reported;
    for (const auto port : host.child("ports").children("port")) {
        if (std::string_view{port.attribute("protocol").value()} != "tcp") continue;
        const unsigned number = port.attribute("portid").as_uint();
        if (number == 0 || number > 65535) continue;
        const auto port_number = static_cast<std::uint16_t>(number);
        if (!std::ranges::binary_search(target.tcp_ports, port_number)) {
            return std::unexpected(
                Error{"unexpected_port", "Nmap XML reported an unrequested port"});
        }
        reported.insert(port_number);
        PortObservation observation{.number = port_number,
                                    .protocol = "tcp",
                                    .state = port.child("state").attribute("state").value()};
        const auto service = port.child("service");
        if (service) {
            ServiceObservation details{.name = service.attribute("name").value(),
                                       .product = service.attribute("product").value(),
                                       .version = service.attribute("version").value()};
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
    for (const auto port : target.tcp_ports) {
        if (!reported.contains(port)) {
            result.ports.push_back(
                PortObservation{.number = port, .protocol = "tcp", .state = "not_reported"});
        }
    }
    std::ranges::sort(result.ports, {}, &PortObservation::number);
    return result;
}

}  // namespace nmap_worker
