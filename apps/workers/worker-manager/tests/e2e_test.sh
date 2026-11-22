#!/bin/sh
# End to end: worker-manager drives tests/fake-worker.sh through a job list with every split
# strategy, an unsupported worker, an invalid job and a failing task.
# usage: e2e_test.sh <worker-manager binary> <fake-worker.sh>
set -eu
manager="$1"
fake_worker="$2"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
chmod +x "$fake_worker" 2>/dev/null || true
cp "$fake_worker" "$work/fake-worker"
chmod +x "$work/fake-worker"

cat > "$work/jobs.json" <<'EOF'
{
  "schema_version": 1,
  "jobs": [
    { "job_id": "shard-job", "worker": "fake",
      "split": { "strategy": "shard", "max_tasks": 3 },
      "params": { "targets": ["10.0.0.0/24"], "ports": [80], "rate": 3000 } },
    { "job_id": "ranges-job", "worker": "fake",
      "split": { "strategy": "ranges", "max_items_per_task": 100 },
      "params": { "targets": ["10.1.0.0/24"], "exclude": ["10.1.0.0/25"], "ports": "22" } },
    { "job_id": "chunk-job", "worker": "fake",
      "split": { "strategy": "chunk", "max_items_per_task": 2 },
      "params": { "targets": [{"ip":"10.2.0.1"},{"ip":"10.2.0.2"},{"ip":"10.2.0.3"}] } },
    { "job_id": "fail-job", "worker": "fake", "params": { "targets": ["fail-me"] } },
    { "job_id": "far-deadline", "worker": "fake", "deadline": "2099-01-01T00:00:00Z",
      "params": { "targets": ["10.3.0.1"] } },
    { "job_id": "nmap-job", "worker": "nmap", "params": {} },
    { "job_id": "../escape", "worker": "fake", "params": {} }
  ]
}
EOF

status=0
WORKER_MANAGER_WORKERS="fake=$work/fake-worker" WORKER_MANAGER_MAX_PARALLEL=2 \
    "$manager" --input "$work/jobs.json" --output-dir "$work/out" 2> "$work/manager.log" || status=$?

fail() { echo "FAIL: $*" >&2; cat "$work/manager.log" >&2; exit 1; }
[ "$status" -eq 1 ] || fail "expected exit code 1 (a job failed), got $status"

run_dir=$(find "$work/out" -mindepth 1 -maxdepth 1 -type d)
[ -f "$run_dir/run.json" ] || fail "no run.json"
expect() { grep -q -- "$2" "$run_dir/$1" || fail "$1 does not contain $2"; }

expect run.json '"status": "partial"'
expect shard-job/job.json '"applied": "shard"'
expect shard-job/job.json '"completed": 3'
expect shard-job/task-003.result.json '"total": 3'
expect shard-job/task-001.input.json '"rate": 3000'
expect shard-job/task-001.input.json '"task_id": "shard-job/1"'
expect ranges-job/job.json '"taskCount": 2'
expect ranges-job/task-001.input.json '"10.1.0.128/26"'
expect ranges-job/task-002.input.json '"10.1.0.192/26"'
expect chunk-job/job.json '"taskCount": 2'
expect chunk-job/task-002.input.json '"10.2.0.3"'
expect fail-job/job.json '"code": "scanner-failed"'
expect far-deadline/task-001.input.json '"max_duration_seconds": 604800'  # 7 days, what workers accept
expect nmap-job/job.json '"code": "unsupported-worker"'
expect invalid-job-6/job.json '"code": "invalid-job"'
[ -s "$run_dir/shard-job/task-001.log" ] || fail "empty worker log"
grep -q '\[shard-job/1\] fake-worker: started' "$work/manager.log" || fail "worker output not forwarded"
[ ! -e "$work/escape" ] || fail "job_id escaped the run directory"

# Scheduling: tasks sharing an IP:port never overlap in time, disjoint ones do, and a later stage
# waits for the earlier stage on the same IP:ports even when it is first in the queue.
cat > "$work/schedule.json" <<'EOF'
{
  "jobs": [
    { "job_id": "svc", "worker": "svc",
      "params": { "targets": [{"ip": "10.0.0.5", "tcp_ports": [80]}] } },
    { "job_id": "a", "worker": "disc",
      "params": { "targets": ["10.0.0.0/24"], "ports": "80", "rate": 1000, "fake_sleep": 1 } },
    { "job_id": "b", "worker": "disc",
      "params": { "targets": ["10.0.0.0/25"], "ports": "80,443", "rate": 1000, "fake_sleep": 1 } },
    { "job_id": "c", "worker": "disc",
      "params": { "targets": ["10.9.0.0/24"], "ports": "80", "rate": 1000, "fake_sleep": 1 } },
    { "job_id": "e", "worker": "disc",
      "params": { "targets": ["10.0.0.0/24"], "ports": "22", "rate": 1000, "fake_sleep": 1 } }
  ]
}
EOF
timeline="$work/timeline"
: > "$timeline"
FAKE_WORKER_TIMELINE="$timeline" WORKER_MANAGER_WORKERS="disc=$work/fake-worker,svc=$work/fake-worker" \
    WORKER_MANAGER_STAGES="disc,svc" WORKER_MANAGER_MAX_PARALLEL=3 \
    "$manager" --input "$work/schedule.json" --output-dir "$work/out2" 2> "$work/manager.log" \
    || fail "scheduling run failed"

line() { grep -n "^$1\$" "$timeline" | cut -d: -f1; }
before() {
    [ "$(line "$1")" -lt "$(line "$2")" ] || { cat "$timeline" >&2; fail "expected '$1' before '$2'"; }
}
before "end a/1" "start b/1"    # same IPs and port 80: one after the other
before "start c/1" "end a/1"    # other IPs: in parallel
before "start e/1" "end a/1"    # same IPs, other port: in parallel
before "end a/1" "start svc/1"  # the later stage waits for both overlapping discovery tasks
before "end b/1" "start svc/1"
grep -q '"after"' "$work"/out2/*/svc/job.json || fail "no schedule in job.json"
grep -q 'task held back' "$work/manager.log" || fail "held-back tasks are not logged"

# Rate budget 1000 pps, handed out in queue order: x (no rate) takes it all, y and z wait for it,
# then share it.
cat > "$work/rate.json" <<'EOF'
{
  "jobs": [
    { "job_id": "x", "worker": "disc", "params": { "targets": ["10.1.0.0/24"], "fake_sleep": 1 } },
    { "job_id": "y", "worker": "disc",
      "params": { "targets": ["10.2.0.0/24"], "rate": 400, "fake_sleep": 1 } },
    { "job_id": "z", "worker": "disc",
      "params": { "targets": ["10.3.0.0/24"], "rate": 300, "fake_sleep": 1 } }
  ]
}
EOF
: > "$timeline"
FAKE_WORKER_TIMELINE="$timeline" WORKER_MANAGER_WORKERS="disc=$work/fake-worker" \
    WORKER_MANAGER_MAX_RATE=1000 WORKER_MANAGER_MIN_TASK_RATE=100 WORKER_MANAGER_MAX_PARALLEL=3 \
    "$manager" --input "$work/rate.json" --output-dir "$work/out3" 2> "$work/manager.log" \
    || fail "rate run failed"
before "end x/1" "start y/1"
before "end x/1" "start z/1"
before "start z/1" "end y/1"    # y and z share the freed budget
grep -q '"rate": 1000' "$work"/out3/*/x/task-001.input.json || fail "x did not get the whole budget"
grep -q '"rate": 400' "$work"/out3/*/y/task-001.input.json || fail "y did not get its own rate"
grep -q '"rate": 300' "$work"/out3/*/z/task-001.input.json || fail "z did not get its own rate"
echo "e2e ok"
