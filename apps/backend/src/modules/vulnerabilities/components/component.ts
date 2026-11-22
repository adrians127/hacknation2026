import {
  isUsableVersion,
  joinedVersion,
  parseCpe,
  type Cpe,
} from "~backend/modules/vulnerabilities/cpe/cpe";
import {
  DISTRO_PLATFORM,
  distroHint,
  type DistroHint,
} from "~backend/modules/vulnerabilities/components/distro-hint";

/** One piece of software on a service, as the scanner identified it: what matchers look up. */
export interface Component {
  cpe: Cpe;
  /** Comparable version, or `null` when the scan gave none (matches become `potential`). */
  version: string | null;
  distro: DistroHint;
  /** OS and hardware CPEs of the service, plus the distribution's: for NVD platform conditions. */
  platforms: Cpe[];
}

/** The raw nmap fields of a service's newest observation. */
export interface ServiceIdentity {
  cpe: readonly string[];
  version: string | null;
  extraInfo: string | null;
}

/**
 * Application CPEs always become components; OS and hardware CPEs only with a version (a bare
 * `cpe:/o:linux:linux_kernel` would match every kernel CVE). Matching uses nmap's data only:
 * user corrections of product or version do not change it.
 */
export function componentsOf(service: ServiceIdentity): Component[] {
  const cpes = service.cpe.flatMap((name) => parseCpe(name) ?? []);
  const distro = distroHint({ version: service.version, extraInfo: service.extraInfo, cpes });
  const platforms = cpes.filter((cpe) => cpe.part !== "a");
  if (distro.family) {
    const { vendor, product } = DISTRO_PLATFORM[distro.family];
    platforms.push({ part: "o", vendor, product, version: distro.release, update: null });
  }

  return cpes.flatMap((cpe) => {
    const raw = joinedVersion(cpe);
    const version = isUsableVersion(raw) ? raw : null;
    if (cpe.part !== "a" && version === null) return [];
    return [{ cpe, version, distro, platforms }];
  });
}

/** Two services with the same key get the same verdicts: evaluated once per rematch. */
export function componentKey(component: Component): string {
  const { cpe, version, distro, platforms } = component;
  return JSON.stringify([
    cpe.part,
    cpe.vendor,
    cpe.product,
    version,
    distro.family,
    distro.release,
    distro.revision,
    platforms.map((platform) => [
      platform.part,
      platform.vendor,
      platform.product,
      platform.version,
    ]),
  ]);
}
