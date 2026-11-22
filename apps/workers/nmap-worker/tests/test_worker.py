import json
import os
import signal
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import time
import unittest


WORKER = Path(sys.argv[1]).resolve()

FAKE_NMAP = textwrap.dedent("""\
    #!/usr/bin/env python3
    import os
    from pathlib import Path
    import sys
    import time

    args = sys.argv[1:]
    target = args[-1]
    output = Path(args[args.index('-oX') + 1])
    ports = [spec.split('-')[0] for spec in args[args.index('-p') + 1].split(',')]
    log = os.environ.get('FAKE_NMAP_LOG')
    if log:
        with open(log, 'a') as stream:
            stream.write(f'{target} {time.monotonic()}\\n')
    time.sleep(int(os.environ.get('FAKE_NMAP_SLEEP_MS', '0')) / 1000)
    if os.environ.get('FAKE_NMAP_INVALID_XML'):
        output.write_text('<broken>')
    else:
        down = target == os.environ.get('FAKE_NMAP_DOWN_IP')
        filtered = target == os.environ.get('FAKE_NMAP_FILTERED_IP')
        first = '' if down else (f'''<ports><port protocol="tcp" portid="{ports[0]}">
            <state state="filtered" reason="no-response"/></port>''' if filtered else
            f'''<ports><port protocol="tcp" portid="{ports[0]}">
            <state state="open" reason="syn-ack" reason_ttl="63"/>
            <service name="https" product="Example" version="1.0" extrainfo="test"
                     method="probed" conf="9"><cpe>cpe:/a:example:1</cpe></service>
            </port>''')
        last = '' if down or len(ports) == 1 else f'''<port protocol="tcp" portid="{ports[1]}">
            <state state="closed" reason="reset"/></port>'''
        end = '' if down else '</ports>'
        output.write_text(f'''<nmaprun version="7.95"><host>
            <status state="{'down' if down else 'up'}" reason="{'no-response' if down else 'syn-ack'}"/>
            <address addr="{target}" addrtype="ipv4"/><times srtt="3500"/>
            <hostnames><hostname name="ptr.example.org" type="PTR"/></hostnames>
            {first}{last}{end}</host><runstats><finished exit="success"/></runstats></nmaprun>''')
    """)


class WorkerTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.fake_nmap = self.directory / "fake-nmap"
        self.fake_nmap.write_text(FAKE_NMAP)
        self.fake_nmap.chmod(0o755)

    def job(self, targets, **fields):
        return {
            "job_id": "0193a1aa-6c1e-7b3f-9d2a-4e5f60718293",
            "lease_id": "test-lease",
            "scan_id": "0193a0f2-1b2c-7d3e-8f40-516273849506",
            "targets": targets,
            "max_duration_seconds": 30,
            "max_parallel": 2,
            "max_rate_per_process": 50,
            "host_timeout_ms": 5000,
            **fields,
        }

    def run_job(self, job, **environment):
        process_environment = os.environ.copy()
        process_environment.update(environment)
        process_environment["NMAP_BINARY"] = str(self.fake_nmap)
        text = job if isinstance(job, str) else json.dumps(job)
        result = subprocess.run([str(WORKER)], input=text, capture_output=True,
                                text=True, timeout=10, env=process_environment)
        return result.returncode, json.loads(result.stdout)

    def test_parallel_hosts_and_xml_mapping(self):
        log = self.directory / "starts.log"
        targets = [
            {"ip": "127.0.0.1", "domains": [], "ports": [80, 443]},
            {"ip": "127.0.0.2", "domains": ["example.org"], "ports": [8080]},
        ]
        code, result = self.run_job(self.job(targets), FAKE_NMAP_SLEEP_MS="350",
                                    FAKE_NMAP_LOG=str(log))
        self.assertEqual(code, 0)
        self.assertEqual(result["scan"]["status"], "completed")
        self.assertEqual(result["scan"]["counts"]["addresses"], 2)
        self.assertEqual(result["scan"]["counts"]["openPorts"], 2)
        self.assertEqual(result["scan"]["worker"]["nmapVersion"], "7.95")
        self.assertEqual([port["state"] for port in result["hosts"][0]["ports"]], ["open"])
        self.assertEqual(result["hosts"][0]["status"], "up")
        self.assertEqual(result["hosts"][0]["reason"], "syn-ack")
        self.assertEqual(result["hosts"][0]["latencyMs"], 4)
        self.assertEqual(result["hosts"][0]["ports"][0]["identity"]["ttl"], 63)
        self.assertEqual(result["hosts"][0]["ports"][0]["service"]["method"], "probed")
        self.assertEqual(result["hosts"][0]["ports"][0]["service"]["product"], "Example")
        self.assertEqual(result["hosts"][1]["hostnames"][0],
                         {"name": "example.org", "source": "job"})
        self.assertEqual(result["hosts"][0]["ports"][0]["http"], [])
        starts = [float(line.split()[1]) for line in log.read_text().splitlines()]
        self.assertEqual(len(starts), 2)
        self.assertLess(abs(starts[0] - starts[1]), 0.25)

    # Input in the same format as masscan-worker: address specs, exclude, ports.

    def test_address_specs_with_shared_ports(self):
        job = self.job(["127.0.0.0/30", "127.0.0.8-127.0.0.9"], exclude="127.0.0.3",
                       ports="80,8000-8001")
        code, result = self.run_job(job)
        self.assertEqual(code, 0)
        self.assertEqual([host["ip"] for host in result["hosts"]],
                         ["127.0.0.0", "127.0.0.1", "127.0.0.2", "127.0.0.8", "127.0.0.9"])
        self.assertEqual(result["scan"]["counts"]["addresses"], 5)
        self.assertEqual(result["scan"]["params"]["ports"], "80,8000-8001")
        self.assertIsNone(result["scan"]["params"]["subnet"])

    def test_subnet_is_the_single_aligned_block(self):
        code, result = self.run_job(self.job("127.0.0.0/30", ports=[80]))
        self.assertEqual(code, 0)
        self.assertEqual(result["scan"]["params"]["subnet"], "127.0.0.0/30")

    def test_host_objects_merge_with_address_specs(self):
        targets = ["127.0.0.1", {"ip": "127.0.0.1", "ports": [443], "domains": ["b.example"]}]
        code, result = self.run_job(self.job(targets, ports=[80]))
        self.assertEqual(code, 0)
        self.assertEqual(len(result["hosts"]), 1)
        self.assertEqual(result["scan"]["params"]["ports"], "80,443")
        self.assertEqual(result["hosts"][0]["hostnames"][0], {"name": "b.example", "source": "job"})

    def test_rejects_invalid_target(self):
        code, result = self.run_job(self.job([{"ip": "127.0.0.300", "ports": [80]}]))
        self.assertEqual(code, 2)
        self.assertEqual(result["scan"]["status"], "failed")
        self.assertEqual(result["scan"]["error"]["code"], "invalid-input")

    def test_address_limit(self):
        code, result = self.run_job(self.job("10.0.0.0/16"))
        self.assertEqual(code, 2)
        self.assertEqual(result["scan"]["error"]["code"], "invalid-input")

    def test_ids_are_optional(self):
        job = self.job(["127.0.0.1"], ports=[80])
        for key in ("job_id", "lease_id", "scan_id"):
            del job[key]
        code, result = self.run_job(job)
        self.assertEqual(code, 0)
        self.assertEqual([result["scan"][key] for key in ("jobId", "leaseId", "scanId")],
                         [None, None, None])

    def test_invalid_input_result_matches_masscan_worker(self):
        code, result = self.run_job("not json")
        self.assertEqual(code, 2)
        self.assertEqual(list(result), ["scan", "hosts"])
        scan = result["scan"]
        self.assertEqual(scan["error"], {"code": "invalid-input",
                                         "message": "input is not valid JSON"})
        self.assertEqual([scan["jobId"], scan["leaseId"], scan["scanId"]], [None, None, None])
        self.assertEqual(scan["stopReason"], "error")
        self.assertEqual(result["hosts"], [])
        self.assertIsNone(scan["counts"]["addresses"])
        self.assertIsNone(scan["params"]["maxParallel"])
        self.assertEqual(scan["params"]["nmapArgs"], [])

    def test_result_keys_follow_the_format_order(self):
        code, result = self.run_job(self.job(["127.0.0.1"], ports=[80]))
        self.assertEqual(code, 0)
        self.assertEqual(list(result), ["scan", "hosts"])
        self.assertEqual(list(result["scan"]),
                         ["jobId", "leaseId", "scanId", "worker", "status", "stopReason",
                          "startedAt", "finishedAt", "durationMs", "phasesMs", "params",
                          "counts", "error"])

    def test_effective_limits_are_reported(self):
        target = {"ip": "127.0.0.1", "ports": [80]}
        code, result = self.run_job(self.job([target], max_parallel=200,
                                               max_rate_per_process=1000))
        self.assertEqual(code, 0)
        self.assertEqual(result["scan"]["params"]["maxParallel"], 1)
        self.assertEqual(result["scan"]["params"]["maxRatePerProcess"], 50)

    def test_timeout_is_not_reported_as_scanned(self):
        target = {"ip": "127.0.0.1", "ports": [80]}
        code, result = self.run_job(self.job([target], host_timeout_ms=100),
                                    FAKE_NMAP_SLEEP_MS="1000")
        self.assertEqual(code, 0)
        self.assertEqual(result["scan"]["status"], "partial")
        self.assertEqual(result["hosts"][0]["status"], "timeout")
        self.assertEqual(result["scan"]["counts"]["timeout"], 1)

    def test_malformed_xml_is_a_host_error(self):
        target = {"ip": "127.0.0.1", "ports": [80]}
        code, result = self.run_job(self.job([target]), FAKE_NMAP_INVALID_XML="1")
        self.assertEqual(code, 0)
        self.assertEqual(result["hosts"][0]["error"]["code"], "invalid-xml")

    def test_down_host_has_no_ports(self):
        target = {"ip": "127.0.0.2", "ports": [80]}
        code, result = self.run_job(self.job([target]), FAKE_NMAP_DOWN_IP="127.0.0.2")
        self.assertEqual(code, 0)
        self.assertEqual(result["hosts"][0]["status"], "down")
        self.assertEqual(result["hosts"][0]["ports"], [])
        self.assertEqual(result["scan"]["counts"]["down"], 1)

    def test_pn_does_not_make_unresponsive_host_up(self):
        target = {"ip": "127.0.0.1", "ports": [80]}
        code, result = self.run_job(self.job([target]), FAKE_NMAP_FILTERED_IP="127.0.0.1")
        self.assertEqual(code, 0)
        self.assertEqual(result["hosts"][0]["status"], "down")
        self.assertEqual(result["hosts"][0]["reason"], "no-response")
        self.assertEqual(result["hosts"][0]["ports"], [])

    def test_file_input_and_output(self):
        path = self.directory / "job.json"
        destination = self.directory / "result.json"
        path.write_text(json.dumps(self.job([{"ip": "127.0.0.1", "ports": [80]}])))
        environment = os.environ.copy()
        environment["NMAP_BINARY"] = str(self.fake_nmap)
        process = subprocess.run([str(WORKER), "--input", str(path), "--output", str(destination),
                                  "--pretty"], capture_output=True, text=True, timeout=10,
                                 env=environment)
        self.assertEqual(process.returncode, 0)
        self.assertFalse(process.stdout)
        self.assertEqual(json.loads(destination.read_text())["scan"]["status"], "completed")

    # worker-manager compatibility: the shared envelope (max_duration_seconds, rate, task_*)
    # and stopping on SIGTERM.

    def test_time_window_is_required(self):
        job = self.job([{"ip": "127.0.0.1", "ports": [80]}])
        del job["max_duration_seconds"]
        code, result = self.run_job(job)
        self.assertEqual(code, 2)
        self.assertEqual(result["scan"]["error"]["code"], "invalid-input")

    def test_manager_envelope_is_accepted(self):
        job = self.job([{"ip": "127.0.0.1", "ports": [80]}])
        job.update({"task_id": f'{job["job_id"]}/1', "task_index": 1, "task_count": 2})
        code, result = self.run_job(job)
        self.assertEqual(code, 0)
        self.assertEqual(result["scan"]["status"], "completed")

    def test_rate_is_shared_by_parallel_processes(self):
        targets = [{"ip": "127.0.0.1", "ports": [80]}, {"ip": "127.0.0.2", "ports": [80]}]
        job = self.job(targets)
        job["rate"] = 60
        code, result = self.run_job(job)
        self.assertEqual(code, 0)
        self.assertEqual(result["scan"]["params"]["maxParallel"], 2)
        self.assertEqual(result["scan"]["params"]["maxRatePerProcess"], 30)
        self.assertIn("30", result["scan"]["params"]["nmapArgs"])

        job["rate"] = 1
        code, result = self.run_job(job)
        self.assertEqual(code, 0)
        self.assertEqual(result["scan"]["params"]["maxParallel"], 1)
        self.assertEqual(result["scan"]["params"]["maxRatePerProcess"], 1)

        job["rate"] = 100000  # never above NMAP_MAX_RATE_PER_PROCESS
        code, result = self.run_job(job)
        self.assertEqual(result["scan"]["params"]["maxRatePerProcess"], 50)

    def test_sigterm_writes_partial_result(self):
        targets = [{"ip": "127.0.0.1", "ports": [80]}, {"ip": "127.0.0.2", "ports": [80]}]
        path = self.directory / "job.json"
        destination = self.directory / "result.json"
        path.write_text(json.dumps(self.job(targets, max_parallel=1)))
        environment = os.environ.copy()
        environment.update({"NMAP_BINARY": str(self.fake_nmap), "FAKE_NMAP_SLEEP_MS": "5000"})
        # Like worker-manager: the worker leads its own process group and the whole group
        # (worker and Nmap) gets the signal.
        process = subprocess.Popen([str(WORKER), "--input", str(path), "--output",
                                    str(destination)], env=environment, start_new_session=True,
                                   stderr=subprocess.PIPE, text=True)
        time.sleep(0.5)
        os.killpg(process.pid, signal.SIGTERM)
        _, stderr = process.communicate(timeout=10)
        self.assertEqual(process.returncode, 0, stderr)
        result = json.loads(destination.read_text())
        self.assertEqual(result["scan"]["status"], "partial")
        self.assertEqual(result["scan"]["stopReason"], "stop-requested")
        self.assertEqual([host["status"] for host in result["hosts"]], ["cancelled", "cancelled"])
        self.assertIn("stopping", stderr)


if __name__ == "__main__":
    sys.argv = [sys.argv[0]]
    unittest.main()
