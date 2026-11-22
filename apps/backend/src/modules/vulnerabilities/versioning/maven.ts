import { createComparator } from "~backend/modules/vulnerabilities/versioning/generic";

/** Maven ComparableVersion qualifiers: alpha < beta < milestone < rc < snapshot < release < sp. */
export const compareMaven = createComparator({
  pre: ["alpha", "a", "beta", "b", "milestone", "m", "rc", "cr", "snapshot"],
  post: ["sp"],
  release: ["ga", "final", "release"],
});
