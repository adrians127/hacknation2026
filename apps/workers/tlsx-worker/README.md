# tlsx-worker

Python 3 adapter around [ProjectDiscovery TLSX](https://github.com/projectdiscovery/tlsx). It accepts one shared JSON job and returns exactly `{scan, hosts}`. It performs TLS handshakes only. Port-level `tls[]` holds the results; `http[]` stays empty.

## Run

From the repository root:

```bash
pnpm workers:tlsx:build
pnpm workers:tlsx < apps/workers/tlsx-worker/examples/job-local.json > result.json
python3 -m unittest discover -s apps/workers/tlsx-worker/tests -v
```

Use `TLSX_BINARY=/path/to/tlsx` for a local executable. `--input FILE` and `--output FILE` default to stdin/stdout; `-` selects those streams explicitly. `--pretty` formats the JSON. Logs go to stderr. File output uses a temporary file in the destination directory and an atomic rename. Exit code is 0 for completed/partial, 1 for a scanner failure, and 2 for invalid input. An invalid job still produces a failed `{scan, hosts}` result, preserving any string job identifiers; as with the other workers, missing or invalid identifiers cannot satisfy the backend's UUID validation.

## Job and safety

Common fields: `job_id`, `scan_id`, `lease_id`, `targets`, `exclude`, `ports`, `rate`, `max_duration_seconds`. Duration is required (1–604800 seconds). Targets are IPv4 addresses, CIDRs, ranges, or `{ip, ports, domains}` objects; legacy `domain` is also accepted. Object ports are known open from discovery, so they remain in the result even if a TLS handshake fails. Plain IP/range ports appear only after a TLS response. `exclude` removes assigned addresses before any probe.

Set `ports` or per-host ports explicitly for a TLS task. The shared default `1-65535` exceeds this worker's cap of 8192 planned handshakes for one address. The worker accepts at most 1024 addresses and 8192 `(IP, port, SNI)` handshakes. It starts at most one TLSX process at a time, using the assigned IP and port and optional domain as `-sni`; it does not ask TLSX to resolve a domain. It gives each TLSX invocation a private temporary config home, so the image also runs under an arbitrary non-root UID. It filters every JSONL row by assigned IP, port and SNI. No HTTP probe or redirect is made.

`rate` is the manager-granted maximum TLSX invocation starts per second, capped at 25 by default (`TLSX_WORKER_MAX_RATE` can lower it). TLSX's automatic TLS fallback can make additional connection attempts within one invocation. `tls_timeout_ms` defaults to 5000; TLSX accepts whole seconds, so it is rounded down. The worker terminates the current child at its deadline or on SIGTERM and writes a partial result. It uses TLSX `-json -silent -duc -retry 1 -c 1 -timeout`, plus the version, cipher, serial and SHA-256 fingerprint probes. TLSX supplies CN and SAN in the default JSONL certificate response; its `-cn` and `-san` switches cannot be combined with the version/cipher probes. `max_parallel` is effectively 1; `scan.params.maxParallel` records that value. `scan.params.httpTimeoutMs` remains `null` because no HTTP request is sent.

TLSX v1.5.0 is the latest official tag checked for this implementation and [requires Go 1.27.3](https://github.com/projectdiscovery/tlsx/blob/v1.5.0/go.mod). The image pins v1.5.0 and builds it with `golang:1.27.3`. The verified [TLSX CLI flags](https://github.com/projectdiscovery/tlsx/blob/v1.5.0/README.md#usage) include `-json` for JSONL output and `-sni` for a target's server name.

## Mapping

For each successful TLSX JSONL row, the worker records the reported `tls_version`, `cipher`, certificate CN, SAN, issuer, validity, serial and SHA-256 fingerprint when supplied. `self_signed` is set only when TLSX reports true; an omitted false value is represented as `null`. TLSX v1.5.0 does not report ALPN or the certificate key algorithm and bit count in its normal JSONL response, so those fields are `null`. `identity.tlsCertSha256` is set from an observed fingerprint. SAN names are exposed as `tls-san` hostnames. A successful handshake on a plain address is enough to mark the host up. A plain address with no TLS response is inconclusive (`timeout`), since TLSX cannot establish that the host itself is down.

## Manager

The manager image includes this worker and TLSX. `tlsx` is registered as an optional stage after `nmap`, with a default cap of 25 TLSX invocation starts/s. Use [`naabu-nmap-tlsx-local.json`](../worker-manager/examples/naabu-nmap-tlsx-local.json) as a three-stage example without HTTPX. Each job explicitly repeats its targets and ports: the manager orders overlapping work but does not turn Naabu results into Nmap/TLSX inputs. For a production scan, construct those later jobs from authorized discovery results before submitting the list.

The standalone and manager Docker builds run the Python tests, including a real TLSX handshake against an ephemeral local TLS server. The Python tests run without raw socket privileges. A local real-server test requires `TLSX_REAL_BINARY=/path/to/tlsx` and `openssl`.
