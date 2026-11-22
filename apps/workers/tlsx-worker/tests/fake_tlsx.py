#!/usr/bin/env python3
import json
import os
import sys
import time

args = sys.argv[1:]
with open(os.environ["FAKE_TLSX_ARGS"], "a", encoding="utf-8") as stream:
    stream.write(json.dumps(args) + "\n")
time.sleep(float(os.environ.get("FAKE_TLSX_WAIT", "0")))
if os.environ.get("FAKE_TLSX_EXIT"):
    sys.exit(int(os.environ["FAKE_TLSX_EXIT"]))
host, port = args[args.index("-u") + 1].split(":")
sni = args[args.index("-sni") + 1] if "-sni" in args else None
row = {"host": host, "ip": host, "port": port, "probe_status": True,
       "tls_version": "tls13", "cipher": "TLS_AES_128_GCM_SHA256",
       "subject_cn": sni or "local.test", "subject_an": ["local.test", "extra.test"],
       "issuer_cn": "Local CA", "not_before": "2026-01-01T00:00:00Z",
       "not_after": "2027-01-01T00:00:00Z", "serial": "123",
       "fingerprint_hash": {"sha256": "a" * 64}}
print(json.dumps({**row, "host": "8.8.8.8"}))
print(json.dumps({**row, "port": "4444"}))
print(json.dumps({**row, "sni": "outside.test"}))
print(json.dumps(row))
