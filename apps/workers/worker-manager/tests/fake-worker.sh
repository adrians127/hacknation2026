#!/bin/sh
# A stand-in worker for the e2e test, following the shared contract:
#   fake-worker --input FILE --output FILE ; logs on stderr ; a result JSON in every case.
# It echoes its input into the result, so the test can check what the manager sent.
# A task whose input contains "fail-me" fails; one with "no-result" writes nothing.
# "fake_sleep": N makes it take N seconds; with FAKE_WORKER_TIMELINE set it appends
# "start <task_id>" / "end <task_id>" to that file, so the test can see what overlapped.
set -eu
input=""
output=""
while [ $# -gt 0 ]; do
    case "$1" in
        --input) input="$2"; shift 2 ;;
        --output) output="$2"; shift 2 ;;
        *) echo "fake-worker: unknown argument $1" >&2; exit 2 ;;
    esac
done
echo "fake-worker: started input=$input" >&2
body=$(cat "$input")
task_id=$(printf '%s' "$body" | sed -n 's/.*"task_id": *"\([^"]*\)".*/\1/p' | head -n 1)
delay=$(printf '%s' "$body" | sed -n 's/.*"fake_sleep": *\([0-9.]*\).*/\1/p' | head -n 1)
timeline=${FAKE_WORKER_TIMELINE:-}
if [ -n "$timeline" ]; then echo "start $task_id" >> "$timeline"; fi
if [ -n "$delay" ]; then sleep "$delay"; fi
if [ -n "$timeline" ]; then echo "end $task_id" >> "$timeline"; fi
case "$body" in
    *no-result*) echo "fake-worker: exiting without a result" >&2; exit 1 ;;
    *fail-me*) status=failed; error='{"code":"scanner-failed","message":"asked to fail"}'; code=1 ;;
    *) status=completed; error=null; code=0 ;;
esac
printf '{"scan":{"status":"%s","error":%s,"counts":{"up":1,"openPorts":2}},"hosts":[],"input":%s}\n' \
    "$status" "$error" "$body" > "$output"
echo "fake-worker: finished status=$status" >&2
exit $code
