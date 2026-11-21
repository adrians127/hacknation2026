// Dependency-free unit tests: input validation, range math, masscan output parsing, topology.

#include <chrono>
#include <cstdlib>
#include <nlohmann/json.hpp>
#include <print>
#include <source_location>
#include <string>
#include <string_view>
#include <vector>

#include "address.hpp"
#include "config.hpp"
#include "logger.hpp"
#include "masscan_runner.hpp"
#include "scan_job.hpp"
#include "topology.hpp"

namespace {

using namespace masscan_worker;
using nlohmann::json;

int g_failures = 0;  // test-only counter

void check(bool condition, std::string_view what,
           std::source_location where = std::source_location::current()) {
    if (!condition) {
        ++g_failures;
        std::println(stderr, "FAIL {}:{}: {}", where.file_name(), where.line(), what);
    }
}

const Config kConfig{.masscan_binary = "masscan",
                     .default_rate = 10'000,
                     .max_rate = 50'000,
                     .max_target_addresses = 1U << 20,
                     .log_level = LogLevel::kInfo,
                     .log_format = LogFormat::kText,
                     .progress_interval = std::chrono::seconds{5}};

void test_addresses() {
    check(parse_ipv4("10.1.2.3") == 0x0A010203U, "parse ipv4");
    for (const char* bad : {"10.1.2", "10.1.2.3.4", "256.1.1.1", "1..1.1", "-1.1.1.1", "1.1.1.1 ",
                            "a.b.c.d", "1.1.1.0001", "--rate"}) {
        check(!parse_ipv4(bad), std::string{"rejects "} + bad);
    }
    check(parse_ipv4_range("10.0.0.77/24") == Ipv4Range{0x0A000000U, 0x0A0000FFU}, "cidr");
    check(parse_ipv4_range("0.0.0.0/0") == Ipv4Range{0U, 0xFFFFFFFFU}, "cidr /0");
    check(parse_ipv4_range("10.0.0.5-10.0.0.9") == Ipv4Range{0x0A000005U, 0x0A000009U}, "range");
    check(!parse_ipv4_range("10.0.0.9-10.0.0.5"), "reversed range");
    check(!parse_ipv4_range("10.0.0.0/33"), "prefix > 32");
    check(format_ipv4_range({0x0A000005U, 0x0A000009U}) == "10.0.0.5-10.0.0.9", "format range");
    check(format_subnet(0x0A0001FEU, 24) == "10.0.1.0/24", "format subnet");

    const auto merged = merge_ranges(std::vector<Ipv4Range>{{10, 20}, {21, 30}, {5, 12}, {40, 50}});
    check(merged == std::vector<Ipv4Range>{{5, 30}, {40, 50}}, "merge adjacent/overlapping");
    const auto top = merge_ranges(std::vector<Ipv4Range>{{0xFFFFFFF0U, 0xFFFFFFFFU}, {1, 2}});
    check(top.size() == 2 && top[1].last == 0xFFFFFFFFU, "merge at max address does not wrap");

    const std::vector<Ipv4Range> include{{0, 99}, {200, 299}};
    const std::vector<Ipv4Range> exclude{{10, 19}, {90, 210}, {299, 299}};
    check(subtract_ranges(include, exclude) == std::vector<Ipv4Range>{{0, 9}, {20, 89}, {211, 298}},
          "subtract");
    check(count_addresses(include) == 200, "count addresses");

    check(parse_port_range("80") == PortRange{80, 80}, "port");
    check(parse_port_range("1-65535") == PortRange{1, 65535}, "all ports");
    check(!parse_port_range("0") && !parse_port_range("65536") && !parse_port_range("90-80"),
          "bad ports");
    const auto ports = merge_ranges(std::vector<PortRange>{{443, 443}, {80, 80}, {81, 90}});
    check(format_port_ranges(ports) == "80-90,443", "format ports");
}

void test_scan_job() {
    std::vector<std::string> warnings;
    const auto job = parse_scan_job(json::parse(R"({
        "job_id": "j1", "targets": ["10.0.0.0/24", "10.0.1.1-10.0.1.10"],
        "exclude": "10.0.0.0/30", "ports": [22, "80-81", "443"], "rate": 999999,
        "max_duration_seconds": 60, "seed": 7, "shard": {"index": 2, "total": 4}
    })"),
                                    kConfig, warnings);
    check(job.has_value(), "valid job parses");
    if (job) {
        check(count_addresses(job->ranges) == 252 + 10, "excludes applied");
        check(format_port_ranges(job->ports) == "22,80-81,443", "ports normalized");
        check(job->rate == kConfig.max_rate && warnings.size() == 1, "rate clamped with warning");
        check(job->shard && job->shard->index == 2 && job->seed == 7, "shard and seed");

        const auto args = build_masscan_args(*job, kConfig, "/tmp/t.txt");
        const auto has = [&args](std::string_view flag, std::string_view value) {
            for (std::size_t i = 0; i + 1 < args.size(); ++i) {
                if (args[i] == flag && args[i + 1] == value) return true;
            }
            return false;
        };
        check(has("-iL", "/tmp/t.txt") && has("-p", "22,80-81,443") && has("--rate", "50000") &&
                  has("--shards", "2/4") && has("--seed", "7") && has("-oD", "-"),
              "masscan argv");
    }

    const auto defaults = parse_scan_job(json{{"targets", "192.168.1.1"}}, kConfig, warnings);
    check(defaults && count_ports(defaults->ports) == 65535 && defaults->rate == 10'000,
          "defaults: all ports, default rate");

    for (const char* bad : {
             R"({})",
             R"({"targets": []})",
             R"({"targets": ["10.0.0.1; rm -rf /"]})",
             R"({"targets": ["10.0.0.0/8"], "ports": [0]})",
             R"({"targets": ["10.0.0.0/8"]})",  // above max_target_addresses
             R"({"targets": ["10.0.0.1"], "exclude": ["10.0.0.0/24"]})",
             R"({"targets": ["10.0.0.1"], "shard": {"index": 1, "total": 2}})",  // no seed
             R"({"targets": ["10.0.0.1"], "resume_index": 5})",                  // no seed
             R"({"targets": ["10.0.0.1"], "adapter": "--rate"})",
             R"({"targets": ["10.0.0.1"], "router_mac": "zz:00:00:00:00:00"})",
             R"({"targets": ["10.0.0.1"], "rate": -5})",
         }) {
        check(!parse_scan_job(json::parse(bad), kConfig, warnings), std::string{"rejects "} + bad);
    }
}

void test_parse_finding() {
    const auto open = parse_finding(
        R"({"ip":"10.16.11.1","timestamp":"1795277913","port":53,"proto":"tcp","rec_type":"status","data":{"status":"open","reason":"syn-ack","ttl":64}})");
    check(open && open->ip == 0x0A100B01U && open->port == 53 && open->ttl == 64, "open record");
    check(!parse_finding(
              R"({"ip":"10.0.0.1","port":80,"proto":"tcp","rec_type":"banner","data":{}})"),
          "banner ignored");
    check(
        !parse_finding(
            R"({"ip":"10.0.0.1","port":80,"proto":"tcp","rec_type":"status","data":{"status":"closed"}})"),
        "closed ignored");
    check(!parse_finding("not json") && !parse_finding("{\"finished\": 1}"), "garbage ignored");
}

void test_masscan_status() {
    const auto running =
        parse_masscan_status("rate:  9.98-kpps, 42.10% done,   1:02:03 remaining, found=17       ");
    check(running && running->rate_pps > 9979 && running->rate_pps < 9981 &&
              running->percent_done > 42.09 && running->remaining == std::chrono::seconds{3723} &&
              !running->waiting && running->found == 17,
          "running status line");
    const auto early =
        parse_masscan_status("rate:  0.00-kpps,  0.10% done,48085:35:47 remaining, found=0");
    check(early && early->remaining == std::chrono::seconds{48085 * 3600 + 35 * 60 + 47},
          "status without space after comma");
    const auto waiting =
        parse_masscan_status("rate:  0.00-kpps, 100.00% done, waiting 2-secs, found=3");
    check(waiting && waiting->waiting == std::chrono::seconds{2} && !waiting->remaining &&
              waiting->found == 3,
          "waiting status line");
    check(!parse_masscan_status("Starting masscan 1.3.2") && !parse_masscan_status("rate: x"),
          "non-status lines");
    check(parse_log_level("debug") == LogLevel::kDebug && !parse_log_level("loud") &&
              parse_log_format("json") == LogFormat::kJson,
          "log settings");
}

void test_topology() {
    TopologyBuilder topology{24};
    topology.add({0x0A000105U, 443, 61});
    topology.add({0x0A000105U, 22, 61});
    topology.add({0x0A000105U, 443, 61});  // retry duplicate
    topology.add({0x0A000101U, 3389, 128});
    topology.add({0x0A000201U, 80, 250});
    topology.finalize();
    check(topology.host_count() == 3 && topology.open_port_count() == 4 &&
              topology.subnet_count() == 2,
          "topology counts");

    const auto out = topology.to_json();
    const auto& first = out["subnets"][0];
    check(first["cidr"] == "10.0.1.0/24" && first["hosts_up"] == 2, "subnet grouping");
    check(first["hosts"][0]["ip"] == "10.0.1.1", "hosts sorted numerically");
    const auto& linux_host = first["hosts"][1];
    check(linux_host["estimated_hops"] == 3 && linux_host["os_family_hint"] == "unix-like" &&
              linux_host["open_ports"].size() == 2 && linux_host["open_ports"][0]["port"] == 22,
          "ttl hints and port dedupe");
    check(out["subnets"][1]["hosts"][0]["os_family_hint"] == "network-device", "ttl 250");
}

}  // namespace

int main() {
    test_addresses();
    test_scan_job();
    test_parse_finding();
    test_masscan_status();
    test_topology();
    if (g_failures > 0) {
        std::println(stderr, "{} check(s) failed", g_failures);
        return EXIT_FAILURE;
    }
    std::println("all tests passed");
    return EXIT_SUCCESS;
}
