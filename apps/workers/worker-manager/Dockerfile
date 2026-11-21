# Built from apps/workers (it also builds masscan-worker, which the manager runs as a child):
#   docker build -f apps/workers/worker-manager/Dockerfile apps/workers
# (or `pnpm workers:manager` from the repo root, which builds and runs it).
#
# Build and runtime share one base so the binaries' libstdc++ matches at runtime.
# UBUNTU_IMAGE lets you pull the base from a Docker Hub mirror when Hub rate-limits you (429).

ARG UBUNTU_IMAGE=ubuntu
ARG UBUNTU_VERSION=26.04

FROM ${UBUNTU_IMAGE}:${UBUNTU_VERSION} AS builder
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential cmake ninja-build nlohmann-json3-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY masscan-worker ./masscan-worker
COPY worker-manager ./worker-manager
RUN for project in masscan-worker worker-manager; do \
        cmake -S "$project" -B "build/$project" -G Ninja -DCMAKE_BUILD_TYPE=Release \
        && cmake --build "build/$project" \
        && ctest --test-dir "build/$project" --output-on-failure \
        && cmake --install "build/$project" --prefix /out || exit 1; \
    done

FROM ${UBUNTU_IMAGE}:${UBUNTU_VERSION} AS runner
RUN apt-get update \
    && apt-get install -y --no-install-recommends masscan libcap2-bin \
    && rm -rf /var/lib/apt/lists/* \
    # masscan sends raw SYNs; file capabilities let a non-root user run it. The container
    # still needs `cap_add: [NET_RAW, NET_ADMIN]` (docker-compose.workers.yml).
    && setcap cap_net_raw,cap_net_admin+eip "$(command -v masscan)" \
    && useradd --system --no-create-home --shell /usr/sbin/nologin worker \
    && mkdir /results && chown worker /results
COPY --from=builder /out/bin/masscan-worker /out/bin/worker-manager /usr/local/bin/
COPY worker-manager/examples /jobs
USER worker
ENV WORKER_MANAGER_WORKERS=masscan=/usr/local/bin/masscan-worker
ENTRYPOINT ["/usr/local/bin/worker-manager"]
CMD ["--input", "/jobs/example.json", "--output-dir", "/results"]
