#!/usr/bin/env python3
import json
import os
import signal
import sys
import time

args = sys.argv[1:]
if os.environ.get("FAKE_NAABU_ARGS"):
    with open(os.environ["FAKE_NAABU_ARGS"], "w") as file:
        json.dump(args, file)

if os.environ.get("FAKE_NAABU_WAIT"):
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    print(json.dumps({"ip": "127.0.0.1", "port": 80}), flush=True)
    time.sleep(30)
else:
    print(json.dumps({"ip": "127.0.0.1", "port": 80}), flush=True)
    print(json.dumps({"ip": "127.0.0.1", "port": 80}), flush=True)
    print(json.dumps({"ip": "127.0.0.2", "port": 443}), flush=True)
    print(json.dumps({"ip": "127.0.0.99", "port": 80}), flush=True)
    print("fake naabu stderr", file=sys.stderr, flush=True)
    sys.exit(int(os.environ.get("FAKE_NAABU_EXIT", "0")))
