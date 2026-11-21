import type { Cpe } from "~backend/modules/vulnerabilities/cpe/cpe";

/** Distributions known to patch packages without changing the upstream version. */
export type DistroFamily = "Debian" | "Ubuntu" | "Alpine" | "RedHat";

export interface DistroHint {
  family: DistroFamily | null;
  /** Debian `12`, Ubuntu `22.04`, Alpine `v3.20`; `null` when the scan did not show it. */
  release: string | null;
  /** The package revision after the upstream version (`2+deb12u3`, `3ubuntu13.5`). */
  revision: string | null;
}

export const NO_DISTRO: DistroHint = { family: null, release: null, revision: null };

const OS_CPES: Record<string, DistroFamily> = {
  "debian:debian_linux": "Debian",
  "canonical:ubuntu_linux": "Ubuntu",
  "alpinelinux:alpine_linux": "Alpine",
  "redhat:enterprise_linux": "RedHat",
  "redhat:linux": "RedHat",
  "centos:centos": "RedHat",
  "rockylinux:rocky_linux": "RedHat",
  "almalinux:almalinux": "RedHat",
  "fedoraproject:fedora": "RedHat",
};

/** The distribution's platform CPE, for NVD configurations that require one. */
export const DISTRO_PLATFORM: Record<DistroFamily, Pick<Cpe, "vendor" | "product">> = {
  Debian: { vendor: "debian", product: "debian_linux" },
  Ubuntu: { vendor: "canonical", product: "ubuntu_linux" },
  Alpine: { vendor: "alpinelinux", product: "alpine_linux" },
  RedHat: { vendor: "redhat", product: "enterprise_linux" },
};

const REVISION = String.raw`[0-9][\w.+~]*`;

function debianRelease(revision: string): string | null {
  return /[+~]deb(\d+)u\d+/.exec(revision)?.[1] ?? null;
}

function ubuntuRelease(text: string): string | null {
  return /ubuntu[\d.]*?(\d{2}\.\d{2})(?:\.\d+)?\b/.exec(text)?.[1] ?? null;
}

/**
 * Where the service's package comes from, from nmap's own fields. Real nmap puts the Debian
 * revision in the version (`9.2p1 Debian 2+deb12u3`), Ubuntu's in `extraInfo` (`Ubuntu 3ubuntu13`)
 * or in the version (`9.18.28-0ubuntu0.22.04.1`), and adds OS CPEs.
 */
export function distroHint(input: {
  version: string | null;
  extraInfo: string | null;
  cpes: readonly Cpe[];
}): DistroHint {
  const text = [input.version, input.extraInfo].filter(Boolean).join(" ");

  const debian = new RegExp(String.raw`\bDebian[ -]+(${REVISION})`, "i").exec(text);
  if (debian) {
    return { family: "Debian", release: debianRelease(debian[1]), revision: debian[1] };
  }
  const ubuntu =
    new RegExp(String.raw`\bUbuntu[ -]+(${REVISION}ubuntu[\w.+~]*)`, "i").exec(text) ??
    new RegExp(String.raw`\d-(${REVISION}ubuntu[\w.+~]*)`, "i").exec(text);
  if (ubuntu) {
    return { family: "Ubuntu", release: ubuntuRelease(ubuntu[1]), revision: ubuntu[1] };
  }
  const deb = new RegExp(String.raw`\d-(${REVISION}[+~]deb\d+u\d+)`).exec(text);
  if (deb) return { family: "Debian", release: debianRelease(deb[1]), revision: deb[1] };

  if (/\bDebian\b/i.test(text)) return { family: "Debian", release: null, revision: null };
  if (/\bUbuntu\b/i.test(text)) return { family: "Ubuntu", release: null, revision: null };
  if (/\bAlpine\b/i.test(text)) return { family: "Alpine", release: null, revision: null };
  if (/\b(Red Hat|RHEL|CentOS|Rocky|AlmaLinux|Fedora)\b|\.el\d/i.test(text)) {
    return { family: "RedHat", release: null, revision: null };
  }

  for (const cpe of input.cpes) {
    const family = cpe.part === "o" ? OS_CPES[`${cpe.vendor}:${cpe.product}`] : undefined;
    if (family) {
      const release = family === "Debian" || family === "Ubuntu" ? cpe.version : null;
      return { family, release, revision: null };
    }
  }
  return NO_DISTRO;
}
