#!/bin/sh
# End to end for --poll against tests/fake-backend.py: worker-manager retries a failed lease,
# runs the job list it gets with tests/fake-worker.sh, uploads every task's result (retrying a
# 503, giving up on a 400), asks again only then, and a SIGTERM ends the held request at once.
# usage: poll_test.sh <worker-manager binary> <fake-worker.sh> <fake-backend.py> <python3>
set -eu
manager="$1"
fake_worker="$2"
fake_backend="$3"
python="$4"
work=$(mktemp -d)
backend_pid=""
manager_pid=""
cleanup() {
    if [ -n "$manager_pid" ]; then kill -KILL "$manager_pid" 2>/dev/null || true; fi
    if [ -n "$backend_pid" ]; then kill "$backend_pid" 2>/dev/null || true; fi
    rm -rf "$work"
}
trap cleanup EXIT
cp "$fake_worker" "$work/fake-worker"
chmod +x "$work/fake-worker"
touch "$work/manager.log" "$work/leases.log" "$work/results.log"

fail() { echo "FAIL: $*" >&2; cat "$work/manager.log" >&2; exit 1; }
# wait_for <tries, 0.1 s apart> <shell condition>
wait_for() {
    tries=$1
    shift
    while ! eval "$@"; do
        tries=$((tries - 1))
        [ "$tries" -gt 0 ] || return 1
        sleep 0.1
    done
}

status=0
WORKER_MANAGER_WORKERS="fake=$work/fake-worker" WORKER_MANAGER_TOKEN="" \
    "$manager" --poll --output-dir "$work/out" 2> "$work/manager.log" || status=$?
[ "$status" -eq 2 ] || fail "expected exit code 2 without a token, got $status"
grep -q 'WORKER_MANAGER_TOKEN' "$work/manager.log" || fail "the missing token is not reported"

cat > "$work/jobs.json" <<'EOF'
{
  "schema_version": 1,
  "server_time": "2026-11-22T10:00:00Z",
  "next_poll_ms": 0,
  "jobs": [
    { "job_id": "poll-job", "scan_id": "0193a0f2-1b2c-7d3e-8f40-516273849506",
      "lease_id": "lease-1", "worker": "fake",
      "split": { "strategy": "ranges", "max_items_per_task": 128 },
      "params": { "targets": ["10.4.0.0/24"], "ports": "80" } },
    { "job_id": "reject-job", "scan_id": "0193a0f2-1b2c-7d3e-8f40-516273849506",
      "lease_id": "lease-2", "worker": "fake",
      "params": { "targets": ["10.5.0.1"], "ports": "80", "note": "reject-me" } }
  ]
}
EOF

"$python" "$fake_backend" "$work/port" "$work/jobs.json" "$work/leases.log" "$work/results.log" &
backend_pid=$!
wait_for 50 '[ -s "$work/port" ]' || fail "the fake backend did not start"
port=$(cat "$work/port")

WORKER_MANAGER_WORKERS="fake=$work/fake-worker" WORKER_MANAGER_TOKEN=test-token \
    WORKER_MANAGER_BACKEND_URL="http://127.0.0.1:$port/v1/" WORKER_MANAGER_ID=test-manager \
    WORKER_MANAGER_POLL_WAIT=30 WORKER_MANAGER_RETRY_DELAY=1 \
    "$manager" --poll --output-dir "$work/out" 2> "$work/manager.log" &
manager_pid=$!

# Lease 1 gets a 500 (retried after 1 s), 2 the job list. Lease 3 goes out only once the job
# list has run and its uploads are done.
wait_for 300 '[ "$(wc -l < "$work/leases.log")" -ge 3 ]' \
    || fail "the manager did not ask for more work after running the job list"

run_dirs=$(find "$work/out" -mindepth 1 -maxdepth 1 -type d)
[ "$(printf '%s\n' "$run_dirs" | wc -l)" -eq 1 ] || fail "expected one run directory: $run_dirs"
run_dir="$run_dirs"
expect() { grep -q -- "$2" "$run_dir/$1" || fail "$1 does not contain $2"; }
expect run.json '"status": "completed"'
expect run.json '"input": "lease.json"'
expect run.json '"uploaded": 2'
expect run.json '"notUploaded": 1'
expect lease.json '"lease_id": "lease-1"'
expect poll-job/job.json '"taskCount": 2'
expect poll-job/task-002.input.json '"lease_id": "lease-1"'
expect poll-job/task-002.result.json '"status":"completed"'
grep -q 'unexpected HTTP status 500' "$work/manager.log" || fail "the failed lease is not logged"
first_lease=$(head -n 1 "$work/leases.log")
for field in '"manager_id":"test-manager"' '"workers":["fake"]' '"wait_seconds":30'; do
    case "$first_lease" in
        *"$field"*) ;;
        *) fail "the lease request lacks $field: $first_lease" ;;
    esac
done

# Uploads: 3 task results, the first attempt got a 503 and was retried, so 4 requests.
[ "$(wc -l < "$work/results.log")" -eq 4 ] || fail "expected 4 upload requests: $(cat "$work/results.log")"
for envelope in '"task_index":1,"task_count":2,"result":{"scan"' \
    '"task_index":2,"task_count":2,"result":{"scan"' '"task_index":1,"task_count":1,"result":{"scan"'; do
    grep -qF "$envelope" "$work/results.log" || fail "no upload starts with $envelope"
done
[ "$(grep -c '"status": "uploaded"' "$run_dir/poll-job/job.json")" -eq 2 ] \
    || fail "poll-job does not have two uploaded tasks"
expect poll-job/job.json '"resultId": "'
expect reject-job/job.json '"status": "rejected"'
expect reject-job/job.json 'HTTP 400: Addresses outside the job: 10.9.9.9'
grep -q 'result uploaded' "$work/manager.log" || fail "no upload is logged"
grep -q 'HTTP 503' "$work/manager.log" || fail "the retried upload is not logged"

# The backend now holds lease 3 for 30 s; SIGTERM must not wait for it.
started=$(date +%s)
kill -TERM "$manager_pid"
(sleep 10 && kill -KILL "$manager_pid") > /dev/null 2>&1 &
status=0
wait "$manager_pid" || status=$?
manager_pid=""
elapsed=$(($(date +%s) - started))
[ "$elapsed" -le 5 ] || fail "the manager took ${elapsed}s to stop during a long poll"
[ "$status" -eq 0 ] || fail "expected exit code 0 after SIGTERM, got $status"
grep -q 'worker-manager exiting' "$work/manager.log" || fail "no shutdown line in the log"
echo "poll e2e ok"
