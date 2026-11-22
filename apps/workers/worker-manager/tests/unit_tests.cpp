// Dependency-free unit tests: range math, job list parsing, splitting, status aggregation,
// lease request helpers.

#include <chrono>
#include <cstdlib>
#include <format>
#include <nlohmann/json.hpp>
#include <print>
#include <source_location>
#include <stop_token>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

#include "backend_client.hpp"
#include "config.hpp"
#include "footprint.hpp"
#include "ipv4.hpp"
#include "job.hpp"
#include "planner.hpp"
#include "scheduler.hpp"
#include "task_runner.hpp"

namespace {

using namespace worker_manager;

int g_failures = 0;  // test-only counter

void check(bool condition, std::string_view what,
           std::source_location where = std::source_location::current()) {
    if (!condition) {
        ++g_failures;
        std::println(stderr, "FAIL {}:{}: {}", where.file_name(), where.line(), what);
    }
}

constexpr PlanLimits kLimits{.max_tasks_per_job = 8, .max_parallel = 2};

Job make_job(const char* text) {
    const auto list = parse_job_list(Json::parse(text));
    if (!list || list->jobs.size() != 1) {
        std::println(stderr, "bad test fixture: {}", text);
        std::exit(EXIT_FAILURE);
    }
    return list->jobs.front();
}

void test_ipv4() {
    check(parse_ipv4("10.1.2.3") == 0x0A010203U, "parse ipv4");
    for (const char* bad :
         {"10.1.2", "10.1.2.3.4", "256.1.1.1", "1..1.1", "-1.1.1.1", "a.b.c.d", "1.1.1.0001"}) {
        check(!parse_ipv4(bad), std::string{"rejects "} + bad);
    }
    check(parse_ipv4_spec("10.0.0.77/24") == Ipv4Range{0x0A000000U, 0x0A0000FFU}, "cidr");
    check(parse_ipv4_spec("0.0.0.0/0") == Ipv4Range{0U, 0xFFFFFFFFU}, "cidr /0");
    check(parse_ipv4_spec("10.0.0.5-10.0.0.9") == Ipv4Range{0x0A000005U, 0x0A000009U}, "range");
    check(!parse_ipv4_spec("10.0.0.9-10.0.0.5"), "reversed range");
    check(!parse_ipv4_spec("10.0.0.0/33"), "prefix > 32");

    const auto specs =
        parse_ipv4_specs(Json::parse(R"(["10.0.0.0/25", "10.0.0.128/25, 10.0.1.1"])"));
    check(specs && *specs == std::vector<Ipv4Range>{{0x0A000000U, 0x0A0000FFU},
                                                    {0x0A000101U, 0x0A000101U}},
          "specs merged");
    check(
        parse_ipv4_specs("10.0.0.1,10.0.0.2") && parse_ipv4_specs("10.0.0.1,10.0.0.2")->size() == 1,
        "comma string");
    check(!parse_ipv4_specs(Json::parse(R"(["example.com"])")), "rejects a hostname");

    const auto top = merge_ranges({{0xFFFFFFF0U, 0xFFFFFFFFU}, {1, 2}});
    check(top.size() == 2 && top.back().last == 0xFFFFFFFFU, "merge at the top of the space");

    check(subtract_ranges({{0, 99}}, {{10, 19}, {50, 200}}) ==
              std::vector<Ipv4Range>{{0, 9}, {20, 49}},
          "subtract");
    check(subtract_ranges({{0, 9}}, {{0, 9}}).empty(), "subtract everything");
    check(
        subtract_ranges({{0, 9}, {20, 29}}, {{5, 24}}) == std::vector<Ipv4Range>{{0, 4}, {25, 29}},
        "subtract across ranges");

    const auto groups = split_ranges({{0, 4}, {10, 14}}, 3);
    check(groups.size() == 3 && count_addresses(groups[0]) == 4 &&
              count_addresses(groups[1]) == 3 && count_addresses(groups[2]) == 3,
          "split sizes differ by at most one");
    check(groups[1] == std::vector<Ipv4Range>{{4, 4}, {10, 11}}, "split crosses a gap");

    check(format_ipv4_range({0x0A000000U, 0x0A0000FFU}) == "10.0.0.0/24", "format cidr");
    check(format_ipv4_range({0x0A000001U, 0x0A000001U}) == "10.0.0.1", "format single");
    check(format_ipv4_range({0x0A000001U, 0x0A000004U}) == "10.0.0.1-10.0.0.4", "format range");
}

void test_job_list() {
    check(!parse_job_list(Json::parse("[]")), "document must be an object");
    check(!parse_job_list(Json::parse(R"({"jobs": {}})")), "jobs must be an array");
    check(!parse_job_list(Json::parse(R"({"schema_version": 2, "jobs": []})")), "schema version");

    const auto list = parse_job_list(Json::parse(R"({
      "schema_version": 1,
      "jobs": [
        {"job_id": "a", "worker": "masscan", "deadline": "2026-11-21T17:30:00Z",
         "split": {"strategy": "shard", "max_tasks": 4}, "params": {"targets": ["10.0.0.0/24"]}},
        {"job_id": "a", "worker": "masscan", "params": {}},
        {"job_id": "../x", "worker": "masscan", "params": {}},
        {"job_id": "c", "params": {}},
        {"job_id": "d", "worker": "masscan", "split": {"strategy": "magic"}, "params": {}},
        {"job_id": "e", "worker": "masscan", "deadline": "tomorrow", "params": {}},
        {"job_id": "f", "worker": "masscan", "params": []},
        42
      ]})"));
    check(list.has_value(), "list parses");
    if (!list) return;
    check(list->jobs.size() == 1 && list->invalid.size() == 7, "one valid job, seven invalid");
    const Job& job = list->jobs.front();
    check(job.split.strategy == SplitStrategy::kShard && job.split.max_tasks == 4u, "split");
    check(job.deadline && format_timestamp(*job.deadline) == "2026-11-21T17:30:00.000Z",
          "deadline");
    check(list->invalid[0].message.find("duplicate") != std::string::npos, "duplicate id");

    check(parse_timestamp("2026-11-21T17:30:00.250Z").has_value(), "fractional seconds");
    check(!parse_timestamp("2026-02-30T00:00:00Z"), "invalid date");
    check(!parse_timestamp("2026-11-21 17:30:00Z"), "missing T");
    check(is_safe_id("0193a1aa-6c1e.job_1") && !is_safe_id(".hidden") && !is_safe_id("a/b"),
          "safe ids");
}

void test_plan_none() {
    const auto plan = plan_job(make_job(R"({"jobs": [{"job_id": "j", "scan_id": "s",
        "worker": "masscan", "params": {"targets": ["10.0.0.1"], "rate": 1000, "job_id": "x"}}]})"),
                               kLimits, 7);
    check(plan && plan->tasks.size() == 1, "one task");
    const Json& input = plan->tasks.front().input;
    check(input["job_id"] == "j", "envelope wins over params");
    check(input["scan_id"] == "s" && input["lease_id"].is_null(), "ids echoed");
    check(input["task_id"] == "j/1" && input["task_count"] == 1, "task envelope");
    check(input["rate"] == 1000, "rate untouched for one task");
}

void test_plan_shard() {
    const auto plan = plan_job(make_job(R"({"jobs": [{"job_id": "j", "worker": "masscan",
        "split": {"strategy": "shard", "max_tasks": 4},
        "params": {"targets": ["10.0.0.0/16"], "rate": 10000}}]})"),
                               kLimits, 1234);
    check(plan && plan->tasks.size() == 4, "four shards");
    for (const Task& task : plan->tasks) {
        check(task.input["seed"] == 1234, "same seed for every shard");
        check(task.input["shard"]["total"] == 4 && task.input["shard"]["index"] == task.index,
              "shard index");
        check(task.input["rate"] == 10000, "the planner leaves the rate to the scheduler");
    }

    const auto given_seed = plan_job(make_job(R"({"jobs": [{"job_id": "j", "worker": "masscan",
        "split": {"strategy": "shard", "max_tasks": 2}, "params": {"targets": ["10.0.0.0/16"],
        "seed": 99}}]})"),
                                     kLimits, 1234);
    check(given_seed && given_seed->tasks[1].input["seed"] == 99, "the job's seed is kept");

    const auto resume = plan_job(make_job(R"({"jobs": [{"job_id": "j", "worker": "masscan",
        "split": {"strategy": "shard", "max_tasks": 4},
        "params": {"targets": ["10.0.0.0/16"], "seed": 5, "resume_index": 100}}]})"),
                                 kLimits, 1);
    check(resume && resume->tasks.size() == 1 && resume->strategy == SplitStrategy::kNone &&
              !resume->warnings.empty(),
          "a resume is never split");

    const auto capped = plan_job(make_job(R"({"jobs": [{"job_id": "j", "worker": "masscan",
        "split": {"strategy": "shard", "max_tasks": 100}, "params": {"targets": ["10.0.0.0/8"]}}]})"),
                                 kLimits, 1);
    check(capped && capped->tasks.size() == 8, "operator cap on tasks per job");
}

void test_plan_ranges() {
    const auto plan = plan_job(make_job(R"({"jobs": [{"job_id": "j", "worker": "masscan",
        "split": {"strategy": "ranges", "max_items_per_task": 256},
        "params": {"targets": ["10.0.0.0/22"], "exclude": ["10.0.1.0/24"]}}]})"),
                               kLimits, 1);
    check(plan && plan->tasks.size() == 3, "768 addresses / 256 = 3 tasks");
    if (!plan || plan->tasks.size() != 3) return;
    check(plan->tasks[0].input["targets"] == Json::parse(R"(["10.0.0.0/24"])"), "first block");
    check(plan->tasks[1].input["targets"] == Json::parse(R"(["10.0.2.0/24"])"), "skips exclude");
    check(plan->tasks[2].input["exclude"] == Json::array(), "exclude already applied");

    const auto tiny = plan_job(make_job(R"({"jobs": [{"job_id": "j", "worker": "masscan",
        "split": {"strategy": "ranges", "max_tasks": 8}, "params": {"targets": "10.0.0.1-10.0.0.3"}}]})"),
                               kLimits, 1);
    check(tiny && tiny->tasks.size() == 3, "never more tasks than addresses");

    const auto empty = plan_job(make_job(R"({"jobs": [{"job_id": "j", "worker": "masscan",
        "split": {"strategy": "ranges"}, "params": {"targets": ["10.0.0.0/24"],
        "exclude": ["10.0.0.0/16"]}}]})"),
                                kLimits, 1);
    check(!empty, "everything excluded");

    const auto bad = plan_job(make_job(R"({"jobs": [{"job_id": "j", "worker": "masscan",
        "split": {"strategy": "ranges"}, "params": {"targets": ["nope"]}}]})"),
                              kLimits, 1);
    check(!bad, "invalid targets");
}

void test_plan_chunk() {
    const auto plan = plan_job(make_job(R"({"jobs": [{"job_id": "j", "worker": "nmap",
        "split": {"strategy": "chunk", "max_items_per_task": 2},
        "params": {"targets": [1, 2, 3, 4, 5]}}]})"),
                               kLimits, 1);
    check(plan && plan->tasks.size() == 3, "five items / 2 = 3 tasks");
    if (!plan || plan->tasks.size() != 3) return;
    check(plan->tasks[0].input["targets"] == Json::parse("[1, 2]"), "first chunk");
    check(plan->tasks[2].input["targets"] == Json::parse("[5]"), "last chunk");

    const auto missing = plan_job(make_job(R"({"jobs": [{"job_id": "j", "worker": "nmap",
        "split": {"strategy": "chunk"}, "params": {}}]})"),
                                  kLimits, 1);
    check(!missing, "chunk needs targets");
}

void test_aggregate() {
    using V = std::vector<std::string_view>;
    check(aggregate_status(V{"completed", "completed"}) == "completed", "all completed");
    check(aggregate_status(V{"completed", "failed"}) == "partial", "some failed");
    check(aggregate_status(V{"partial"}) == "partial", "partial");
    check(aggregate_status(V{"failed", "cancelled"}) == "failed", "nothing usable");
    check(aggregate_status(V{"cancelled"}) == "cancelled", "all cancelled");
    check(aggregate_status(V{}) == "completed", "nothing to do");
}

void test_config() {
    const auto workers = parse_worker_binaries(" masscan = masscan-worker , nmap=/opt/nmap-worker");
    check(workers.size() == 2 && workers[0].name == "masscan" &&
              workers[1].binary == "/opt/nmap-worker",
          "worker list");
    bool threw = false;
    try {
        (void)parse_worker_binaries("masscan");
    } catch (const std::exception&) {
        threw = true;
    }
    check(threw, "name=binary required");
    check(parse_stages("masscan, nmap") == std::vector<std::string>{"masscan", "nmap"}, "stages");
    threw = false;
    try {
        (void)parse_stages("masscan,masscan");
    } catch (const std::exception&) {
        threw = true;
    }
    check(threw, "repeated stage");
    const auto caps = parse_worker_rate_caps("nmap=100, other = 5000");
    check(caps.size() == 2 && caps[0].name == "nmap" && caps[0].rate == 100 && caps[1].rate == 5000,
          "worker rate caps");
    check(parse_worker_rate_caps("").empty(), "no worker rate caps");
    for (const char* bad : {"nmap", "nmap=0", "nmap=x", "=5"}) {
        threw = false;
        try {
            (void)parse_worker_rate_caps(bad);
        } catch (const std::exception&) {
            threw = true;
        }
        check(threw, std::string{"rejects rate cap "} + bad);
    }
    check(random_seed() < (std::uint64_t{1} << 53), "seed below 2^53");
    check(parse_backend_url("http://localhost:3001/v1/") == "http://localhost:3001/v1",
          "backend url, trailing slash dropped");
    check(parse_backend_url("https://api.example.org") == "https://api.example.org",
          "https backend url");
    for (const char* bad :
         {"localhost:3001", "ftp://host/v1", "http://", "http:///v1", "http://host/v 1", ""}) {
        threw = false;
        try {
            (void)parse_backend_url(bad);
        } catch (const std::exception&) {
            threw = true;
        }
        check(threw, std::string{"rejects backend url "} + bad);
    }
}

void test_lease() {
    using std::chrono::milliseconds;
    using std::chrono::seconds;
    const Json body = lease_request_body({.manager_id = "scan-1",
                                          .workers = {"masscan", "nmap"},
                                          .max_parallel = 4,
                                          .wait = seconds{30}});
    check(body["manager_id"] == "scan-1" && body["workers"] == Json::array({"masscan", "nmap"}) &&
              body["max_parallel"] == 4 && body["wait_seconds"] == 30 && body.contains("version"),
          "lease request body");

    check(next_poll_delay(Json::parse(R"({"jobs": []})")) == milliseconds{0}, "no next_poll_ms");
    check(next_poll_delay(Json::parse(R"({"next_poll_ms": 2500})")) == milliseconds{2500},
          "next_poll_ms");
    check(next_poll_delay(Json::parse(R"({"next_poll_ms": -5})")) == milliseconds{0},
          "negative next_poll_ms ignored");
    check(next_poll_delay(Json::parse(R"({"next_poll_ms": "5"})")) == milliseconds{0},
          "string next_poll_ms ignored");
    check(next_poll_delay(Json::parse(R"({"next_poll_ms": 99999999999})")) == milliseconds{300'000},
          "next_poll_ms capped at 5 minutes");

    check(retry_delay(seconds{5}, 1) == milliseconds{5'000}, "first retry");
    check(retry_delay(seconds{5}, 3) == milliseconds{20'000}, "retry doubles");
    check(retry_delay(seconds{5}, 40) == milliseconds{60'000}, "retry capped at 60 s");
    check(retry_delay(seconds{90}, 5) == milliseconds{90'000}, "a base above the cap is kept");
}

void test_upload() {
    const Json result = Json::parse(R"({"scan": {"jobId": "j"}, "hosts": []})");
    const Json body = upload_body(2, 3, result);
    check(body.dump() ==
              R"({"task_index":2,"task_count":3,"result":{"scan":{"jobId":"j"},"hosts":[]}})",
          "upload body");
    for (const long status : {408L, 429L, 500L, 502L, 503L}) {
        check(is_retryable_status(status), std::format("retries HTTP {}", status));
    }
    for (const long status : {400L, 401L, 403L, 404L, 409L, 413L, 422L}) {
        check(!is_retryable_status(status), std::format("does not retry HTTP {}", status));
    }
    std::stop_source stopped;
    stopped.request_stop();
    check(!sleep_unless_stopped(std::chrono::seconds{30}, stopped.get_token()),
          "a stopped sleep returns at once");
    check(sleep_unless_stopped(std::chrono::milliseconds{1}, std::stop_token{}), "a short sleep");
}

Footprint fp(const char* input) { return footprint_of(Json::parse(input)); }

void test_ports() {
    const auto ports = parse_port_specs(Json::parse(R"([443, "8000-8100", "22,80"])"));
    check(ports && *ports == PortSet{{22, 22}, {80, 80}, {443, 443}, {8000, 8100}}, "ports");
    check(parse_port_specs("1-3,2-5") && *parse_port_specs("1-3,2-5") == PortSet{{1, 5}},
          "ports merged");
    for (const char* bad : {"0", "65536", "5-1", "x", ""}) {
        check(!parse_port_specs(bad), std::string{"rejects port "} + bad);
    }
    check(count_ports({{1, 65535}}) == 65535, "count ports");
}

void test_footprint() {
    const Footprint masscan =
        fp(R"({"targets": ["10.0.0.0/24"], "exclude": ["10.0.0.128/25"], "ports": "80,443"})");
    check(masscan.is_exact && masscan.areas.size() == 1 && masscan.address_count() == 128,
          "masscan footprint minus exclude");
    check(fp(R"({"targets": "10.0.0.1"})").areas.front().ports == PortSet{{1, 65535}},
          "no ports: all ports");

    const Footprint nmap = fp(R"({"targets": [{"ip": "10.0.0.5", "ports": [22, 80]},
                                             {"ip": "10.0.0.6", "ports": [443]},
                                             {"ip": "10.0.0.5", "ports": [8080]}]})");
    check(nmap.is_exact && nmap.areas.size() == 2, "nmap footprint, duplicate host merged");
    check(nmap.areas.front().ports == PortSet{{22, 22}, {80, 80}, {8080, 8080}},
          "ports of a repeated host united");

    const Footprint overlapping = fp(R"({"targets": [{"ip": "10.0.0.0/30", "ports": "80"},
                                                    {"ip": "10.0.0.2/31", "ports": "22"}]})");
    check(overlapping.areas.size() == 2 && overlapping.areas[1].ips.first == 0x0A000002U &&
              overlapping.areas[1].ports == PortSet{{22, 22}, {80, 80}},
          "overlapping areas cut into disjoint segments");

    check(!fp(R"({"ports": "80"})").is_exact, "no targets: everything");
    check(!fp(R"({"targets": ["example.com"]})").is_exact, "unreadable: everything");

    const Footprint b = fp(R"({"targets": ["10.0.0.0/25"], "ports": "443"})");
    const Footprint c = fp(R"({"targets": ["10.0.0.200"], "ports": "80"})");
    const Footprint d = fp(R"({"targets": ["10.0.0.0/24"], "ports": "22"})");
    check(overlaps(masscan, b), "same IPs, shared port");
    check(!overlaps(masscan, c), "IP in the excluded half");
    check(!overlaps(masscan, d), "same IPs, other port");
    check(overlaps(nmap, d), "nmap host on port 22 inside the /24");
    check(overlaps(everything(), c) && overlaps(c, everything()), "everything overlaps");
    check(!overlaps(masscan, Footprint{}), "empty footprint");
}

struct Fixture {
    const char* id;
    const char* input;
    std::optional<std::size_t> stage = 0;
    std::optional<std::uint64_t> rate_cap = std::nullopt;
    std::optional<std::size_t> partition = std::nullopt;
};

std::vector<ScheduledTask> make_tasks(std::initializer_list<Fixture> fixtures) {
    std::vector<ScheduledTask> tasks;
    std::size_t job = 0;
    for (const Fixture& f : fixtures) {
        tasks.push_back({.task_id = f.id,
                         .job = f.partition.value_or(job++ + 100),
                         .rate_cap = f.rate_cap,
                         .stage = f.stage,
                         .partition = f.partition,
                         .footprint = fp(f.input)});
    }
    return tasks;
}

void test_scheduler() {
    const Logger logger{LogLevel::kError, LogFormat::kText};
    const std::stop_source stop;
    const RateBudget plenty{.total = 1'000'000, .min_task = 1};

    // Queue order, overlap and stages (every job capped well below the budget).
    Scheduler scheduler{
        make_tasks({
            {"svc", R"({"targets": [{"ip": "10.0.0.5", "ports": [80]}]})", 1, 10},
            {"a", R"({"targets": ["10.0.0.0/24"], "ports": "80"})", 0, 10},
            {"b", R"({"targets": ["10.0.0.0/25"], "ports": "80"})", 0, 10},
            {"c", R"({"targets": ["10.9.0.0/24"], "ports": "80"})", 0, 10},
            {"shard1", R"({"targets": ["10.5.0.0/24"]})", 0, 10, 7},
            {"shard2", R"({"targets": ["10.5.0.0/24"]})", 0, 10, 7},
            {"other", R"({"targets": ["10.0.0.5"], "ports": "80"})", std::nullopt, 10},
        }),
        plenty, logger};
    check(scheduler.predecessors(0).size() == 2, "svc waits for a and b");
    check(scheduler.predecessors(6).empty(), "an unstaged worker is never ordered");

    std::vector<std::size_t> started;
    for (int i = 0; i < 3; ++i) started.push_back(scheduler.acquire(stop.get_token())->id);
    // svc waits (stage), b and other overlap a, shard2 shares its job's rate 10 with shard1.
    check(started == std::vector<std::size_t>{1, 3, 4}, "first wave: a, c, shard1");
    scheduler.release(4);
    check(scheduler.acquire(stop.get_token())->id == 5u, "shard2 once shard1 gave the rate back");
    scheduler.release(1);  // a done
    check(scheduler.acquire(stop.get_token())->id == 2u, "b starts after a");
    scheduler.release(2);
    check(scheduler.acquire(stop.get_token())->id == 0u, "svc after a and b");
    for (const std::size_t id : {3, 5, 0}) scheduler.release(id);
    check(scheduler.acquire(stop.get_token())->id == 6u, "other last");
    scheduler.release(6);
    check(!scheduler.acquire(stop.get_token()), "nothing left");

    // Rate budget 1000: the head of the queue takes what it may, the next ones the rest.
    Scheduler rated{make_tasks({
                        {"x", R"({"targets": ["10.1.0.0/24"]})", 0, 600},
                        {"y", R"({"targets": ["10.2.0.0/24"]})", 0, std::nullopt},
                        {"z", R"({"targets": ["10.3.0.0/24"]})", 0, 300},
                        {"w", R"({"targets": ["10.4.0.0/24"]})", 0, 50},
                    }),
                    {.total = 1000, .min_task = 100},
                    logger};
    const auto x = rated.acquire(stop.get_token());
    check(x && x->id == 0 && x->rate == 600, "x takes its own rate");
    const auto y = rated.acquire(stop.get_token());
    check(y && y->id == 1 && y->rate == 400, "y (no rate) takes all that is left");
    rated.release(0);
    const auto z = rated.acquire(stop.get_token());
    check(z && z->id == 2 && z->rate == 300, "z gets x's freed share");
    const auto w = rated.acquire(stop.get_token());
    check(w && w->id == 3 && w->rate == 50, "a job asking for less than the minimum still runs");

    // The head of the queue keeps the budget: nothing behind it overtakes.
    Scheduler fair{make_tasks({
                       {"big", R"({"targets": ["10.1.0.0/24"]})", 0, std::nullopt},
                       {"head", R"({"targets": ["10.2.0.0/24"]})", 0, 500},
                       {"tail", R"({"targets": ["10.3.0.0/24"]})", 0, 50},
                   }),
                   {.total = 1000, .min_task = 100},
                   logger};
    check(fair.acquire(stop.get_token())->rate == 1000, "big takes everything");
    std::stop_source give_up;
    std::jthread stopper{[&] {
        std::this_thread::sleep_for(std::chrono::milliseconds{50});
        give_up.request_stop();
    }};
    const auto next = fair.acquire(give_up.get_token());
    check(next && next->id == 1 && next->rate == 0,
          "tail did not overtake head while the budget was empty (handed out only on stop)");

    // After a stop every remaining task is handed out at once (to be cancelled).
    Scheduler stopping{
        make_tasks({{"p", R"({"targets": ["10.0.0.1"]})"}, {"q", R"({"targets": ["10.0.0.1"]})"}}),
        plenty, logger};
    std::stop_source requested;
    check(stopping.acquire(requested.get_token())->id == 0u, "p starts");
    requested.request_stop();
    check(stopping.acquire(requested.get_token())->id == 1u, "q handed out despite the conflict");
}

}  // namespace

int main() {
    test_ipv4();
    test_job_list();
    test_plan_none();
    test_plan_shard();
    test_plan_ranges();
    test_plan_chunk();
    test_aggregate();
    test_config();
    test_lease();
    test_upload();
    test_ports();
    test_footprint();
    test_scheduler();
    if (g_failures > 0) {
        std::println(stderr, "{} check(s) failed", g_failures);
        return EXIT_FAILURE;
    }
    std::println("all unit tests passed");
    return EXIT_SUCCESS;
}
