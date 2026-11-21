import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { IdParams } from "@hacknation/contracts/common/common.schema";

import { mockError, mockResponse } from "@/api/mock";
import { mockTargets } from "@/features/targets/api/mocks";

// MOCK: api.useMutation("delete", "/targets/{id}", { onSuccess })
export function useDeleteTarget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ params }: { params: { path: IdParams } }): Promise<void> => {
      const target = mockTargets.find(params.path.id);
      if (!target) return mockError(404, "Target not found");
      mockTargets.remove(target);
      return mockResponse(undefined);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["get", "/targets"] }),
  });
}
