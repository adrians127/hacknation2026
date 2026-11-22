import { keepPreviousData, useQuery } from "@tanstack/react-query";

import type { SignaturePreviewBody } from "@subsurf/contracts/signatures/signatures.schema";

import { api } from "@/api/client";

const PLACEHOLDER: SignaturePreviewBody = {
  definition: { match: "all", conditions: [{ target: "title", value: { op: "contains", value: "-" } }] },
};

/** Read-only, so a query: the key follows the definition and older answers stay while typing. */
export const useSignaturePreview = (body: SignaturePreviewBody | null) =>
  useQuery({
    ...api.queryOptions("post", "/signatures/preview", { body: body ?? PLACEHOLDER }),
    enabled: body !== null,
    placeholderData: keepPreviousData,
    retry: false,
  });
