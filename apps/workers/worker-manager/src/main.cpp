// worker-manager: a job list in (from a file, or long-polled from the backend), tasks out to
// independent worker processes, every result saved to files. See README.md for the formats.

#include <pthread.h>
#include <unistd.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <exception>
#include <expected>
#include <filesystem>
#include <format>
#include <map>
#include <optional>
#include <print>
#include <span>
#include <stop_token>
#include <string>
#include <string_view>
#include <system_error>
#include <thread>
#include <vector>

#include "backend_client.hpp"
#include "config.hpp"
#include "files.hpp"
#include "footprint.hpp"
#include "http_client.hpp"
#include "job.hpp"
#include "logger.hpp"
#include "planner.hpp"
#include "result_uploader.hpp"
#include "scheduler.hpp"
#include "task_runner.hpp"

namespace worker_manager {

namespace {

constexpr int kExitOk = 0;
constexpr int kExitJobFailed = 1;
constexpr int kExitInvalidInput = 2;
constexpr int kExitInterrupted = 130;

// A backend that answers "no work" at once instead of holding the request is still asked at
// most this often.
constexpr auto kMinPollPeriod = std::chrono::seconds{1};

constexpr std::string_view kUsage =
    R"(usage: worker-manager (--input FILE | --poll) [--output-dir DIR]

  --input FILE       run one job list JSON ("-" for stdin), then exit
  --poll             long-poll the backend for job lists and run each one, until
                     SIGINT/SIGTERM (needs WORKER_MANAGER_TOKEN)
  --output-dir DIR   base directory for results (default: results); every job list
                     gets its own <DIR>/<run-id>/ subdirectory
  --version          print version and exit

Exit codes (--input): 0 every job completed or partial, 1 a job failed, 2 invalid input or
usage, 130 stopped by SIGINT/SIGTERM. (--poll): 0 stopped by SIGINT/SIGTERM, 2 invalid
configuration or usage.
)";

struct CliOptions {
    std::string input_path;
    bool is_polling = false;
    std::filesystem::path output_dir = "results";
};

std::optional<CliOptions> parse_cli(std::span<char* const> args) {
    CliOptions options;
    for (std::size_t i = 1; i < args.size(); ++i) {
        const std::string_view arg{args[i]};
        const bool has_value = i + 1 < args.size();
        if (arg == "--input" && has_value) {
            options.input_path = args[++i];
        } else if (arg == "--poll") {
            options.is_polling = true;
        } else if (arg == "--output-dir" && has_value) {
            options.output_dir = args[++i];
        } else {
            return std::nullopt;
        }
    }
    if (options.input_path.empty() == !options.is_polling) return std::nullopt;  // exactly one
    return options;
}

std::expected<std::string, std::string> read_input(const std::string& path) {
    if (path != "-") {
        return read_text_file(path);
    }
    std::string text;
    std::array<char, 64 * 1024> buffer{};
    std::size_t count = 0;
    while ((count = std::fread(buffer.data(), 1, buffer.size(), stdin)) > 0) {
        text.append(buffer.data(), count);
    }
    if (std::ferror(stdin) != 0) {
        return std::unexpected(std::string{"cannot read stdin"});
    }
    return text;
}

// <base>/20261121T170000Z, with -2, -3, ... when two runs start in the same second.
std::expected<std::filesystem::path, std::string> create_run_dir(
    const std::filesystem::path& base) {
    const std::string stamp =
        std::format("{:%Y%m%dT%H%M%SZ}", std::chrono::floor<std::chrono::seconds>(SysClock::now()));
    std::error_code ec;
    std::filesystem::create_directories(base, ec);
    if (ec) {
        return std::unexpected(std::format("cannot create '{}': {}", base.string(), ec.message()));
    }
    for (int attempt = 1; attempt < 1000; ++attempt) {
        const auto dir = base / (attempt == 1 ? stamp : std::format("{}-{}", stamp, attempt));
        if (std::filesystem::create_directory(dir, ec)) {
            return dir;
        }
        if (ec) {
            return std::unexpected(
                std::format("cannot create '{}': {}", dir.string(), ec.message()));
        }
    }
    return std::unexpected(std::string{"cannot find a free run directory name"});
}

// Everything the manager knows about one entry of jobs[], valid or not.
struct JobRun {
    std::size_t index = 0;
    std::optional<Job> job;  // empty for an invalid entry
    std::string dir_name;
    std::optional<std::string> job_id;
    std::optional<std::string> error_code;
    std::optional<std::string> error_message;
    std::filesystem::path binary;
    Plan plan;
    std::vector<TaskOutcome> outcomes;
    std::vector<Json> schedule;  // per task: stage, footprint, the tasks it waited for
    std::vector<std::optional<UploadOutcome>> uploads;  // --poll, tasks with a result only
};

Json nullable(const std::optional<std::string>& value) {
    return value ? Json(*value) : Json(nullptr);
}

Json nullable_time(const std::optional<SysClock::time_point>& value) {
    return value ? Json(format_timestamp(*value)) : Json(nullptr);
}

std::int64_t count_field(const Json& counts, const char* key) {
    if (!counts.is_object()) return 0;
    const auto it = counts.find(key);
    return (it != counts.end() && it->is_number_integer()) ? it->get<std::int64_t>() : 0;
}

// A job's `rate` caps all its tasks together, and so does its worker's cap (what it can use
// at most); without either it takes whatever budget is free.
std::optional<std::uint64_t> task_rate_cap(const Json& params, const std::string& worker,
                                           std::span<const WorkerRateCap> worker_caps) {
    std::optional<std::uint64_t> cap;
    if (const auto rate = params.find("rate");
        rate != params.end() && rate->is_number_unsigned() && rate->get<std::uint64_t>() > 0) {
        cap = rate->get<std::uint64_t>();
    }
    for (const WorkerRateCap& worker_cap : worker_caps) {
        if (worker_cap.name == worker)
            cap = std::min(cap.value_or(worker_cap.rate), worker_cap.rate);
    }
    return cap;
}

std::string_view job_status(const JobRun& run) {
    if (run.error_code) return "failed";
    std::vector<std::string_view> statuses;
    for (const TaskOutcome& outcome : run.outcomes) statuses.push_back(to_string(outcome.status));
    return aggregate_status(statuses);
}

Json upload_summary(const std::optional<UploadOutcome>& upload) {
    if (!upload) return nullptr;
    return {
        {"status", to_string(upload->status)},
        {"attempts", upload->attempts},
        {"httpStatus", upload->http_status ? Json(*upload->http_status) : Json(nullptr)},
        {"resultId", nullable(upload->result_id)},
        {"duplicate", upload->is_duplicate},
        {"error", nullable(upload->error)},
    };
}

Json job_summary(const JobRun& run) {
    Json tasks = Json::array();
    std::map<std::string_view, std::int64_t> by_status{
        {"completed", 0}, {"partial", 0}, {"failed", 0}, {"cancelled", 0}};
    std::int64_t hosts_up = 0;
    std::int64_t open_ports = 0;
    std::int64_t uploaded = 0;
    std::int64_t not_uploaded = 0;
    std::optional<SysClock::time_point> started_at;
    std::optional<SysClock::time_point> finished_at;
    for (std::size_t i = 0; i < run.outcomes.size(); ++i) {
        const Task& task = run.plan.tasks[i];
        const TaskOutcome& outcome = run.outcomes[i];
        const std::string stem = task_file_stem(task.index);
        ++by_status[to_string(outcome.status)];
        hosts_up += count_field(outcome.counts, "up");
        open_ports += count_field(outcome.counts, "openPorts");
        if (outcome.started_at && (!started_at || *outcome.started_at < *started_at)) {
            started_at = outcome.started_at;
        }
        if (outcome.finished_at && (!finished_at || *outcome.finished_at > *finished_at)) {
            finished_at = outcome.finished_at;
        }
        if (const auto& upload = run.uploads[i]) {
            ++(upload->status == UploadStatus::kUploaded ? uploaded : not_uploaded);
        }
        const bool did_run = outcome.exit_code.has_value();
        Json duration = nullptr;
        if (outcome.started_at && outcome.finished_at) {
            duration = std::chrono::duration_cast<std::chrono::milliseconds>(*outcome.finished_at -
                                                                             *outcome.started_at)
                           .count();
        }
        tasks.push_back({
            {"taskId", task.task_id},
            {"index", task.index},
            {"status", to_string(outcome.status)},
            {"exitCode", outcome.exit_code ? Json(*outcome.exit_code) : Json(nullptr)},
            {"startedAt", nullable_time(outcome.started_at)},
            {"finishedAt", nullable_time(outcome.finished_at)},
            {"durationMs", duration},
            {"error", outcome.error_code ? Json{{"code", *outcome.error_code},
                                                {"message", outcome.error_message.value_or("")}}
                                         : Json(nullptr)},
            {"counts", outcome.counts},
            {"schedule", run.schedule[i]},
            {"upload", upload_summary(run.uploads[i])},
            {"files",
             {{"input", outcome.started_at ? Json(stem + ".input.json") : Json(nullptr)},
              {"result", outcome.has_result ? Json(stem + ".result.json") : Json(nullptr)},
              {"log", did_run ? Json(stem + ".log") : Json(nullptr)}}},
        });
    }
    Json job = nullptr;
    if (run.job) {
        job = {
            {"jobId", run.job->job_id},
            {"scanId", nullable(run.job->scan_id)},
            {"leaseId", nullable(run.job->lease_id)},
            {"worker", run.job->worker},
            {"deadline", nullable_time(run.job->deadline)},
            {"split",
             {{"requested", to_string(run.job->split.strategy)},
              {"applied", to_string(run.plan.strategy)},
              {"taskCount", run.plan.tasks.size()}}},
        };
    }
    return {
        {"index", run.index},
        {"jobId", nullable(run.job_id)},
        {"status", job_status(run)},
        {"error", run.error_code
                      ? Json{{"code", *run.error_code}, {"message", run.error_message.value_or("")}}
                      : Json(nullptr)},
        {"startedAt", nullable_time(started_at)},
        {"finishedAt", nullable_time(finished_at)},
        {"counts",
         {{"tasks", run.plan.tasks.size()},
          {"completed", by_status["completed"]},
          {"partial", by_status["partial"]},
          {"failed", by_status["failed"]},
          {"cancelled", by_status["cancelled"]},
          {"hostsUp", hosts_up},
          {"openPorts", open_ports},
          {"uploaded", uploaded},
          {"notUploaded", not_uploaded}}},
        {"warnings", run.plan.warnings},
        {"job", job},
        {"tasks", tasks},
    };
}

// SIGINT/SIGTERM are blocked everywhere and consumed here; SIGUSR1 ends the thread.
class SignalThread {
public:
    SignalThread(std::stop_source stop, std::stop_source force, const Logger& logger)
        : stop_{std::move(stop)}, force_{std::move(force)}, logger_{logger} {
        thread_ = std::jthread{[this] { run(); }};
    }
    SignalThread(const SignalThread&) = delete;
    SignalThread& operator=(const SignalThread&) = delete;
    ~SignalThread() noexcept { ::kill(::getpid(), SIGUSR1); }

    static void block_signals() noexcept {
        sigset_t set = signal_set();
        ::pthread_sigmask(SIG_BLOCK, &set, nullptr);
    }

private:
    static sigset_t signal_set() noexcept {
        sigset_t set{};
        sigemptyset(&set);
        sigaddset(&set, SIGINT);
        sigaddset(&set, SIGTERM);
        sigaddset(&set, SIGUSR1);
        return set;
    }

    void run() noexcept {
        const sigset_t set = signal_set();
        while (true) {
            int signal = 0;
            if (::sigwait(&set, &signal) != 0) continue;
            if (signal == SIGUSR1) return;
            if (!interrupted_.exchange(true)) {
                logger_.warn("run.stopping",
                             "stop requested: workers get SIGTERM and write partial results; "
                             "send it again to kill them",
                             {{"signal", signal}});
                stop_.request_stop();
            } else {
                logger_.error("run.killing", "second stop request: killing workers",
                              {{"signal", signal}});
                force_.request_stop();
            }
        }
    }

    std::stop_source stop_;
    std::stop_source force_;
    const Logger& logger_;
    std::atomic<bool> interrupted_{false};
    std::jthread thread_;  // last: joined before the members it uses are destroyed
};

using Binaries = std::map<std::string, std::filesystem::path>;

Binaries find_worker_binaries(const Config& config, const Logger& logger) {
    Binaries binaries;
    for (const WorkerBinary& worker : config.workers) {
        if (const auto path = find_executable(worker.binary)) {
            binaries.emplace(worker.name, *path);
            logger.debug("worker.found", "worker binary found",
                         {{"worker", worker.name}, {"binary", path->string()}});
        } else {
            logger.warn("worker.missing", "worker binary not found; its jobs will fail",
                        {{"worker", worker.name}, {"binary", worker.binary}});
        }
    }
    return binaries;
}

struct RunContext {
    const Config& config;
    const Binaries& binaries;
    std::stop_token stop;   // first SIGINT/SIGTERM
    std::stop_token force;  // second one
    const Logger& logger;
    ResultUploader* uploader = nullptr;  // --poll: every task result goes to the backend
};

// Plans every job of one list, runs its tasks and writes job.json and run.json into `run_dir`.
// Returns the --input exit code.
int run_job_list(JobList& job_list, const std::filesystem::path& run_dir, std::string_view input,
                 const RunContext& context) {
    const Config& config = context.config;
    const Binaries& binaries = context.binaries;
    const Logger& logger = context.logger;
    const auto run_started = SysClock::now();

    // Plan every job up front, so a bad job is reported without delaying the others.
    std::vector<JobRun> runs(job_list.jobs.size() + job_list.invalid.size());
    const PlanLimits limits{.max_tasks_per_job = config.max_tasks_per_job,
                            .max_parallel = config.max_parallel};
    for (Job& job : job_list.jobs) {
        JobRun& run = runs[job.index];
        run.index = job.index;
        run.job_id = job.job_id;
        run.dir_name = job.job_id;
        if (const auto binary = binaries.find(job.worker); binary == binaries.end()) {
            const bool is_known = std::ranges::any_of(
                config.workers, [&](const WorkerBinary& w) { return w.name == job.worker; });
            run.error_code = is_known ? "worker-unavailable" : "unsupported-worker";
            run.error_message =
                is_known ? std::format("the '{}' worker binary is not installed", job.worker)
                         : std::format("this manager has no '{}' worker", job.worker);
        } else if (auto plan = plan_job(job, limits, random_seed()); !plan) {
            run.error_code = "invalid-job";
            run.error_message = plan.error();
        } else {
            run.binary = binary->second;
            run.plan = std::move(*plan);
            run.outcomes.resize(run.plan.tasks.size());
            run.schedule.resize(run.plan.tasks.size());
            run.uploads.resize(run.plan.tasks.size());
        }
        run.job = std::move(job);
        if (run.error_code) {
            logger.error("job.rejected", *run.error_message,
                         {{"job_id", *run.job_id}, {"error", *run.error_code}});
        } else {
            logger.info("job.planned", "job split into tasks",
                        {{"job_id", *run.job_id},
                         {"worker", run.job->worker},
                         {"strategy", to_string(run.plan.strategy)},
                         {"tasks", run.plan.tasks.size()}});
            for (const std::string& warning : run.plan.warnings) {
                logger.warn("job.warning", warning, {{"job_id", *run.job_id}});
            }
        }
    }
    for (const InvalidJob& invalid : job_list.invalid) {
        JobRun& run = runs[invalid.index];
        run.index = invalid.index;
        run.job_id = invalid.job_id;
        run.dir_name = (invalid.job_id && is_safe_id(*invalid.job_id))
                           ? *invalid.job_id
                           : std::format("invalid-job-{}", invalid.index);
        run.error_code = "invalid-job";
        run.error_message = invalid.message;
        logger.error("job.rejected", invalid.message,
                     {{"index", invalid.index}, {"job_id", nullable(invalid.job_id)}});
    }
    // An invalid duplicate must not share (and overwrite) the valid job's directory.
    {
        std::map<std::string, int> seen;
        for (JobRun& run : runs) {
            if (++seen[run.dir_name] > 1) run.dir_name = std::format("invalid-job-{}", run.index);
        }
    }
    for (const JobRun& run : runs) {
        std::error_code ec;
        std::filesystem::create_directory(run_dir / run.dir_name, ec);
        if (ec) {
            logger.error("output.failed", "cannot create job directory",
                         {{"dir", (run_dir / run.dir_name).string()}, {"error", ec.message()}});
            return kExitInvalidInput;
        }
    }

    // The queue: backend order, then task order.
    struct TaskRef {
        std::size_t run_index;
        std::size_t task_index;
    };
    std::vector<TaskRef> refs;
    for (std::size_t r = 0; r < runs.size(); ++r) {
        for (std::size_t t = 0; t < runs[r].plan.tasks.size(); ++t) refs.push_back({r, t});
    }
    std::vector<ScheduledTask> scheduled;
    for (const TaskRef& ref : refs) {
        const JobRun& run = runs[ref.run_index];
        const Task& task = run.plan.tasks[ref.task_index];
        const auto stage = std::ranges::find(config.stages, run.job->worker);
        ScheduledTask entry{
            .task_id = task.task_id,
            .job = ref.run_index,
            .rate_cap = task_rate_cap(run.job->params, run.job->worker, config.worker_rate_caps),
            .stage = stage == config.stages.end()
                         ? std::nullopt
                         : std::optional{static_cast<std::size_t>(stage - config.stages.begin())},
            // Shards split masscan's probe space between them, so they never probe the same pair.
            .partition = run.plan.strategy == SplitStrategy::kShard && task.count > 1
                             ? std::optional{ref.run_index}
                             : std::nullopt,
            .footprint = footprint_of(task.input),
        };
        if (!entry.footprint.is_exact) {
            logger.warn("task.footprint",
                        "cannot tell which IPs and ports the task touches; it will run alone",
                        {{"task_id", task.task_id}});
        }
        scheduled.push_back(std::move(entry));
    }
    Scheduler scheduler{
        std::move(scheduled), {.total = config.max_rate, .min_task = config.min_task_rate}, logger};
    for (std::size_t id = 0; id < refs.size(); ++id) {
        JobRun& run = runs[refs[id].run_index];
        const ScheduledTask& entry = scheduler.task(id);
        Json after = Json::array();
        for (const std::size_t before : scheduler.predecessors(id)) {
            after.push_back(scheduler.task(before).task_id);
        }
        run.schedule[refs[id].task_index] = {
            {"stage", entry.stage ? Json(*entry.stage) : Json(nullptr)},
            {"footprint",
             {{"exact", entry.footprint.is_exact},
              {"addresses", entry.footprint.address_count()},
              {"areas", entry.footprint.areas.size()}}},
            {"after", std::move(after)},
            {"rate", nullptr},  // set when the task starts
        };
    }

    {
        std::vector<std::jthread> pool;
        const auto threads = std::min<std::size_t>(config.max_parallel, refs.size());
        for (std::size_t i = 0; i < threads; ++i) {
            pool.emplace_back([&] {
                while (const auto grant = scheduler.acquire(context.stop)) {
                    JobRun& run = runs[refs[grant->id].run_index];
                    const std::size_t index = refs[grant->id].task_index;
                    // Each task owns its element; no other thread touches it.
                    run.schedule[index]["rate"] = grant->rate;
                    run.outcomes[index] = run_task({.job = *run.job,
                                                    .task = run.plan.tasks[index],
                                                    .binary = run.binary,
                                                    .job_dir = run_dir / run.dir_name,
                                                    .deadline_margin = config.deadline_margin,
                                                    .kill_grace = config.kill_grace,
                                                    .rate = grant->rate,
                                                    .stop = context.stop,
                                                    .force = context.force},
                                                   logger);
                    scheduler.release(grant->id);
                    const Task& task = run.plan.tasks[index];
                    if (context.uploader != nullptr && run.outcomes[index].has_result) {
                        context.uploader->submit(
                            {.task_id = task.task_id,
                             .task_index = task.index,
                             .task_count = task.count,
                             .result_path = run_dir / run.dir_name /
                                            (task_file_stem(task.index) + ".result.json")},
                            run.uploads[index].emplace());
                    }
                }
            });
        }
    }
    // A job list is done once its results are with the backend (or given up on).
    if (context.uploader != nullptr) context.uploader->wait_idle();
    const bool was_interrupted = context.stop.stop_requested();

    Json jobs = Json::array();
    std::vector<std::string_view> statuses;
    std::int64_t hosts_up = 0;
    std::int64_t open_ports = 0;
    std::int64_t uploaded = 0;
    std::int64_t not_uploaded = 0;
    bool has_failed_job = false;
    for (const JobRun& run : runs) {
        const Json summary = job_summary(run);
        const auto job_dir = run_dir / run.dir_name;
        if (!write_json_file(job_dir / "job.json", summary)) {
            logger.error("output.failed", "cannot write job summary",
                         {{"path", (job_dir / "job.json").string()}});
        }
        const std::string_view status = job_status(run);
        statuses.push_back(status);
        has_failed_job = has_failed_job || status == "failed";
        hosts_up += summary["counts"]["hostsUp"].get<std::int64_t>();
        open_ports += summary["counts"]["openPorts"].get<std::int64_t>();
        uploaded += summary["counts"]["uploaded"].get<std::int64_t>();
        not_uploaded += summary["counts"]["notUploaded"].get<std::int64_t>();
        logger.log(status == "failed" ? LogLevel::kError : LogLevel::kInfo, "job.finished",
                   "job finished",
                   {{"job_id", nullable(run.job_id)},
                    {"status", status},
                    {"tasks", run.plan.tasks.size()},
                    {"hosts_up", summary["counts"]["hostsUp"]},
                    {"open_ports", summary["counts"]["openPorts"]},
                    {"dir", job_dir.string()}});
        jobs.push_back({{"jobId", nullable(run.job_id)},
                        {"worker", run.job ? Json(run.job->worker) : Json(nullptr)},
                        {"status", status},
                        {"dir", run.dir_name},
                        {"tasks", run.plan.tasks.size()},
                        {"hostsUp", summary["counts"]["hostsUp"]},
                        {"openPorts", summary["counts"]["openPorts"]},
                        {"error", summary["error"]}});
    }
    const auto run_finished = SysClock::now();
    const std::string_view run_status = aggregate_status(statuses);
    const Json run_summary{
        {"manager", {{"id", "worker-manager"}, {"version", WORKER_MANAGER_VERSION}}},
        {"runId", run_dir.filename().string()},
        {"input", input},
        {"status", run_status},
        {"stopReason", was_interrupted ? Json("stop-requested") : Json(nullptr)},
        {"startedAt", format_timestamp(run_started)},
        {"finishedAt", format_timestamp(run_finished)},
        {"durationMs",
         std::chrono::duration_cast<std::chrono::milliseconds>(run_finished - run_started).count()},
        {"counts",
         {{"jobs", runs.size()},
          {"tasks", refs.size()},
          {"hostsUp", hosts_up},
          {"openPorts", open_ports},
          {"uploaded", uploaded},
          {"notUploaded", not_uploaded}}},
        {"jobs", jobs},
    };
    if (!write_json_file(run_dir / "run.json", run_summary)) {
        logger.error("output.failed", "cannot write run summary",
                     {{"path", (run_dir / "run.json").string()}});
        return kExitJobFailed;
    }
    logger.info("run.finished", "run finished",
                {{"status", run_status},
                 {"jobs", runs.size()},
                 {"tasks", refs.size()},
                 {"hosts_up", hosts_up},
                 {"open_ports", open_ports},
                 {"output", run_dir.string()}});

    if (was_interrupted) return kExitInterrupted;
    return has_failed_job ? kExitJobFailed : kExitOk;
}

int run_file(const CliOptions& options, const Config& config, const Logger& logger) {
    logger.info("manager.start", "worker-manager starting",
                {{"version", WORKER_MANAGER_VERSION},
                 {"input", options.input_path == "-" ? "stdin" : options.input_path},
                 {"max_parallel", config.max_parallel},
                 {"max_rate_pps", config.max_rate}});

    const auto text = read_input(options.input_path);
    if (!text) {
        logger.error("input.invalid", text.error());
        return kExitInvalidInput;
    }
    const Json document = Json::parse(*text, nullptr, false);
    if (document.is_discarded()) {
        logger.error("input.invalid", "the input is not valid JSON");
        return kExitInvalidInput;
    }
    auto list = parse_job_list(document);
    if (!list) {
        logger.error("input.invalid", list.error());
        return kExitInvalidInput;
    }
    const auto run_dir = create_run_dir(options.output_dir);
    if (!run_dir) {
        logger.error("output.failed", run_dir.error());
        return kExitInvalidInput;
    }
    const Binaries binaries = find_worker_binaries(config, logger);

    // Blocked only now: until here SIGINT still ends a stalled read of stdin.
    SignalThread::block_signals();
    std::stop_source stop;
    std::stop_source force;
    const SignalThread signals{stop, force, logger};
    return run_job_list(*list, *run_dir, options.input_path,
                        {.config = config,
                         .binaries = binaries,
                         .stop = stop.get_token(),
                         .force = force.get_token(),
                         .logger = logger});
}

// Leases a job list, runs it to the end, leases the next one. Only an idle manager asks, so
// leased jobs never wait in a local queue while their lease runs out.
int run_poll(const CliOptions& options, const Config& config, const Logger& logger) {
    const BackendConfig& backend = config.backend;
    if (backend.token.empty()) {
        logger.error("config.invalid", "--poll needs WORKER_MANAGER_TOKEN (the backend's token)");
        return kExitInvalidInput;
    }
    const Binaries binaries = find_worker_binaries(config, logger);
    LeaseRequest request{.manager_id = backend.manager_id,
                         .workers = {},
                         .max_parallel = config.max_parallel,
                         .wait = backend.poll_wait};
    for (const WorkerBinary& worker : config.workers) {
        if (binaries.contains(worker.name)) request.workers.push_back(worker.name);
    }
    if (request.workers.empty()) {
        logger.error("config.invalid", "no worker binary is installed; nothing to ask jobs for");
        return kExitInvalidInput;
    }

    SignalThread::block_signals();  // before libcurl or any other thread starts
    const CurlGlobal curl;
    const BackendClient client{backend.url, backend.token};
    std::stop_source stop;
    std::stop_source force;
    const SignalThread signals{stop, force, logger};
    ResultUploader uploader{
        client,
        {.attempts = backend.upload_attempts, .retry_delay = backend.retry_delay},
        stop.get_token(),
        force.get_token(),
        logger};
    const RunContext context{.config = config,
                             .binaries = binaries,
                             .stop = stop.get_token(),
                             .force = force.get_token(),
                             .logger = logger,
                             .uploader = &uploader};
    logger.info("manager.start", "worker-manager polling the backend for jobs",
                {{"version", WORKER_MANAGER_VERSION},
                 {"backend", client.lease_url()},
                 {"manager_id", backend.manager_id},
                 {"workers", request.workers},
                 {"wait_s", backend.poll_wait.count()},
                 {"max_parallel", config.max_parallel},
                 {"max_rate_pps", config.max_rate}});

    using SteadyClock = std::chrono::steady_clock;
    std::uint32_t failures = 0;
    std::chrono::milliseconds delay{0};
    const auto fail = [&](std::string_view event, std::string_view message) {
        delay = retry_delay(backend.retry_delay, ++failures);
        logger.warn(event, message, {{"failures", failures}, {"retry_in_ms", delay.count()}});
    };
    while (sleep_unless_stopped(delay, context.stop)) {
        const auto asked_at = SteadyClock::now();
        auto lease = client.lease(request, context.stop);
        if (context.stop.stop_requested()) break;
        if (!lease) {
            fail("lease.failed", lease.error());
            continue;
        }
        if (!lease->job_list) {
            failures = 0;
            const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
                SteadyClock::now() - asked_at);
            delay = std::max<std::chrono::milliseconds>(lease->next_poll, kMinPollPeriod - elapsed);
            logger.debug("lease.empty", "no jobs", {{"next_poll_ms", delay.count()}});
            continue;
        }
        auto list = parse_job_list(*lease->job_list);
        if (!list) {
            fail("lease.invalid",
                 std::format("the backend sent an invalid job list: {}", list.error()));
            continue;
        }
        const auto run_dir = create_run_dir(options.output_dir);
        if (!run_dir) {
            fail("output.failed", run_dir.error());
            continue;
        }
        failures = 0;
        delay = lease->next_poll;
        constexpr std::string_view kLeaseFile = "lease.json";
        if (!write_json_file(*run_dir / kLeaseFile, *lease->job_list)) {
            logger.error("output.failed", "cannot write the job list",
                         {{"path", (*run_dir / kLeaseFile).string()}});
        }
        logger.info("lease.received", "job list received",
                    {{"jobs", list->jobs.size() + list->invalid.size()},
                     {"run_id", run_dir->filename().string()}});
        (void)run_job_list(*list, *run_dir, kLeaseFile, context);
    }
    logger.info("manager.stopped", "stop requested; worker-manager exiting");
    return kExitOk;
}

int run(const CliOptions& options) {
    Config config;
    try {
        config = read_config();
    } catch (const std::exception& error) {
        std::println(stderr, "worker-manager: {}", error.what());
        return kExitInvalidInput;
    }
    const Logger logger{config.log_level, config.log_format};
    return options.is_polling ? run_poll(options, config, logger)
                              : run_file(options, config, logger);
}

}  // namespace

}  // namespace worker_manager

int main(int argc, char** argv) {
    const std::span<char* const> args{argv, static_cast<std::size_t>(argc)};
    if (args.size() == 2 && std::string_view{args[1]} == "--version") {
        std::println("worker-manager {}", WORKER_MANAGER_VERSION);
        return EXIT_SUCCESS;
    }
    const auto options = worker_manager::parse_cli(args);
    if (!options) {
        std::print(stderr, "{}", worker_manager::kUsage);
        return worker_manager::kExitInvalidInput;
    }
    try {
        return worker_manager::run(*options);
    } catch (const std::exception& error) {
        std::println(stderr, "worker-manager: fatal: {}", error.what());
    } catch (...) {
        std::println(stderr, "worker-manager: fatal: unknown error");
    }
    return worker_manager::kExitJobFailed;
}
