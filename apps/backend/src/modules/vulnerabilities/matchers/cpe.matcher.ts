import { z } from "zod";

import type { MatchReason } from "@subsurf/contracts/vulnerabilities/vulnerabilities.schema";

import type { Component } from "~backend/modules/vulnerabilities/components/component";
import { cpeMatchKey } from "~backend/modules/vulnerabilities/cpe/cpe";
import {
  affected,
  defineMatcher,
  NOT_AFFECTED,
  type Evaluation,
} from "~backend/modules/vulnerabilities/matchers/matcher";
import { compareGeneric } from "~backend/modules/vulnerabilities/versioning";

const CpePlatformSchema = z.object({
  part: z.enum(["a", "o", "h"]),
  vendor: z.string(),
  product: z.string(),
  version: z.string().nullable(),
});

/** One NVD `cpeMatch` (or several collapsed): which versions of the key's product are affected. */
const CpeConditionSchema = z.object({
  /** Every version. */
  any: z.literal(true).optional(),
  /** Exact versions, NVD version and update joined (`9.6p1`). */
  versions: z.array(z.string()).optional(),
  startIncluding: z.string().optional(),
  startExcluding: z.string().optional(),
  endIncluding: z.string().optional(),
  endExcluding: z.string().optional(),
  /** Affected only on one of these (the other node of an NVD `AND` configuration). */
  platforms: z.array(CpePlatformSchema).optional(),
  /** The configuration negates a node: too complex to evaluate here. */
  negated: z.literal(true).optional(),
});

export const CpeCriterionDataSchema = z.object({ conditions: z.array(CpeConditionSchema) });

export type CpePlatform = z.infer<typeof CpePlatformSchema>;
export type CpeCondition = z.infer<typeof CpeConditionSchema>;
export type CpeCriterionData = z.infer<typeof CpeCriterionDataSchema>;

export const CPE_KIND = "cpe";

type ConditionResult = "affected" | "potential" | "not_affected";

function inRange(version: string, condition: CpeCondition): boolean {
  const { startIncluding, startExcluding, endIncluding, endExcluding } = condition;
  if (startIncluding !== undefined && compareGeneric(version, startIncluding) < 0) return false;
  if (startExcluding !== undefined && compareGeneric(version, startExcluding) <= 0) return false;
  if (endIncluding !== undefined && compareGeneric(version, endIncluding) > 0) return false;
  if (endExcluding !== undefined && compareGeneric(version, endExcluding) >= 0) return false;
  return true;
}

function hasRange(condition: CpeCondition): boolean {
  return [
    condition.startIncluding,
    condition.startExcluding,
    condition.endIncluding,
    condition.endExcluding,
  ].some((bound) => bound !== undefined);
}

function onPlatform(platforms: readonly CpePlatform[], component: Component): ConditionResult {
  if (component.platforms.length === 0) return "potential";
  const matches = platforms.some((required) =>
    component.platforms.some(
      (seen) =>
        seen.part === required.part &&
        seen.vendor === required.vendor &&
        seen.product === required.product &&
        (required.version === null ||
          seen.version === null ||
          compareGeneric(seen.version, required.version) === 0),
    ),
  );
  return matches ? "affected" : "not_affected";
}

function evaluateCondition(
  condition: CpeCondition,
  component: Component,
  reasons: Set<MatchReason>,
): ConditionResult {
  let result: ConditionResult;
  if (condition.any) {
    result = "affected";
  } else if (component.version === null) {
    reasons.add("version_unknown");
    result = "potential";
  } else if (condition.versions?.some((v) => compareGeneric(component.version!, v) === 0)) {
    result = "affected";
  } else if (hasRange(condition) && inRange(component.version, condition)) {
    result = "affected";
  } else {
    return "not_affected";
  }

  if (condition.negated) {
    reasons.add("platform_condition");
    return "potential";
  }
  if (condition.platforms && condition.platforms.length > 0) {
    const platform = onPlatform(condition.platforms, component);
    if (platform === "not_affected") return "not_affected";
    if (platform === "potential") {
      reasons.add("platform_condition");
      return "potential";
    }
  }
  return result;
}

/** NVD-style CPE applicability: product by key, version by exact list or range. */
export const cpeMatcher = defineMatcher<CpeCriterionData>({
  kind: CPE_KIND,
  dataSchema: CpeCriterionDataSchema,

  keysFor(component) {
    return [cpeMatchKey(component.cpe)];
  },

  evaluate({ conditions }, _matchKey, component): Evaluation {
    let best: ConditionResult = "not_affected";
    const reasons = new Set<MatchReason>();
    for (const condition of conditions) {
      const conditionReasons = new Set<MatchReason>();
      const result = evaluateCondition(condition, component, conditionReasons);
      if (result === "affected") return affected("confirmed");
      if (result === "potential") {
        best = "potential";
        for (const reason of conditionReasons) reasons.add(reason);
      }
    }
    return best === "potential" ? affected("potential", [...reasons]) : NOT_AFFECTED;
  },
});
