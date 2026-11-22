import type { z } from "zod";

import type {
  MatchConfidence,
  MatchReason,
  Verdict,
} from "@subsurf/contracts/vulnerabilities/vulnerabilities.schema";

import type { Component } from "~backend/modules/vulnerabilities/components/component";

/** What a source record says is affected, for the matcher of `kind`. Stored as is (JSONB). */
export interface Criterion {
  kind: string;
  /** Version-independent lookup key, e.g. `cpe:a:openbsd:openssh`, `pkg:Debian:openssh`. */
  matchKey: string;
  data: unknown;
}

export interface Evaluation {
  verdict: Verdict;
  /** Meaningful for `affected` only. */
  confidence: MatchConfidence;
  reasons: MatchReason[];
  /**
   * A distribution's own data, compared on the exact package revision of the release the service
   * runs: the only evidence strong enough to overrule an upstream (NVD) match.
   */
  distroPrecise: boolean;
}

export interface PackageTarget {
  ecosystem: string;
  packageName: string;
}

export interface MatchContext {
  /** `vendor:product` of a CPE → the packages it is in (PackageMapping rows). */
  packages: ReadonlyMap<string, readonly PackageTarget[]>;
}

/**
 * Understands one `kind` of criterion. A source with a new data model brings a matcher; a source
 * that describes software the same way (CPE, packages) reuses an existing one.
 */
export interface CriterionMatcher<TData> {
  readonly kind: string;
  /** Validates the stored `data` (JSONB) before it is evaluated. */
  readonly dataSchema: z.ZodType<TData>;
  keysFor(component: Component, context: MatchContext): string[];
  evaluate(data: TData, matchKey: string, component: Component): Evaluation;
}

export type PreparedCriterion = (matchKey: string, component: Component) => Evaluation;

/** A matcher with its data type erased, for the registry. */
export interface RegisteredMatcher {
  readonly kind: string;
  keysFor(component: Component, context: MatchContext): string[];
  /** Validates one criterion's data once; the result evaluates it against any component. */
  prepare(data: unknown): PreparedCriterion;
}

export function defineMatcher<TData>(matcher: CriterionMatcher<TData>): RegisteredMatcher {
  return {
    kind: matcher.kind,
    keysFor: (component, context) => matcher.keysFor(component, context),
    prepare(data) {
      const parsed = matcher.dataSchema.parse(data);
      return (matchKey, component) => matcher.evaluate(parsed, matchKey, component);
    },
  };
}

export const UNKNOWN: Evaluation = {
  verdict: "unknown",
  confidence: "potential",
  reasons: [],
  distroPrecise: false,
};

export const NOT_AFFECTED: Evaluation = {
  verdict: "not_affected",
  confidence: "potential",
  reasons: [],
  distroPrecise: false,
};

export function affected(
  confidence: MatchConfidence,
  reasons: MatchReason[] = [],
  distroPrecise = false,
): Evaluation {
  return { verdict: "affected", confidence, reasons, distroPrecise };
}
