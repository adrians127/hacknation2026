# syntax=docker/dockerfile:1
ARG GO_VERSION=1.26
ARG UBUNTU_IMAGE=ubuntu
ARG UBUNTU_VERSION=26.04
FROM golang:${GO_VERSION} AS httpx
ARG HTTPX_VERSION=v1.12.0
ENV CGO_ENABLED=0 GOBIN=/out
RUN go install github.com/projectdiscovery/httpx/cmd/httpx@${HTTPX_VERSION}

FROM ${UBUNTU_IMAGE}:${UBUNTU_VERSION} AS builder
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake ninja-build nlohmann-json3-dev libssl-dev python3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY CMakeLists.txt CMakePresets.json ./
COPY src ./src
COPY tests ./tests
RUN cmake --preset release && cmake --build --preset release \
    && ctest --test-dir build/release --output-on-failure \
    && cmake --install build/release --prefix /out

FROM ${UBUNTU_IMAGE}:${UBUNTU_VERSION} AS runner
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libssl3t64 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --no-create-home --shell /usr/sbin/nologin worker
COPY --from=httpx /out/httpx /usr/local/bin/httpx
COPY --from=builder /out/bin/httpx-worker /usr/local/bin/httpx-worker
USER worker
ENTRYPOINT ["/usr/local/bin/httpx-worker"]
