import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";

/** While older scans are still evaluated in the background, the counts follow them. */
const PENDING_REFRESH_MS = 5000;

export const useSignatures = () =>
  useQuery({
    ...api.queryOptions("get", "/signatures"),
    refetchInterval: (query) =>
      (query.state.data?.evaluation.pendingScans ?? 0) > 0 ? PENDING_REFRESH_MS : false,
  });
