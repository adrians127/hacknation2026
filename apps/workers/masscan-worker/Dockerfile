# Built from this directory: docker build -t masscan-worker apps/workers/masscan-worker
# (or `pnpm workers:build` from the repo root).
#
# Build and runtime share one base so the binary's libstdc++ matches at runtime.
# UBUNTU_IMAGE lets you pull the base from a Docker Hub mirror when Hub rate-limits you (429).

ARG UBUNTU_IMAGE=ubuntu
ARG UBUNTU_VERSION=26.04

FROM ${UBUNTU_IMAGE}:${UBUNTU_VERSION} AS builder
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential cmake ninja-build nlohmann-json3-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY CMakeLists.txt CMakePresets.json ./
COPY src ./src
COPY tests ./tests
RUN cmake --preset release && cmake --build --preset release \
    && ctest --test-dir build/release --output-on-failure \
    && cmake --install build/release --prefix /out

FROM ${UBUNTU_IMAGE}:${UBUNTU_VERSION} AS runner
RUN apt-get update \
    && apt-get install -y --no-install-recommends masscan libcap2-bin \
    && rm -rf /var/lib/apt/lists/* \
    # masscan sends raw SYNs; file capabilities let the non-root worker run it. The container
    # still needs `cap_add: [NET_RAW, NET_ADMIN]` (docker-compose.yml).
    && setcap cap_net_raw,cap_net_admin+eip "$(command -v masscan)" \
    && useradd --system --no-create-home --shell /usr/sbin/nologin worker
COPY --from=builder /out/bin/masscan-worker /usr/local/bin/masscan-worker
USER worker
ENTRYPOINT ["/usr/local/bin/masscan-worker"]
