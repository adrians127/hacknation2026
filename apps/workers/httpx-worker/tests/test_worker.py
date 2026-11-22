#!/usr/bin/env python3
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time


worker = Path(sys.argv[1])
fake = Path(__file__).with_name("fake_httpx.py")
env = dict(os.environ, HTTPX_BINARY=str(fake))
job = {
    "job_id": "0193a1ad-3333-7000-8000-000000000003",
    "scan_id": "0193a0f2-1b2c-7d3e-8f40-516273849506",
    "lease_id": "lease-httpx-1",
    "targets": [
        {"ip": "127.0.0.1", "ports": [8080], "domains": ["app.example.test"]},
        "127.0.0.2",
    ],
    "ports": [8080],
    "probe_paths": ["/admin"],
    "rate": 10,
    "max_duration_seconds": 30,
}
completed = subprocess.run([str(worker)], input=json.dumps(job), text=True,
                           capture_output=True, env=env, check=False)
assert completed.returncode == 0, completed.stderr
assert "very-secret" not in completed.stdout
result = json.loads(completed.stdout)
assert set(result) == {"scan", "hosts"}
assert result["scan"]["status"] == "completed"
assert result["scan"]["worker"]["id"] == "httpx-worker"
assert result["scan"]["params"]["maxRatePerProcess"] == 10
assert result["scan"]["counts"]["httpEndpoints"] == 2
assert result["scan"]["counts"]["httpRequests"] == 12
assert result["hosts"][0]["status"] == "up"
assert result["hosts"][1]["status"] == "down"
port = result["hosts"][0]["ports"][0]
assert port["port"] == 8080 and port["state"] == "open"
assert len(port["http"]) == 2
assert {entry["vhost"] for entry in port["http"]} == {None, "app.example.test"}
for endpoint in port["http"]:
    assert endpoint["statusCode"] == 200
    assert endpoint["body"]["sha256"] == hashlib.sha256(b"<title>App</title>").hexdigest()
    assert endpoint["cookies"][0]["valueSha256"] == hashlib.sha256(b"very-secret").hexdigest()
    assert endpoint["headers"] == [{"name": "content-type", "value": "text/html"}]
    assert endpoint["probes"][0]["path"] == "/admin"
    if endpoint["vhost"] is None:
        assert endpoint["probes"][0]["statusCode"] == 302
    else:
        assert endpoint["probes"][0]["statusCode"] == 404

bad = subprocess.run([str(worker)], input='{"targets": []}', text=True,
                     capture_output=True, env=env, check=False)
assert bad.returncode == 2
failed = json.loads(bad.stdout)
assert failed["scan"]["error"]["code"] == "invalid-input"
assert failed["hosts"] == []

missing = subprocess.run([str(worker)], input=json.dumps(job), text=True,
                         capture_output=True,
                         env=dict(env, HTTPX_BINARY="/no/such/httpx"), check=False)
assert missing.returncode == 1
assert json.loads(missing.stdout)["scan"]["error"]["code"] == "scanner-unavailable"

slow = subprocess.Popen([str(worker)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE, text=True,
                        env=dict(env, FAKE_HTTPX_SLEEP="3"))
assert slow.stdin is not None
slow.stdin.write(json.dumps(job))
slow.stdin.close()
time.sleep(0.2)
slow.send_signal(signal.SIGTERM)
slow.wait(timeout=5)
assert slow.returncode == 0
assert slow.stdout is not None
partial = json.loads(slow.stdout.read())
assert partial["scan"]["status"] == "partial"
assert partial["scan"]["stopReason"] == "stop-requested"
assert partial["hosts"][1]["status"] == "cancelled"
