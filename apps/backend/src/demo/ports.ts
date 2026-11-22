import type { HttpEndpoint, OpenPort } from "@subsurf/contracts/workers/worker-result.schema";

import { endpoint, type CertSpec, type SiteSpec } from "~backend/demo/http";
import type { DemoRunNumber } from "~backend/demo/network";
import { fakeSha256 } from "~backend/demo/random";

/** How a host differs from the first run (the baseline), from its `changesFrom` run on. */
export type DemoChange =
  | "upgrade"
  | "open-port"
  | "close-port"
  | "renew-cert"
  | "maintenance"
  | "retitle";

/** Everything a profile needs to describe one host in one run. */
export interface HostContext {
  ip: string;
  run: DemoRunNumber;
  /** Fixed per host: picks versions and flavours, so both runs agree. */
  variant: number;
  /** Human name used in page titles. */
  label: string;
  /** Domains the job assigned to this IP: each gets its own HTTP endpoint (`vhost`). */
  domains: readonly string[];
  observedAt: string;
  ttl: number;
  /** True from the host's `changesFrom` run on, for the changes declared on it. */
  changed(change: DemoChange): boolean;
}

export interface ServiceSpec {
  name: string;
  product?: string | null;
  version?: string | null;
  extraInfo?: string | null;
  cpe?: readonly string[];
  method?: "probed" | "table";
  confidence?: number;
}

type Script = OpenPort["scripts"][number];

export function openPort(
  ctx: HostContext,
  port: number,
  service: ServiceSpec | null,
  extra: { banner?: string | null; scripts?: Script[]; http?: HttpEndpoint[] } = {},
): OpenPort {
  const http = extra.http ?? [];
  return {
    port,
    protocol: "tcp",
    state: "open",
    reason: "syn-ack",
    service: service && {
      name: service.name,
      product: service.product ?? null,
      version: service.version ?? null,
      extraInfo: service.extraInfo ?? null,
      cpe: [...(service.cpe ?? [])],
      method: service.method ?? "probed",
      confidence: service.confidence ?? 10,
    },
    identity: {
      ttl: ctx.ttl,
      sshHostKeySha256: service?.name === "ssh" ? fakeSha256(`ssh-hostkey ${ctx.ip}`) : null,
      tlsCertSha256: http.find((entry) => entry.tls)?.tls?.cert.sha256 ?? null,
    },
    banner: extra.banner ?? null,
    scripts: extra.scripts ?? [],
    http,
  };
}

/** A port speaking HTTP(S): one endpoint by bare IP and one per domain of the host. */
export function webPort(
  ctx: HostContext,
  spec: {
    port: number;
    scheme: "http" | "https";
    service: ServiceSpec;
    /** `host` is the vhost, or the IP for the bare-IP request. */
    site: (host: string, vhost: string | null) => SiteSpec;
    cert?: (vhost: string | null) => CertSpec;
    upgradesToHttps?: boolean;
    /** Devices answer the same on every name: request them by IP only. */
    bareIpOnly?: boolean;
  },
): OpenPort {
  const vhosts = spec.bareIpOnly ? [null] : [null, ...ctx.domains];
  const http = vhosts.map((vhost) =>
    endpoint(
      {
        scheme: spec.scheme,
        ip: ctx.ip,
        port: spec.port,
        vhost,
        observedAt: ctx.observedAt,
        upgradesToHttps: spec.upgradesToHttps,
        cert: spec.cert?.(vhost),
      },
      spec.site(vhost ?? ctx.ip, vhost),
    ),
  );
  return openPort(ctx, spec.port, spec.service, { http });
}

interface SshFlavour {
  version: string;
  extraInfo: string | null;
  banner: string;
  /** What an `upgrade` change installs. */
  next?: SshFlavour;
}

const UBUNTU_2404: SshFlavour = {
  version: "9.6p1",
  extraInfo: "Ubuntu 3ubuntu13.5",
  banner: "SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.5",
};
const UBUNTU_2204: SshFlavour = {
  version: "8.9p1",
  extraInfo: "Ubuntu 3ubuntu0.10",
  banner: "SSH-2.0-OpenSSH_8.9p1 Ubuntu-3ubuntu0.10",
  next: UBUNTU_2404,
};
const DEBIAN_12: SshFlavour = {
  version: "9.2p1",
  extraInfo: "Debian 2+deb12u3",
  banner: "SSH-2.0-OpenSSH_9.2p1 Debian-2+deb12u3",
  next: {
    version: "9.2p1",
    extraInfo: "Debian 2+deb12u5",
    banner: "SSH-2.0-OpenSSH_9.2p1 Debian-2+deb12u5",
  },
};
const ROCKY_9: SshFlavour = { version: "8.7", extraInfo: "protocol 2.0", banner: "SSH-2.0-OpenSSH_8.7" };
/** End of life, still around: something an analyst wants to find. */
const CENTOS_7: SshFlavour = {
  version: "7.4",
  extraInfo: "protocol 2.0",
  banner: "SSH-2.0-OpenSSH_7.4",
};

export const SSH_FLAVOURS = [UBUNTU_2204, UBUNTU_2204, UBUNTU_2404, DEBIAN_12, ROCKY_9, CENTOS_7];

export function sshPort(ctx: HostContext, flavour: SshFlavour): OpenPort {
  const current = ctx.changed("upgrade") && flavour.next ? flavour.next : flavour;
  return openPort(
    ctx,
    22,
    {
      name: "ssh",
      product: "OpenSSH",
      version: current.version,
      extraInfo: current.extraInfo,
      cpe: [`cpe:/a:openbsd:openssh:${current.version}`],
    },
    {
      banner: current.banner,
      scripts: [
        {
          id: "ssh-hostkey",
          output: `256 SHA256:${fakeSha256(`ssh-hostkey ${ctx.ip}`).slice(0, 43)} (ED25519)`,
        },
      ],
    },
  );
}

const CERT_DATES = {
  geant: { notBefore: "2026-03-02T00:00:00Z", notAfter: "2027-03-02T23:59:59Z" },
  letsEncrypt: { notBefore: "2026-09-02T08:12:44Z", notAfter: "2026-12-01T08:12:43Z" },
  renewed: { notBefore: "2026-11-20T09:30:00Z", notAfter: "2027-02-18T09:29:59Z" },
  expired: { notBefore: "2025-10-31T00:00:00Z", notAfter: "2026-10-31T23:59:59Z" },
  device: { notBefore: "2019-05-14T10:00:00Z", notAfter: "2029-05-11T10:00:00Z" },
} as const;

/** A certificate for the host's domains; `renew-cert` reissues it with new dates. */
export function publicCert(
  ctx: HostContext,
  issuer: "GEANT TLS RSA 1" | "R11" = "GEANT TLS RSA 1",
): CertSpec {
  const names = ctx.domains.length > 0 ? ctx.domains : [ctx.ip];
  const dates = ctx.changed("renew-cert")
    ? CERT_DATES.renewed
    : issuer === "R11"
      ? CERT_DATES.letsEncrypt
      : CERT_DATES.geant;
  return { cn: names[0], san: names, issuer, ...dates };
}

export function expiredCert(ctx: HostContext): CertSpec {
  const names = ctx.domains.length > 0 ? ctx.domains : [ctx.ip];
  return { cn: names[0], san: names, issuer: "GEANT TLS RSA 1", ...CERT_DATES.expired };
}

export function deviceCert(cn: string): CertSpec {
  return { cn, issuer: cn, selfSigned: true, tlsVersion: "TLSv1.2", ...CERT_DATES.device };
}
