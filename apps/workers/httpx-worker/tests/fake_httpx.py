#!/usr/bin/env python3
"""Small httpx CLI double: reads the supplied URL/path lists and emits JSONL."""
import json
import os
import sys
import time


def value(flag):
    return sys.argv[sys.argv.index(flag) + 1]


assert "-json" in sys.argv and "-nfs" in sys.argv and "-no-stdin" in sys.argv
assert "-rl" in sys.argv and "-rstr" in sys.argv
time.sleep(float(os.environ.get("FAKE_HTTPX_SLEEP", "0")))
with open(value("-l"), encoding="utf-8") as f:
    urls = [line.strip() for line in f if line.strip()]
with open(value("-path"), encoding="utf-8") as f:
    paths = [line.strip() for line in f if line.strip()]
domain = value("-sni") if "-sni" in sys.argv else ""
if domain:
    assert value("-H") == f"Host: {domain}"
for base in urls:
    scheme, address = base.split("://", 1)
    host, port = address.strip("/").rsplit(":", 1)
    for path in paths:
        status = 200 if scheme == "http" and host == "127.0.0.1" else 0
        if status and path == "/admin":
            status = 404 if domain else 302
        favicon = path == "/favicon.ico"
        body = "<title>App</title>" if status and not favicon else ""
        row = {
            "input": base,
            "url": base.removesuffix("/") + path,
            "scheme": scheme,
            "port": port,
            "path": path,
            "status_code": status,
            "title": "App" if status and not favicon else "",
            "content_type": ("image/x-icon" if favicon else "text/html") if status else "",
            "content_length": len(body),
            "body": body,
            "location": "/login" if status == 302 else "",
            "raw_header": "Content-Type: text/html\r\nSet-Cookie: session=very-secret; HttpOnly; Secure; SameSite=Lax\r\n" if status else "",
        }
        if status and "-hash" in sys.argv:
            assert value("-hash") == "mmh3,sha256"
            row["hash"] = {"body_mmh3": "-1137954245" if favicon else "1", "body_sha256": "f" * 64}
        print(json.dumps(row), flush=True)
