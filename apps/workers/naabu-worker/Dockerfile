ARG UBUNTU_IMAGE=ubuntu
ARG UBUNTU_VERSION=26.04
FROM golang:1.26 AS naabu
ARG NAABU_VERSION=v2.7.0
ENV CGO_ENABLED=0 GOBIN=/out
RUN go install github.com/projectdiscovery/naabu/v2/cmd/naabu@${NAABU_VERSION}

FROM ${UBUNTU_IMAGE}:${UBUNTU_VERSION}
RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates libcap2-bin \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --no-create-home --shell /usr/sbin/nologin worker
COPY --from=naabu /out/naabu /usr/local/bin/naabu
COPY naabu-worker /opt/naabu-worker/naabu-worker
COPY tests /opt/naabu-worker/tests
RUN python3 -m unittest discover -s /opt/naabu-worker/tests -v \
    && install -m 755 /opt/naabu-worker/naabu-worker /usr/local/bin/naabu-worker \
    && rm -rf /opt/naabu-worker \
    && setcap cap_net_raw,cap_net_admin+eip /usr/local/bin/naabu
USER worker
ENTRYPOINT ["/usr/local/bin/naabu-worker"]
