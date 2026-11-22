"""Exercise the complete one-shot worker with a real Nmap process and a local service."""

import errno
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import unittest


WORKER = Path(sys.argv[1]).resolve()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"nmap-worker smoke test")

    def do_HEAD(self):
        self.send_response(200)
        self.end_headers()

    def log_message(self, *_args):
        pass


class QuietServer(ThreadingHTTPServer):
    daemon_threads = True
    block_on_close = False

    def handle_error(self, *_args):
        # Nmap sends non-HTTP probes and closes test connections aggressively.
        pass


class SmokeTest(unittest.TestCase):
    def test_real_nmap_reports_local_open_port(self):
        server = None
        for candidate in (8080, 8000, 8888, 8008, 9000, 0):
            try:
                server = QuietServer(("127.0.0.1", candidate), Handler)
                break
            except OSError as error:
                if error.errno != errno.EADDRINUSE:
                    raise
        self.assertIsNotNone(server)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)

        port = server.server_address[1]
        job = {
            "job_id": "0193a1aa-6c1e-7b3f-9d2a-4e5f60718293",
            "lease_id": "smoke-lease",
            "scan_id": "0193a0f2-1b2c-7d3e-8f40-516273849506",
            "targets": ["127.0.0.1"],
            "ports": [port],
            "max_duration_seconds": 90,
            "max_parallel": 1,
            "host_timeout_ms": 60000,
        }
        env = os.environ.copy()
        env["NMAP_SCAN_TYPE"] = "connect"
        process = subprocess.run(
            [str(WORKER)],
            input=json.dumps(job),
            text=True,
            capture_output=True,
            timeout=75,
            env=env,
        )
        self.assertEqual(process.returncode, 0, process.stderr + process.stdout)
        result = json.loads(process.stdout)
        self.assertEqual(result["scan"]["status"], "completed", result)
        self.assertEqual(result["scan"]["counts"]["openPorts"], 1)
        self.assertEqual(result["scan"]["counts"]["up"], 1)
        self.assertEqual(result["scan"]["params"]["ports"], str(port))
        self.assertEqual(result["hosts"][0]["status"], "up")
        self.assertEqual([entry["port"] for entry in result["hosts"][0]["ports"]], [port])
        self.assertEqual(result["hosts"][0]["ports"][0]["state"], "open")
        self.assertIsNotNone(result["scan"]["worker"]["nmapVersion"])


if __name__ == "__main__":
    sys.argv = [sys.argv[0]]
    unittest.main()
