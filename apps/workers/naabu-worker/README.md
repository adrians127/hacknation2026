# naabu-worker

Python 3 one-shot TCP discovery worker backed by [ProjectDiscovery Naabu](https://github.com/projectdiscovery/naabu). It uses the same job envelope and `{scan, hosts}` result as masscan-worker, so worker-manager can schedule it before nmap-worker.

## Run locally

From the repository root, with Python 3 and `naabu` in `PATH`:

```bash
python3 -m unittest discover -s apps/workers/naabu-worker/tests -v
apps/workers/naabu-worker/naabu-worker --input apps/workers/naabu-worker/examples/job-local.json --pretty
```

The tests use a fake Naabu binary and do not send network traffic. To use a different Naabu binary, set `NAABU_BINARY=/path/to/naabu`.

Docker commands:

```bash
pnpm workers:naabu:build
pnpm workers:naabu < apps/workers/naabu-worker/examples/job-local.json > result.json
pnpm workers:manager --input /jobs/naabu-nmap-local.json --output-dir /results
```

The standalone image build also runs the same local Python tests.

The last command runs an example Naabu discovery job followed by an overlapping Nmap service job. The manager schedules the Nmap task after Naabu. As with its Masscan examples, the manager currently requires the Nmap targets and ports in the job list; it does not generate Nmap inputs from discovery hits. Change the example to your authorized targets before a network scan.

The worker reads one job from stdin by default and writes one JSON result to stdout. `--input FILE` and `--output FILE` use files (`-` means stdin/stdout); output files are written atomically. `--job-file` aliases `--input`; `--pretty`, `--help`, and `--version` are also supported. Logs go to stderr. Exit status is 0 for `completed` or `partial`, 1 for scanner failure, and 2 for invalid input. Invalid input still produces a result.

## Input

Shared fields follow [the worker format](../README.md#job-and-result-format): `job_id`, `scan_id`, `lease_id`, `targets`, `exclude`, `ports`, `rate`, and `max_duration_seconds`. `targets` and `exclude` accept IPv4 addresses, CIDRs, and address ranges; ranges are reduced to CIDRs before passing them to Naabu. `ports` defaults to `1-65535`. Exclusions are subtracted before scanning. The worker discards scanner output outside the assigned addresses or ports.

| Field | Default | Meaning |
|---|---|---|
| `scan_type` | `connect` | `connect` or `syn` (`-scan-type c/s`). Connect scanning works without raw socket permissions |
| `retries` | `3` | Naabu port scan retries, 0–5 |
| `shard`, `seed` | none | `shard: {index, total}` with a shared positive seed; compatible with manager `split.strategy: shard` |
| `adapter` | auto | Network interface passed to Naabu `-interface` |
| `max_duration_seconds` | none | 1–604800; worker sends `SIGTERM` at the deadline, then `SIGKILL` after 5 seconds |

`resume_index` is rejected because Naabu does not use Masscan's resume index. Naabu's own `-resume` uses a local config file and is not exposed in this worker.

`NAABU_WORKER_DEFAULT_RATE` defaults to 1000 packets/s, `NAABU_WORKER_MAX_RATE` to 100000, and `NAABU_WORKER_MAX_TARGETS` to 16777216 addresses. A supplied rate above the maximum is clamped and logged. The manager supplies a rate per task. The worker passes that limit to Naabu's `-rate` and disables update checks and stdin input.

## Result

The result has exactly `scan` and `hosts`, with every field in [`docs/worker-result-format.md`](../../../docs/worker-result-format.md); see [the example result](examples/result.json). It uses `scan.worker.id: "naabu-worker"`; `scan.phasesMs.portScan` is the Naabu run. Only hosts with at least one open TCP port appear in `hosts[]`, like masscan-worker. Ports are deduplicated and sorted. Naabu does not provide service metadata, TTL, or latency in the basic JSON lines used here, so those fields are `null` or empty lists. `scan.counts.down` is known only for a completed, unsharded job.

The shared TypeScript schema accepts nullable limits and counts for discovery workers. For backend upload, `job_id` and `scan_id` must be UUIDs and `lease_id` must be present; the local examples without those identifiers are for file-based runs.
