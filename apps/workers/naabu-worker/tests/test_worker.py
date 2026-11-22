import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKER = ROOT / "naabu-worker"
FAKE = ROOT / "tests" / "fake_naabu.py"


class WorkerTest(unittest.TestCase):
    def run_worker(self, job, extra_env=None):
        env = dict(os.environ, NAABU_BINARY=str(FAKE))
        env.update(extra_env or {})
        completed = subprocess.run([sys.executable, str(WORKER)], input=json.dumps(job),
                                   text=True, capture_output=True, env=env, timeout=10)
        return completed, json.loads(completed.stdout)

    def test_result_and_naabu_arguments(self):
        with tempfile.TemporaryDirectory() as directory:
            capture = str(Path(directory) / "args.json")
            job = {"job_id": "local", "targets": ["127.0.0.0/30"],
                   "exclude": ["127.0.0.2"], "ports": [80, 443],
                   "rate": 250, "max_duration_seconds": 15}
            completed, result = self.run_worker(job, {"FAKE_NAABU_ARGS": capture})
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertEqual(set(result), {"scan", "hosts"})
            self.assertEqual(result["scan"]["worker"]["id"], "naabu-worker")
            self.assertEqual(result["scan"]["status"], "completed")
            self.assertEqual(result["scan"]["counts"]["addresses"], 3)
            self.assertEqual(result["scan"]["counts"]["openPorts"], 1)
            self.assertEqual(result["scan"]["counts"]["down"], 2)
            self.assertEqual(len(result["hosts"]), 1)
            self.assertEqual(result["hosts"][0]["ports"][0]["port"], 80)
            self.assertEqual(result["hosts"][0]["ports"][0]["identity"]["ttl"], None)
            args = json.loads(Path(capture).read_text())
            self.assertEqual(args[args.index("-p") + 1], "80,443")
            self.assertEqual(args[args.index("-rate") + 1], "250")
            self.assertIn("-json", args)
            self.assertIn("-no-stdin", args)

    def test_invalid_input_still_writes_result(self):
        completed, result = self.run_worker({"job_id": "bad-job", "scan_id": "scan-1",
                                             "lease_id": "lease-1", "targets": ["not-an-ip"]})
        self.assertEqual(completed.returncode, 2)
        self.assertEqual(result["scan"]["status"], "failed")
        self.assertEqual(result["scan"]["error"]["code"], "invalid-input")
        self.assertEqual(result["scan"]["jobId"], "bad-job")
        self.assertEqual(result["scan"]["scanId"], "scan-1")
        self.assertEqual(result["scan"]["leaseId"], "lease-1")
        self.assertEqual(result["hosts"], [])
        completed, result = self.run_worker({"targets": ["127.0.0.1"], "ports": []})
        self.assertEqual(completed.returncode, 2)
        self.assertEqual(result["scan"]["error"]["code"], "invalid-input")

    def test_shard_and_file_io(self):
        with tempfile.TemporaryDirectory() as directory:
            input_file = Path(directory) / "job.json"
            output_file = Path(directory) / "result.json"
            args_file = Path(directory) / "args.json"
            input_file.write_text(json.dumps({"targets": ["127.0.0.1"], "ports": [80],
                                              "shard": {"index": 1, "total": 2},
                                              "seed": 42}))
            env = dict(os.environ, NAABU_BINARY=str(FAKE), FAKE_NAABU_ARGS=str(args_file))
            completed = subprocess.run([sys.executable, str(WORKER), "--input", str(input_file),
                                        "--output", str(output_file)], capture_output=True,
                                       text=True, env=env, timeout=10)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertEqual(completed.stdout, "")
            self.assertIsNone(json.loads(output_file.read_text())["scan"]["counts"]["down"])
            args = json.loads(args_file.read_text())
            self.assertEqual(args[args.index("-shard") + 1], "1/2")
            self.assertEqual(args[args.index("-seed") + 1], "42")

    def test_scanner_failure_and_missing_binary(self):
        job = {"targets": ["127.0.0.1"], "ports": [80]}
        completed, result = self.run_worker(job, {"FAKE_NAABU_EXIT": "7"})
        self.assertEqual(completed.returncode, 1)
        self.assertEqual(result["scan"]["error"]["code"], "scanner-failed")
        completed, result = self.run_worker(job, {"NAABU_BINARY": "/missing/naabu"})
        self.assertEqual(completed.returncode, 1)
        self.assertEqual(result["scan"]["error"]["code"], "scanner-unavailable")

    def test_stop_signal_writes_partial_result_file(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "result.json"
            env = dict(os.environ, NAABU_BINARY=str(FAKE), FAKE_NAABU_WAIT="1")
            process = subprocess.Popen([sys.executable, str(WORKER), "--output", str(output)],
                                       stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                       stderr=subprocess.PIPE, text=True, env=env)
            process.stdin.write(json.dumps({"targets": ["127.0.0.1"], "ports": [80]}))
            process.stdin.close()
            time.sleep(0.4)
            process.send_signal(signal.SIGTERM)
            process.wait(timeout=10)
            process.stdout.close()
            process.stderr.close()
            self.assertEqual(process.returncode, 0)
            result = json.loads(output.read_text())
            self.assertEqual(result["scan"]["status"], "partial")
            self.assertEqual(result["scan"]["stopReason"], "stop-requested")
            self.assertEqual(result["scan"]["counts"]["openPorts"], 1)

    def test_deadline_writes_partial_result(self):
        completed, result = self.run_worker(
            {"targets": ["127.0.0.1"], "ports": [80], "max_duration_seconds": 1},
            {"FAKE_NAABU_WAIT": "1"})
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(result["scan"]["status"], "partial")
        self.assertEqual(result["scan"]["stopReason"], "deadline")
        self.assertEqual(result["scan"]["counts"]["openPorts"], 1)


if __name__ == "__main__":
    unittest.main()
