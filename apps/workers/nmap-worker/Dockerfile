# syntax=docker/dockerfile:1
#
# Built from this directory: docker build -t nmap-worker apps/workers/nmap-worker
# (or `pnpm workers:build` from the repo root).
#
# Build and runtime share one base so the binary's libstdc++ matches at runtime.

ARG UBUNTU_VERSION=26.04

FROM ubuntu:${UBUNTU_VERSION} AS builder
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential cmake ninja-build \
      libcurl4-openssl-dev libpugixml-dev nlohmann-json3-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY CMakeLists.txt CMakePresets.json ./
COPY src ./src
RUN cmake --preset release && cmake --build --preset release \
    && cmake --install build/release --prefix /out

FROM ubuntu:${UBUNTU_VERSION} AS runner
RUN apt-get update \
    && apt-get install -y --no-install-recommends nmap ca-certificates libcap2-bin \
      libcurl4-openssl-dev libpugixml-dev \
    && rm -rf /var/lib/apt/lists/* \
    # Raw-socket scans (-sS, OS detection) without running the worker as root;
    # the container still needs `cap_add: [NET_RAW, NET_ADMIN]` (docker-compose.yml).
    && setcap cap_net_raw,cap_net_admin,cap_net_bind_service+eip "$(command -v nmap)" \
    && useradd --system --no-create-home --shell /usr/sbin/nologin worker
COPY --from=builder /out/bin/nmap-worker /usr/local/bin/nmap-worker
USER worker
ENTRYPOINT ["/usr/local/bin/nmap-worker"]
