# Built from apps/workers (it also builds masscan-worker, nmap-worker and httpx-worker, which the manager runs
# as children):
#   docker build -f apps/workers/worker-manager/Dockerfile apps/workers
# (or `pnpm workers:manager` from the repo root, which builds and runs it).
#
# Build and runtime share one base so the binaries' libstdc++ matches at runtime.
# UBUNTU_IMAGE lets you pull the base from a Docker Hub mirror when Hub rate-limits you (429).

ARG UBUNTU_IMAGE=ubuntu
ARG UBUNTU_VERSION=26.04

FROM golang:1.26 AS httpx
ARG HTTPX_VERSION=v1.12.0
ENV CGO_ENABLED=0 GOBIN=/out
RUN go install github.com/projectdiscovery/httpx/cmd/httpx@${HTTPX_VERSION}

FROM golang:1.26 AS naabu
ARG NAABU_VERSION=v2.7.0
ENV CGO_ENABLED=0 GOBIN=/out
RUN go install github.com/projectdiscovery/naabu/v2/cmd/naabu@${NAABU_VERSION}

FROM ${UBUNTU_IMAGE}:${UBUNTU_VERSION} AS builder
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential cmake ninja-build nlohmann-json3-dev \
      libcurl4-openssl-dev libpugixml-dev libssl-dev nmap python3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY masscan-worker ./masscan-worker
COPY nmap-worker ./nmap-worker
COPY httpx-worker ./httpx-worker
COPY worker-manager ./worker-manager
RUN for project in masscan-worker nmap-worker httpx-worker worker-manager; do \
        cmake -S "$project" -B "build/$project" -G Ninja -DCMAKE_BUILD_TYPE=Release \
        && cmake --build "build/$project" \
        && ctest --test-dir "build/$project" --output-on-failure \
        && cmake --install "build/$project" --prefix /out || exit 1; \
    done
COPY naabu-worker ./naabu-worker
RUN python3 -m unittest discover -s naabu-worker/tests -v

FROM ${UBUNTU_IMAGE}:${UBUNTU_VERSION} AS runner
RUN apt-get update \
    && apt-get install -y --no-install-recommends masscan nmap python3 libcap2-bin ca-certificates libssl3t64 \
      libcurl4-openssl-dev libpugixml-dev \
    && rm -rf /var/lib/apt/lists/* \
    # masscan sends raw SYNs; file capabilities let a non-root user run it. The container
    # still needs `cap_add: [NET_RAW, NET_ADMIN]` (docker-compose.workers.yml).
    && setcap cap_net_raw,cap_net_admin+eip "$(command -v masscan)" \
    && setcap cap_net_raw,cap_net_admin,cap_net_bind_service+eip "$(command -v nmap)" \
    && useradd --system --no-create-home --shell /usr/sbin/nologin worker \
    && mkdir /results && chown worker /results
COPY --from=httpx /out/httpx /usr/local/bin/httpx
COPY --from=naabu /out/naabu /usr/local/bin/naabu
COPY naabu-worker/naabu-worker /usr/local/bin/naabu-worker
RUN chmod +x /usr/local/bin/naabu-worker \
    && setcap cap_net_raw,cap_net_admin+eip /usr/local/bin/naabu
COPY --from=builder /out/bin/masscan-worker /out/bin/nmap-worker /out/bin/httpx-worker /out/bin/worker-manager \
     /usr/local/bin/
COPY worker-manager/examples /jobs
# One manifest per worker name in WORKER_MANAGER_WORKERS; --poll announces them to the backend.
COPY masscan-worker/manifest.json /usr/local/share/worker-manager/workers/masscan.json
COPY naabu-worker/manifest.json /usr/local/share/worker-manager/workers/naabu.json
COPY nmap-worker/manifest.json /usr/local/share/worker-manager/workers/nmap.json
COPY httpx-worker/manifest.json /usr/local/share/worker-manager/workers/httpx.json
USER worker
ENV WORKER_MANAGER_WORKERS=masscan=/usr/local/bin/masscan-worker,naabu=/usr/local/bin/naabu-worker,nmap=/usr/local/bin/nmap-worker,httpx=/usr/local/bin/httpx-worker
ENTRYPOINT ["/usr/local/bin/worker-manager"]
CMD ["--input", "/jobs/example.json", "--output-dir", "/results"]
