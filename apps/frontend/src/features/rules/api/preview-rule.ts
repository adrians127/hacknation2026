import { keepPreviousData, useQuery } from "@tanstack/react-query";

import type { RulePreviewBody } from "@subsurf/contracts/rules/rules.schema";

import { api } from "@/api/client";

/** Read-only, so a query: the key follows the definition and older answers stay while typing. */
export const useRulePreview = (body: RulePreviewBody | null) =>
  useQuery({
    ...api.queryOptions("post", "/rules/preview", { body: body ?? { definition: PLACEHOLDER } }),
    enabled: body !== null,
    placeholderData: keepPreviousData,
  });

const PLACEHOLDER: RulePreviewBody["definition"] = {
  kind: "change_priority",
  scope: { ranges: [], hostTags: [], ports: [], products: [] },
  condition: { rows: [], changes: [], fields: [], keys: [], lifecycles: [], priorities: [] },
  action: { type: "mute" },
};
