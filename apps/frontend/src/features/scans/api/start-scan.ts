import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { Scan } from "@subsurf/contracts/scans/scans.schema";

import { mockResponse } from "@/api/mock";
import { mockScans } from "@/features/scans/api/mocks";

// MOCK: api.useMutation("post", "/scans", { onSuccess })
export function useStartScan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (): Promise<Scan> => mockResponse(mockScans.start()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["get", "/scans"] }),
  });
}
