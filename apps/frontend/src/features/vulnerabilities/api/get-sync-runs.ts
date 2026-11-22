import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";

export const useSyncRuns = (sourceId: string) =>
  useQuery(
    api.queryOptions("get", "/vulnerabilities/sources/{id}/runs", {
      params: { path: { id: sourceId } },
    }),
  );
