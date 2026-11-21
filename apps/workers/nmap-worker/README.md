# nmap-worker

A **C++23** scanning worker that wraps **nmap**. For now it is a skeleton: it prints its configuration and the nmap version, then exits. The HTTP pull loop is described in [`../README.md`](../README.md).

## Build and run (Docker, recommended)

```bash
pnpm workers:build                                                     # from the repo root
docker compose -f docker/docker-compose.yml --profile workers run --rm nmap-worker
```

The image is built and runs on `ubuntu:26.04` (GCC, CMake, Ninja, nmap 7.98). Build and runtime share the same base, so the libstdc++ version matches. The process runs as the `worker` user, and nmap has `setcap cap_net_raw,cap_net_admin`. Compose grants the container `NET_RAW` / `NET_ADMIN`, without which SYN scans and OS detection are impossible.

## Local build

```bash
brew install cmake ninja nmap          # macOS (not installed by default)
cmake --preset debug && cmake --build --preset debug
./build/debug/nmap-worker
```

`compile_commands.json` lands in `build/<preset>/` (for clangd).

## Configuration

| Variable | Default | Description |
|---|---|---|
| `BACKEND_URL` | `http://localhost:3001/v1` | Backend API. In compose: `http://host.docker.internal:3001/v1` |

## Planned dependencies

- HTTP: libcurl (or cpr)
- JSON: nlohmann/json
- `nmap -oX` parsing: pugixml
- pulled in via CMake `FetchContent` or as system packages in the Dockerfile (to be decided during implementation)

## Note: Docker Desktop on macOS

Containers run inside a virtual machine, so a LAN scan from macOS goes through NAT and the results may differ from a scan run on Linux. For tests in the AGH lab, run the worker on a Linux host (optionally with `network_mode: host`).
