#!/usr/bin/env python3
"""A stand-in backend for poll_test.sh, on 127.0.0.1.

usage: fake-backend.py PORT_FILE JOB_LIST_FILE LEASE_LOG RESULT_LOG

- writes the port it listens on to PORT_FILE;
- a request without "Authorization: Bearer test-token" gets 401;
- POST /v1/workers/manager/lease: appends the body to LEASE_LOG (one JSON per line). The 1st
  request gets 500 (the manager must retry), the 2nd the job list, later ones are held for
  wait_seconds and then get 204 (the manager must be able to stop mid-poll);
- POST /v1/workers/manager/results: appends the body to RESULT_LOG. The 1st upload gets 503
  (the manager must retry), one containing "reject-me" gets 400 like the real backend's
  validation, the others 200 with a result id.
"""

import json
import os
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

port_file, job_list_file, lease_log, result_log = sys.argv[1:5]
lock = threading.Lock()
counts = {"lease": 0, "results": 0}


def record(kind, log_path, body):
    with lock:
        counts[kind] += 1
        with open(log_path, "a", encoding="utf-8") as log:
            log.write(body.decode("utf-8") + "\n")
        return counts[kind]


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status, document):
        payload = json.dumps(document).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        if self.headers.get("Authorization") != "Bearer test-token":
            self.send_error(401)
        elif self.path == "/v1/workers/manager/lease":
            self.lease(body)
        elif self.path == "/v1/workers/manager/results":
            self.results(body)
        else:
            self.send_error(404)

    def lease(self, body):
        number = record("lease", lease_log, body)
        if number == 1:
            self.send_error(500)
        elif number == 2:
            with open(job_list_file, "rb") as file:
                payload = file.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        else:
            time.sleep(json.loads(body)["wait_seconds"])
            self.send_response(204)
            self.end_headers()

    def results(self, body):
        number = record("results", result_log, body)
        if number == 1:
            self.send_error(503)
        elif b"reject-me" in body:
            message = "Addresses outside the job: 10.9.9.9"
            self.send_json(400, {"error": {"message": message, "status": 400}})
        else:
            self.send_json(200, {"status": "ingested", "resultId": str(uuid.uuid4())})

    def log_message(self, *args):
        pass


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
server.daemon_threads = True
with open(port_file + ".tmp", "w", encoding="utf-8") as file:
    file.write(str(server.server_address[1]))
os.replace(port_file + ".tmp", port_file)
server.serve_forever()
