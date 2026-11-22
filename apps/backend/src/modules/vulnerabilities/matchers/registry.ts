import { cpeMatcher } from "~backend/modules/vulnerabilities/matchers/cpe.matcher";
import type { RegisteredMatcher } from "~backend/modules/vulnerabilities/matchers/matcher";
import { packageMatcher } from "~backend/modules/vulnerabilities/matchers/package.matcher";

/** Every criterion kind a source may emit. A source with a new data model adds its matcher here. */
export const MATCHERS: readonly RegisteredMatcher[] = [cpeMatcher, packageMatcher];

const BY_KIND = new Map(MATCHERS.map((matcher) => [matcher.kind, matcher]));

export function matcherFor(kind: string): RegisteredMatcher | undefined {
  return BY_KIND.get(kind);
}
