import json
import os
from pathlib import Path
import signal
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKER = ROOT / "tlsx-worker"
FAKE = ROOT / "tests" / "fake_tlsx.py"


class WorkerTest(unittest.TestCase):
    def job(self, **kwargs):
        return {"job_id": "job", "scan_id": "scan", "lease_id": "lease",
                "targets": [{"ip": "127.0.0.1", "ports": [443], "domains": ["local.test"]}],
                "ports": [443], "rate": 100, "max_duration_seconds": 10, **kwargs}

    def run_worker(self, job, env=None, args=()):
        with tempfile.TemporaryDirectory() as directory:
            vars = dict(os.environ, TLSX_BINARY=str(FAKE), FAKE_TLSX_ARGS=str(Path(directory) / "args"))
            vars.update(env or {})
            completed = subprocess.run([sys.executable, str(WORKER), *args], input=json.dumps(job),
                                       text=True, capture_output=True, env=vars, timeout=20)
            result = json.loads(completed.stdout) if completed.stdout else None
            calls = [json.loads(line) for line in Path(vars["FAKE_TLSX_ARGS"]).read_text().splitlines()] if Path(vars["FAKE_TLSX_ARGS"]).exists() else []
            return completed, result, calls

    def test_tls_only_and_scope(self):
        completed, result, calls = self.run_worker(self.job())
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(set(result), {"scan", "hosts"})
        self.assertEqual(result["scan"]["counts"]["httpRequests"], 0)
        self.assertEqual(result["scan"]["counts"]["httpEndpoints"], 0)
        self.assertEqual(result["scan"]["counts"]["openPorts"], 1)
        port = result["hosts"][0]["ports"][0]
        self.assertEqual(port["http"], [])
        self.assertEqual(len(port["tls"]), 2)
        self.assertEqual({row["vhost"] for row in port["tls"]}, {None, "local.test"})
        self.assertEqual(port["identity"]["tlsCertSha256"], "a" * 64)
        self.assertEqual(port["tls"][0]["cert"]["san"], ["extra.test", "local.test"])
        self.assertEqual(len(calls), 2)
        self.assertTrue(all(call[call.index("-u") + 1] == "127.0.0.1:443" for call in calls))
        self.assertTrue(all("-json" in call and "-hash" in call for call in calls))
        self.assertEqual(result["hosts"][0]["hostnames"][-1]["source"], "tls-san")

    def test_exclusion_and_plain_address(self):
        job = self.job()
        job["targets"] = ["127.0.0.0/30"]
        job["exclude"] = ["127.0.0.2"]
        completed, result, calls = self.run_worker(job)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual([host["ip"] for host in result["hosts"]], ["127.0.0.0", "127.0.0.1", "127.0.0.3"])
        self.assertEqual(len(calls), 3)
        self.assertTrue(all(host["ports"][0]["http"] == [] for host in result["hosts"]))
        job["exclude"] = ["127.0.0.0/8"]
        completed, result, _ = self.run_worker(job)
        self.assertEqual(completed.returncode, 2)
        self.assertEqual(result["scan"]["error"]["code"], "invalid-input")

    def test_invalid_and_atomic_file(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "result.json"
            bad = self.job()
            bad["targets"] = [{"ip": "127.0.0.1", "ports": [0]}]
            completed = subprocess.run([sys.executable, str(WORKER), "--output", str(output)],
                                       input=json.dumps(bad), text=True, capture_output=True)
            self.assertEqual(completed.returncode, 2)
            result = json.loads(output.read_text())
            self.assertEqual(result["scan"]["error"]["code"], "invalid-input")
            self.assertEqual(result["scan"]["jobId"], "job")
            self.assertEqual(result["hosts"], [])
            self.assertEqual(list(Path(directory).iterdir()), [output])

    def test_deadline_and_sigterm(self):
        job = self.job()
        job["max_duration_seconds"] = 1
        completed, result, _ = self.run_worker(job, {"FAKE_TLSX_WAIT": "3"})
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(result["scan"]["stopReason"], "deadline")
        self.assertEqual(result["scan"]["status"], "partial")
        with tempfile.TemporaryDirectory() as directory:
            env = dict(os.environ, TLSX_BINARY=str(FAKE), FAKE_TLSX_ARGS=str(Path(directory) / "args"), FAKE_TLSX_WAIT="3")
            process = subprocess.Popen([sys.executable, str(WORKER), "--output", str(Path(directory) / "result")],
                                       stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                       text=True, env=env)
            process.stdin.write(json.dumps(job))
            process.stdin.close()
            time.sleep(0.3)
            process.send_signal(signal.SIGTERM)
            process.wait(timeout=8)
            self.assertEqual(json.loads((Path(directory) / "result").read_text())["scan"]["stopReason"], "stop-requested")
            process.stdout.close()
            process.stderr.close()

    def test_scanner_failure(self):
        completed, result, _ = self.run_worker(self.job(), {"FAKE_TLSX_EXIT": "7"})
        self.assertEqual(completed.returncode, 1)
        self.assertEqual(result["scan"]["error"]["code"], "scanner-failed")

    @unittest.skipUnless(os.environ.get("TLSX_REAL_BINARY"), "set TLSX_REAL_BINARY for local TLS handshake")
    def test_real_local_tls_server(self):
        with tempfile.TemporaryDirectory() as directory:
            cert = Path(directory) / "cert.pem"
            key = Path(directory) / "key.pem"
            subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                            "-subj", "/CN=local.test", "-addext", "subjectAltName=DNS:local.test",
                            "-keyout", str(key), "-out", str(cert)], check=True, capture_output=True)
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(cert, key)
            listener = socket.socket()
            listener.bind(("127.0.0.1", 0))
            listener.listen(8)
            listener.settimeout(0.2)
            port = listener.getsockname()[1]
            stop = threading.Event()
            def serve():
                while not stop.is_set():
                    try:
                        conn, _ = listener.accept()
                    except socket.timeout:
                        continue
                    try:
                        with context.wrap_socket(conn, server_side=True):
                            pass
                    except (ssl.SSLError, OSError):
                        pass
            thread = threading.Thread(target=serve)
            thread.start()
            try:
                job = self.job()
                job["targets"] = [{"ip": "127.0.0.1", "ports": [port], "domains": ["local.test"]}]
                job["ports"] = [port]
                completed, result, _ = self.run_worker(job, {
                    "TLSX_BINARY": os.environ["TLSX_REAL_BINARY"],
                    "HOME": str(Path(directory) / "missing-home"),
                })
                self.assertEqual(completed.returncode, 0, f"{completed.stderr}\n{result}")
                tls = result["hosts"][0]["ports"][0]["tls"]
                self.assertTrue(any(item["cert"] and item["cert"]["sha256"] for item in tls), result)
                self.assertTrue(any("local.test" in item["cert"]["san"] for item in tls if item["cert"]))
                self.assertEqual(result["hosts"][0]["ports"][0]["http"], [])
            finally:
                stop.set()
                thread.join(timeout=3)
                listener.close()


if __name__ == "__main__":
    unittest.main()
