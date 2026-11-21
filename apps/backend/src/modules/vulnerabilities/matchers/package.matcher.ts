import { z } from "zod";

import type { MatchReason } from "@subsurf/contracts/vulnerabilities/vulnerabilities.schema";

import type { Component } from "~backend/modules/vulnerabilities/components/component";
import {
  affected,
  defineMatcher,
  NOT_AFFECTED,
  UNKNOWN,
  type Evaluation,
} from "~backend/modules/vulnerabilities/matchers/matcher";
import { upstreamOfApk } from "~backend/modules/vulnerabilities/versioning/apk";
import { upstreamOfDpkg } from "~backend/modules/vulnerabilities/versioning/dpkg";
import { comparatorFor, type VersionComparator } from "~backend/modules/vulnerabilities/versioning";

/** One OSV range event: exactly one key is set. */
const RangeEventSchema = z.object({
  introduced: z.string().optional(),
  fixed: z.string().optional(),
  last_affected: z.string().optional(),
  limit: z.string().optional(),
});

const PackageRangeSchema = z.object({
  type: z.enum(["SEMVER", "ECOSYSTEM"]),
  events: z.array(RangeEventSchema),
});

/** One OSV `affected` entry: a package in one ecosystem (and distribution release). */
const PackageEntrySchema = z.object({
  /** Without the release suffix: `Debian`, `Maven`. */
  ecosystem: z.string(),
  /** `12` for `Debian:12`, `v3.20` for `Alpine:v3.20`; `null` for language ecosystems. */
  release: z.string().nullable(),
  versions: z.array(z.string()),
  ranges: z.array(PackageRangeSchema),
});

export const PackageCriterionDataSchema = z.object({ entries: z.array(PackageEntrySchema) });

export type RangeEvent = z.infer<typeof RangeEventSchema>;
export type PackageRange = z.infer<typeof PackageRangeSchema>;
export type PackageEntry = z.infer<typeof PackageEntrySchema>;
export type PackageCriterionData = z.infer<typeof PackageCriterionDataSchema>;

export const PACKAGE_KIND = "package";

/** Ecosystems that are distributions: they apply only to services running on them. */
export const DISTRO_ECOSYSTEMS = new Set(["Debian", "Ubuntu", "Alpine"]);

const UPSTREAM: Record<string, (version: string) => string> = {
  Debian: upstreamOfDpkg,
  Ubuntu: upstreamOfDpkg,
  Alpine: upstreamOfApk,
};

export function packageMatchKey(ecosystem: string, packageName: string): string {
  return `pkg:${ecosystem}:${packageName}`;
}

const isZero = (version: string) => version === "0";

const bound = (event: RangeEvent) =>
  event.introduced ?? event.fixed ?? event.last_affected ?? event.limit ?? "0";

/** OSV's evaluation: walk the events in version order, toggling "affected". */
export function inOsvRange(
  version: string,
  range: PackageRange,
  compare: VersionComparator,
): boolean {
  const events = range.events
    .filter((event) => event.limit === undefined)
    .toSorted((a, b) => {
      const x = bound(a);
      const y = bound(b);
      if (isZero(x) || isZero(y)) return Number(!isZero(x)) - Number(!isZero(y));
      return compare(x, y);
    });
  let isAffected = false;
  for (const event of events) {
    if (event.introduced !== undefined) {
      if (isZero(event.introduced) || compare(version, event.introduced) >= 0) isAffected = true;
    } else if (event.fixed !== undefined) {
      if (compare(version, event.fixed) >= 0) isAffected = false;
    } else if (event.last_affected !== undefined) {
      if (compare(version, event.last_affected) > 0) isAffected = false;
    }
  }
  return isAffected;
}

function entryAffects(entry: PackageEntry, version: string, compare: VersionComparator): boolean {
  if (entry.versions.some((candidate) => compare(version, candidate) === 0)) return true;
  return entry.ranges.some((range) =>
    inOsvRange(version, range, comparatorFor(entry.ecosystem, range.type)),
  );
}

/** Compares upstream versions only: for a distribution package whose revision the scan missed. */
function upstreamOnly(entry: PackageEntry, upstream: (v: string) => string): PackageEntry {
  return {
    ...entry,
    versions: entry.versions.map(upstream),
    ranges: entry.ranges.map((range) => ({
      ...range,
      events: range.events.map((event) =>
        Object.fromEntries(
          Object.entries(event).map(([key, value]) => [
            key,
            isZero(value) ? value : upstream(value),
          ]),
        ),
      ),
    })),
  };
}

function evaluateDistro(
  entries: PackageEntry[],
  ecosystem: string,
  component: Component,
): Evaluation {
  const { distro, version } = component;
  if (version === null) {
    return entries.length > 0 ? affected("potential", ["version_unknown"]) : UNKNOWN;
  }
  const compare = comparatorFor(ecosystem, "ECOSYSTEM");
  const forRelease =
    distro.release === null ? [] : entries.filter((entry) => entry.release === distro.release);

  if (forRelease.length > 0 && distro.revision !== null) {
    const packageVersion = `${version}-${distro.revision}`;
    return forRelease.some((entry) => entryAffects(entry, packageVersion, compare))
      ? affected("confirmed", [], true)
      : { ...NOT_AFFECTED, distroPrecise: true };
  }
  if (distro.release !== null && forRelease.length === 0) return UNKNOWN;

  // Release or revision unknown: the upstream version is all there is to compare.
  const upstream = UPSTREAM[ecosystem] ?? ((v: string) => v);
  const candidates = forRelease.length > 0 ? forRelease : entries;
  const reasons: MatchReason[] = ["distro_backport_possible"];
  return candidates.some((entry) => entryAffects(upstreamOnly(entry, upstream), version, compare))
    ? affected("potential", reasons)
    : NOT_AFFECTED;
}

function evaluateLanguage(
  entries: PackageEntry[],
  ecosystem: string,
  component: Component,
): Evaluation {
  if (entries.length === 0) return UNKNOWN;
  if (component.version === null) return affected("potential", ["version_unknown"]);
  const compare = comparatorFor(ecosystem, "ECOSYSTEM");
  return entries.some((entry) => entryAffects(entry, component.version!, compare))
    ? affected("confirmed")
    : NOT_AFFECTED;
}

/**
 * OSV-style package applicability. A component reaches packages through PackageMapping
 * (`eclipse:jetty` → Maven `org.eclipse.jetty:jetty-server`); distribution ecosystems only when
 * the service runs on that distribution.
 */
export const packageMatcher = defineMatcher<PackageCriterionData>({
  kind: PACKAGE_KIND,
  dataSchema: PackageCriterionDataSchema,

  keysFor(component, context) {
    if (component.cpe.part !== "a") return [];
    const targets = context.packages.get(`${component.cpe.vendor}:${component.cpe.product}`) ?? [];
    return targets
      .filter(
        (target) =>
          !DISTRO_ECOSYSTEMS.has(target.ecosystem) || target.ecosystem === component.distro.family,
      )
      .map((target) => packageMatchKey(target.ecosystem, target.packageName));
  },

  evaluate(data, matchKey, component) {
    const ecosystem = matchKey.split(":")[1] ?? "";
    const entries = data.entries.filter(
      (entry) => entry.ecosystem === ecosystem,
    );
    return DISTRO_ECOSYSTEMS.has(ecosystem)
      ? evaluateDistro(entries, ecosystem, component)
      : evaluateLanguage(entries, ecosystem, component);
  },
});
