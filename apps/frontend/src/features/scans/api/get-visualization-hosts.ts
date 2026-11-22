import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";

export const useVisualizationHosts = (scanId: string) =>
  useQuery(api.queryOptions("get", "/scans/{id}/visualization-hosts", {
    params: { path: { id: scanId } },
  }));
