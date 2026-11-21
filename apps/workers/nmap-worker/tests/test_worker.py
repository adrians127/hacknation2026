import datetime
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
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
    ports = args[args.index('-p') + 1].split(',')
    log = os.environ.get('FAKE_NMAP_LOG')
    if log:
        with open(log, 'a') as stream:
            stream.write(f'{target} {time.monotonic()}\\n')
    time.sleep(int(os.environ.get('FAKE_NMAP_SLEEP_MS', '0')) / 1000)
    if os.environ.get('FAKE_NMAP_INVALID_XML'):
        output.write_text('<broken>')
    else:
        output.write_text(f'''<nmaprun><host><address addr="{target}" addrtype="ipv4"/>
            <ports><port protocol="tcp" portid="{ports[0]}"><state state="open"/>
            <service name="https" product="Example" version="1.0"><cpe>cpe:/a:example:1</cpe>
            </service></port></ports></host><runstats><finished exit="success"/></runstats>
            </nmaprun>''')
    """)


class WorkerTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.fake_nmap = self.directory / "fake-nmap"
        self.fake_nmap.write_text(FAKE_NMAP)
        self.fake_nmap.chmod(0o755)

    def job(self, targets, **limits):
        deadline = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=30)
        return {
            "job_id": "test-job",
            "lease_id": "test-lease",
            "subnet": "127.0.0.0/30",
            "deadline": deadline.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "limits": {"max_parallel": 2, "max_rate_per_process": 50,
                       "host_timeout_ms": 5000, **limits},
            "targets": targets,
        }

    def run_job(self, job, **environment):
        path = self.directory / "job.json"
        path.write_text(json.dumps(job))
        process_environment = os.environ.copy()
        process_environment.update(environment)
        process_environment["NMAP_BINARY"] = str(self.fake_nmap)
        result = subprocess.run([str(WORKER), "--job-file", str(path)], capture_output=True,
                                text=True, timeout=10, env=process_environment)
        return result.returncode, json.loads(result.stdout)

    def test_parallel_hosts_and_xml_mapping(self):
        log = self.directory / "starts.log"
        targets = [
            {"ip": "127.0.0.1", "domain": None, "tcp_ports": [80, 443]},
            {"ip": "127.0.0.2", "domain": "example.org", "tcp_ports": [8080]},
        ]
        code, result = self.run_job(self.job(targets), FAKE_NMAP_SLEEP_MS="350",
                                    FAKE_NMAP_LOG=str(log))
        self.assertEqual(code, 0)
        self.assertEqual(result["status"], "completed")
        self.assertEqual([port["state"] for port in result["hosts"][0]["ports"]],
                         ["open", "not_reported"])
        self.assertEqual(result["hosts"][0]["ports"][0]["service"]["product"], "Example")
        starts = [float(line.split()[1]) for line in log.read_text().splitlines()]
        self.assertEqual(len(starts), 2)
        self.assertLess(abs(starts[0] - starts[1]), 0.25)

    def test_rejects_ip_outside_subnet(self):
        code, result = self.run_job(self.job([{"ip": "127.0.1.1", "tcp_ports": [80]}]))
        self.assertNotEqual(code, 0)
        self.assertEqual(result["code"], "invalid_target")

    def test_timeout_is_not_reported_as_scanned(self):
        target = {"ip": "127.0.0.1", "tcp_ports": [80]}
        code, result = self.run_job(self.job([target], host_timeout_ms=100),
                                    FAKE_NMAP_SLEEP_MS="1000")
        self.assertNotEqual(code, 0)
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["hosts"][0]["status"], "timeout")

    def test_malformed_xml_is_a_host_error(self):
        target = {"ip": "127.0.0.1", "tcp_ports": [80]}
        code, result = self.run_job(self.job([target]), FAKE_NMAP_INVALID_XML="1")
        self.assertNotEqual(code, 0)
        self.assertEqual(result["hosts"][0]["error"]["code"], "invalid_xml")


if __name__ == "__main__":
    sys.argv = [sys.argv[0]]
    unittest.main()
