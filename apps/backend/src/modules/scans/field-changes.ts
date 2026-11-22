import type { FieldChange, FieldChangeKind } from "@subsurf/contracts/scans/scan-results.schema";

import {
  endpointKey,
  type ComparableEndpoint,
  type ComparablePort,
} from "~backend/modules/results/comparable";

type Endpoint = FieldChange["endpoint"];

const byName = (a: string, b: string) => a.localeCompare(b);

const text = (value: string | number | boolean | null | undefined): string | null =>
  value === null || value === undefined ? null : String(value);

function change(
  field: FieldChangeKind,
  before: string | null,
  after: string | null,
  endpoint: Endpoint = null,
  key: string | null = null,
): FieldChange[] {
  return before === after ? [] : [{ field, endpoint, key, before, after }];
}

/** One change per key whose value differs (absent counts as `null`). */
function recordChanges<T extends string | number | null>(
  field: FieldChangeKind,
  before: Record<string, T>,
  after: Record<string, T>,
  endpoint: Endpoint,
): FieldChange[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].toSorted(byName);
  return keys.flatMap((key) => change(field, text(before[key]), text(after[key]), endpoint, key));
}

/** Security headers count by presence; the value is shown, never compared. */
function presenceChanges(
  before: Record<string, string>,
  after: Record<string, string>,
  endpoint: Endpoint,
): FieldChange[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].toSorted(byName);
  return keys.flatMap((key) =>
    key in before === key in after
      ? []
      : [
          {
            field: "http.securityHeader" as const,
            endpoint,
            key,
            before: before[key] ?? null,
            after: after[key] ?? null,
          },
        ],
  );
}

/** Cookies that appeared or went (`http.cookie`), and flags of kept ones (`http.cookieFlags`). */
function cookieChanges(
  before: Record<string, string>,
  after: Record<string, string>,
  endpoint: Endpoint,
): FieldChange[] {
  return recordChanges("http.cookie", before, after, endpoint).map((entry) =>
    entry.before !== null && entry.after !== null ? { ...entry, field: "http.cookieFlags" } : entry,
  );
}

function certChanges(
  before: ComparableEndpoint["cert"],
  after: ComparableEndpoint["cert"],
  endpoint: Endpoint,
): FieldChange[] {
  if (before?.sha256 === after?.sha256) return [];
  return [
    ...change("tls.cert", text(before?.sha256), text(after?.sha256), endpoint),
    ...(before && after
      ? [
          ...change("tls.issuer", before.issuer, after.issuer, endpoint),
          ...change("tls.expiry", before.expiresOn, after.expiresOn, endpoint),
          ...change("tls.selfSigned", text(before.selfSigned), text(after.selfSigned), endpoint),
        ]
      : []),
  ];
}

function endpointChanges(before: ComparableEndpoint, after: ComparableEndpoint): FieldChange[] {
  const endpoint = { scheme: after.scheme, vhost: after.vhost };
  return [
    ...change("http.status", text(before.statusCode), text(after.statusCode), endpoint),
    ...change("http.title", before.title, after.title, endpoint),
    ...change("http.redirect", before.finalPath, after.finalPath, endpoint),
    ...recordChanges("http.header", before.headers, after.headers, endpoint),
    ...presenceChanges(before.securityHeaders, after.securityHeaders, endpoint),
    ...cookieChanges(before.cookies, after.cookies, endpoint),
    ...certChanges(before.cert, after.cert, endpoint),
    ...change("tls.version", before.tlsVersion, after.tlsVersion, endpoint),
    // mmh3 is what Shodan and similar tools search by; sha256 decides.
    ...(before.favicon?.sha256 === after.favicon?.sha256
      ? []
      : [
          {
            field: "http.favicon" as const,
            endpoint,
            key: null,
            before: text(before.favicon?.mmh3),
            after: text(after.favicon?.mmh3),
          },
        ]),
    ...recordChanges("http.probe", before.probes, after.probes, endpoint),
  ];
}

/** What differs between two observations of one port, in display order. */
export function fieldChanges(before: ComparablePort, after: ComparablePort): FieldChange[] {
  const service = (
    field: FieldChangeKind,
    pick: (value: NonNullable<ComparablePort["service"]>) => string | null,
  ) => change(field, before.service && pick(before.service), after.service && pick(after.service));

  const endpointsBefore = new Map(before.http.map((endpoint) => [endpointKey(endpoint), endpoint]));
  const endpointsAfter = new Map(after.http.map((endpoint) => [endpointKey(endpoint), endpoint]));
  const keys = [...new Set([...endpointsBefore.keys(), ...endpointsAfter.keys()])].toSorted(byName);
  const tlsBefore = new Map(before.tls.map((entry) => [entry.vhost ?? "", entry]));
  const tlsAfter = new Map(after.tls.map((entry) => [entry.vhost ?? "", entry]));
  const tlsKeys = [...new Set([...tlsBefore.keys(), ...tlsAfter.keys()])].toSorted(byName);

  return [
    ...service("service.name", (value) => value.name),
    ...service("service.product", (value) => value.product),
    ...service("service.version", (value) => value.version),
    ...service("service.extraInfo", (value) => value.extraInfo),
    ...service("service.cpe", (value) => value.cpe.join(" ") || null),
    ...change("ssh.hostKey", before.sshHostKey, after.sshHostKey),
    ...tlsKeys.flatMap((key) => {
      const earlier = tlsBefore.get(key);
      const later = tlsAfter.get(key);
      if (!earlier || !later)
        return change("tls.endpoint", earlier ? "observed" : null, later ? "observed" : null, null, key);
      return [
        ...change("tls.version", earlier.version, later.version, null, key),
        ...change("tls.cipher", earlier.cipher, later.cipher, null, key),
        ...change("tls.cert", earlier.certSha256, later.certSha256, null, key),
      ];
    }),
    ...keys.flatMap((key) => {
      const earlier = endpointsBefore.get(key);
      const later = endpointsAfter.get(key);
      if (earlier && later) return endpointChanges(earlier, later);
      const only = later ?? earlier;
      if (!only) return [];
      return change(
        "http.endpoint",
        earlier?.url ?? null,
        later?.url ?? null,
        { scheme: only.scheme, vhost: only.vhost },
      );
    }),
  ];
}

/** Names the host answered to in one scan and not the other. */
export function hostnameChanges(
  before: readonly string[],
  after: readonly string[],
): FieldChange[] {
  const earlier = new Set(before);
  const later = new Set(after);
  return [
    ...[...earlier].filter((name) => !later.has(name)).map((name) => ({ name, gone: true })),
    ...[...later].filter((name) => !earlier.has(name)).map((name) => ({ name, gone: false })),
  ]
    .toSorted((a, b) => a.name.localeCompare(b.name))
    .map(({ name, gone }) => ({
      field: "host.hostname" as const,
      endpoint: null,
      key: null,
      before: gone ? name : null,
      after: gone ? null : name,
    }));
}
