import { RE2JS } from "re2js";
import { ZodError } from "zod";

import type {
  SignatureCategory,
  SignatureConfidence,
  SignatureEvidence,
  SignatureSeverity,
  SignatureTarget,
} from "@subsurf/contracts/signatures/detection.schema";
import type {
  SignatureCondition,
  SignatureDefinition,
  SignatureMatcher,
} from "@subsurf/contracts/signatures/signatures.schema";
import type { HttpEndpoint } from "@subsurf/contracts/workers/worker-result.schema";

/** Part of every scan's `setHash`: bump it when matching changes, so every scan is evaluated again. */
export const ENGINE_VERSION = 1;

/** The page is searched up to here; httpx may keep up to 16 MiB. */
export const BODY_SEARCH_LIMIT = 256 * 1024;
/** RE2 program size above which a pattern is refused as too costly. */
const PROGRAM_SIZE_MAX = 2000;
const EVIDENCE_MAX = 10;
const CONTEXT_CHARS = 40;
const EVIDENCE_CHARS = 160;
const VERSION_MAX = 64;

/** What the engine reads of one service in one scan: nmap's own fields, not users' corrections. */
export interface SignatureInput {
  port: number;
  service: {
    name: string | null;
    product: string | null;
    version: string | null;
    extraInfo: string | null;
    cpe: readonly string[];
  };
  banner: string | null;
  http: readonly HttpEndpoint[];
}

export interface SignatureMeta {
  id: string;
  key: string | null;
  name: string;
  category: SignatureCategory;
  product: string | null;
  severity: SignatureSeverity | null;
  confidence: SignatureConfidence;
}

export interface ServiceDetection {
  signature: SignatureMeta;
  confidence: SignatureConfidence;
  version: string | null;
  /** Distinct kinds of conditions that matched (never `port`). */
  sources: SignatureTarget[];
  evidence: SignatureEvidence[];
}

interface Found {
  index: number;
  length: number;
}

type TextTest = (text: string) => Found | null;

interface Hit {
  target: SignatureTarget;
  evidence: SignatureEvidence;
  version: string | null;
}

type ServiceCheck = (input: SignatureInput) => Hit | null;
type EndpointCheck = (endpoint: HttpEndpoint) => Hit | null;

interface CompiledDefinition {
  match: SignatureDefinition["match"];
  ports: readonly (readonly number[])[];
  service: readonly ServiceCheck[];
  endpoint: readonly EndpointCheck[];
}

export interface CompiledSignature {
  meta: SignatureMeta;
  definition: CompiledDefinition;
  probePaths: readonly string[];
}

/** A pattern RE2 refuses, with where it is in the definition. */
export class SignaturePatternError extends Error {
  readonly path: (string | number)[];

  constructor(path: (string | number)[], message: string) {
    super(message);
    this.name = "SignaturePatternError";
    this.path = path;
  }
}

function compileRegex(pattern: string, caseSensitive: boolean, path: (string | number)[]): RE2JS {
  let regex: RE2JS;
  try {
    regex = RE2JS.compile(pattern, caseSensitive ? 0 : RE2JS.CASE_INSENSITIVE);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new SignaturePatternError(path, `Invalid regular expression: ${reason}`);
  }
  if (regex.programSize() > PROGRAM_SIZE_MAX) {
    throw new SignaturePatternError(path, "The regular expression is too complex");
  }
  return regex;
}

function compileMatcher(matcher: SignatureMatcher, path: (string | number)[]): TextTest {
  const caseSensitive = matcher.caseSensitive ?? false;
  if (matcher.op === "regex") {
    const regex = compileRegex(matcher.value, caseSensitive, [...path, "value"]);
    return (text) => {
      const match = regex.matcher(text);
      return match.find() ? { index: match.start(), length: match.end() - match.start() } : null;
    };
  }
  const value = caseSensitive ? matcher.value : matcher.value.toLowerCase();
  const fold = (text: string) => (caseSensitive ? text : text.toLowerCase());
  if (matcher.op === "equals") {
    return (text) => (fold(text) === value ? { index: 0, length: text.length } : null);
  }
  if (matcher.op === "prefix") {
    return (text) => (fold(text).startsWith(value) ? { index: 0, length: value.length } : null);
  }
  return (text) => {
    const index = fold(text).indexOf(value);
    return index < 0 ? null : { index, length: value.length };
  };
}

type VersionTest = (text: string) => string | null;

function compileVersion(pattern: string | undefined, path: (string | number)[]): VersionTest {
  if (pattern === undefined) return () => null;
  const regex = compileRegex(pattern, false, [...path, "version"]);
  if (regex.groupCount() < 1) {
    throw new SignaturePatternError([...path, "version"], "The version pattern needs a capture group");
  }
  return (text) => {
    const match = regex.matcher(text);
    const value = match.find() ? match.group(1) : null;
    if (value === null) return null;
    const version = value.trim();
    return /\d/.test(version) && version.length <= VERSION_MAX ? version : null;
  };
}

const clean = (text: string) => text.replaceAll(/\p{Cc}+/gu, " ");

const cap = (value: string) =>
  value.length > EVIDENCE_CHARS ? `${value.slice(0, EVIDENCE_CHARS - 1)}…` : value;

/** The match with a little context on each side. */
function excerpt(text: string, found: Found): string {
  const start = Math.max(0, found.index - CONTEXT_CHARS);
  const end = Math.min(text.length, found.index + Math.min(found.length, EVIDENCE_CHARS) + CONTEXT_CHARS);
  const value = clean(text.slice(start, end)).trim();
  return cap(`${start > 0 ? "…" : ""}${value}${end < text.length ? "…" : ""}`);
}

const short = (text: string) => cap(clean(text).trim());

const SERVICE_FIELDS = {
  name: (input: SignatureInput) => (input.service.name === null ? [] : [input.service.name]),
  product: (input: SignatureInput) => (input.service.product === null ? [] : [input.service.product]),
  version: (input: SignatureInput) => (input.service.version === null ? [] : [input.service.version]),
  extraInfo: (input: SignatureInput) =>
    input.service.extraInfo === null ? [] : [input.service.extraInfo],
  cpe: (input: SignatureInput) => [...input.service.cpe],
} as const;

function compileCondition(
  condition: SignatureCondition,
  path: (string | number)[],
): { service?: ServiceCheck; endpoint?: EndpointCheck; ports?: readonly number[] } {
  switch (condition.target) {
    case "port":
      return { ports: condition.ports };
    case "banner": {
      const test = compileMatcher(condition.value, [...path, "value"]);
      const version = compileVersion(condition.version, path);
      return {
        service: ({ banner }) => {
          const found = banner === null ? null : test(banner);
          if (banner === null || found === null) return null;
          return {
            target: "banner",
            evidence: { target: "banner", url: null, key: null, value: excerpt(banner, found) },
            version: version(banner),
          };
        },
      };
    }
    case "service": {
      const test = compileMatcher(condition.value, [...path, "value"]);
      const version = compileVersion(condition.version, path);
      const values = SERVICE_FIELDS[condition.field];
      return {
        service: (input) => {
          for (const value of values(input)) {
            if (test(value) === null) continue;
            return {
              target: "service",
              evidence: { target: "service", url: null, key: condition.field, value: short(value) },
              version: version(value),
            };
          }
          return null;
        },
      };
    }
    case "header": {
      const name = compileMatcher(condition.name, [...path, "name"]);
      const value = condition.value ? compileMatcher(condition.value, [...path, "value"]) : null;
      const version = compileVersion(condition.version, path);
      return {
        endpoint: (endpoint) => {
          for (const header of endpoint.headers) {
            if (name(header.name.toLowerCase()) === null) continue;
            const found = value === null ? { index: 0, length: 0 } : value(header.value);
            if (found === null) continue;
            return {
              target: "header",
              evidence: {
                target: "header",
                url: endpoint.url,
                key: header.name.toLowerCase(),
                value: value === null ? short(header.value) : excerpt(header.value, found),
              },
              version: version(header.value),
            };
          }
          return null;
        },
      };
    }
    case "cookie": {
      const name = compileMatcher(condition.name, [...path, "name"]);
      return {
        endpoint: (endpoint) => {
          const cookie = endpoint.cookies.find((candidate) => name(candidate.name) !== null);
          if (!cookie) return null;
          return {
            target: "cookie",
            evidence: { target: "cookie", url: endpoint.url, key: cookie.name, value: short(cookie.name) },
            version: null,
          };
        },
      };
    }
    case "title": {
      const test = compileMatcher(condition.value, [...path, "value"]);
      const version = compileVersion(condition.version, path);
      return {
        endpoint: ({ title, url }) => {
          const found = title === null ? null : test(title);
          if (title === null || found === null) return null;
          return {
            target: "title",
            evidence: { target: "title", url, key: null, value: short(title) },
            version: version(title),
          };
        },
      };
    }
    case "body": {
      const test = compileMatcher(condition.value, [...path, "value"]);
      const version = compileVersion(condition.version, path);
      return {
        endpoint: ({ body, url }) => {
          const content = body?.content?.slice(0, BODY_SEARCH_LIMIT) ?? null;
          const found = content === null ? null : test(content);
          if (content === null || found === null) return null;
          return {
            target: "body",
            evidence: { target: "body", url, key: null, value: excerpt(content, found) },
            version: version(content),
          };
        },
      };
    }
    case "favicon": {
      const hashes = new Set(condition.mmh3);
      return {
        endpoint: ({ favicon }) => {
          if (favicon === null || !hashes.has(favicon.mmh3)) return null;
          return {
            target: "favicon",
            evidence: { target: "favicon", url: favicon.url, key: null, value: String(favicon.mmh3) },
            version: null,
          };
        },
      };
    }
    default: {
      // `probe`, the last kind.
      const statuses = new Set(condition.status);
      const title = condition.title ? compileMatcher(condition.title, [...path, "title"]) : null;
      const location = condition.location
        ? compileMatcher(condition.location, [...path, "location"])
        : null;
      const version = compileVersion(condition.version, path);
      return {
        endpoint: (endpoint) => {
          for (const probe of endpoint.probes) {
            if (probe.path !== condition.path) continue;
            if (probe.statusCode === null || !statuses.has(probe.statusCode)) continue;
            if (title !== null && (probe.title === null || title(probe.title) === null)) continue;
            if (location !== null && (probe.location === null || location(probe.location) === null)) {
              continue;
            }
            const answer = [String(probe.statusCode), probe.title ?? probe.location ?? ""];
            return {
              target: "probe",
              evidence: {
                target: "probe",
                url: endpoint.url,
                key: probe.path,
                value: short(answer.filter(Boolean).join(" ")),
              },
              version: probe.title === null ? null : version(probe.title),
            };
          }
          return null;
        },
      };
    }
  }
}

/** Compiles one definition; throws `SignaturePatternError` for a pattern RE2 refuses. */
export function compileDefinition(definition: SignatureDefinition): CompiledDefinition {
  const ports: (readonly number[])[] = [];
  const service: ServiceCheck[] = [];
  const endpoint: EndpointCheck[] = [];
  for (const [index, condition] of definition.conditions.entries()) {
    const compiled = compileCondition(condition, ["definition", "conditions", index]);
    if (compiled.ports) ports.push(compiled.ports);
    if (compiled.service) service.push(compiled.service);
    if (compiled.endpoint) endpoint.push(compiled.endpoint);
  }
  return { match: definition.match, ports, service, endpoint };
}

export function probePathsOf(definition: SignatureDefinition): string[] {
  return definition.conditions.flatMap((condition) =>
    condition.target === "probe" ? [condition.path] : [],
  );
}

export function compileSignature(meta: SignatureMeta, definition: SignatureDefinition): CompiledSignature {
  return { meta, definition: compileDefinition(definition), probePaths: probePathsOf(definition) };
}

/** Throws a `ZodError` (a normal 400) when a pattern of the definition is not valid RE2. */
export function assertValidPatterns(definition: SignatureDefinition): void {
  try {
    compileDefinition(definition);
  } catch (error) {
    if (!(error instanceof SignaturePatternError)) throw error;
    const [, , index] = error.path;
    throw new ZodError([
      {
        code: "custom",
        path: error.path,
        message: `Condition ${Number(index) + 1}: ${error.message}`,
        input: undefined,
      },
    ]);
  }
}

const EXPLICIT_SOURCES = new Set<SignatureTarget>(["header", "favicon", "banner", "service"]);
const CONFIDENCE_RANK: Record<SignatureConfidence, number> = { low: 0, medium: 1, high: 2 };

/** Two independent kinds of evidence → high; one explicit kind (a header, nmap) → medium. */
export function sourceConfidence(sources: Iterable<SignatureTarget>): SignatureConfidence {
  const distinct = new Set(sources);
  if (distinct.size >= 2) return "high";
  return [...distinct].some((source) => EXPLICIT_SOURCES.has(source)) ? "medium" : "low";
}

export function maxConfidence(...values: SignatureConfidence[]): SignatureConfidence {
  return values.reduce((best, value) => (CONFIDENCE_RANK[value] > CONFIDENCE_RANK[best] ? value : best), "low");
}

function endpointHits(definition: CompiledDefinition, endpoint: HttpEndpoint): (Hit | null)[] {
  return definition.endpoint.map((check) => check(endpoint));
}

/** The hits that make the definition match the service, or `null` when it does not. */
function matchDefinition(definition: CompiledDefinition, input: SignatureInput): Hit[] | null {
  if (!definition.ports.every((ports) => ports.includes(input.port))) return null;
  const serviceHits = definition.service.map((check) => check(input));

  if (definition.match === "all") {
    if (serviceHits.some((hit) => hit === null)) return null;
    const hits = serviceHits.filter((hit) => hit !== null);
    if (definition.endpoint.length === 0) return hits;
    const endpoints = input.http
      .map((endpoint) => endpointHits(definition, endpoint))
      .filter((found) => found.every((hit) => hit !== null));
    if (endpoints.length === 0) return null;
    return [...hits, ...endpoints.flat().filter((hit) => hit !== null)];
  }

  const hits = [
    ...serviceHits,
    ...input.http.flatMap((endpoint) => endpointHits(definition, endpoint)),
  ].filter((hit) => hit !== null);
  return hits.length > 0 ? hits : null;
}

function longest(values: readonly (string | null)[]): string | null {
  return values.filter((value) => value !== null).toSorted((a, b) => b.length - a.length)[0] ?? null;
}

export function evaluateSignature(
  signature: CompiledSignature,
  input: SignatureInput,
): ServiceDetection | null {
  const hits = matchDefinition(signature.definition, input);
  if (hits === null) return null;
  const sources = [...new Set(hits.map((hit) => hit.target))].toSorted();
  return {
    signature: signature.meta,
    confidence: maxConfidence(signature.meta.confidence, sourceConfidence(sources)),
    version: longest(hits.map((hit) => hit.version)),
    sources,
    evidence: hits.slice(0, EVIDENCE_MAX).map((hit) => hit.evidence),
  };
}

/** Every signature of the set that matches the service, in the set's order. */
export function evaluateService(
  signatures: readonly CompiledSignature[],
  input: SignatureInput,
): ServiceDetection[] {
  return signatures.flatMap((signature) => {
    const detection = evaluateSignature(signature, input);
    return detection === null ? [] : [detection];
  });
}
