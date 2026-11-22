ARG UBUNTU_IMAGE=ubuntu
ARG UBUNTU_VERSION=26.04
FROM golang:1.27.3 AS tlsx
ARG TLSX_VERSION=v1.5.0
ENV CGO_ENABLED=0 GOBIN=/out
RUN go install github.com/projectdiscovery/tlsx/cmd/tlsx@${TLSX_VERSION}

FROM ${UBUNTU_IMAGE}:${UBUNTU_VERSION}
RUN apt-get update && apt-get install -y --no-install-recommends python3 openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --no-create-home --shell /usr/sbin/nologin worker
COPY --from=tlsx /out/tlsx /usr/local/bin/tlsx
COPY tlsx-worker /opt/tlsx-worker/tlsx-worker
COPY tests /opt/tlsx-worker/tests
RUN chmod +x /opt/tlsx-worker/tlsx-worker /opt/tlsx-worker/tests/fake_tlsx.py \
    && TLSX_REAL_BINARY=/usr/local/bin/tlsx python3 -m unittest discover -s /opt/tlsx-worker/tests -v \
    && install -m 755 /opt/tlsx-worker/tlsx-worker /usr/local/bin/tlsx-worker \
    && rm -rf /opt/tlsx-worker
USER worker
ENTRYPOINT ["/usr/local/bin/tlsx-worker"]
