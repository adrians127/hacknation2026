import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { IdParams } from "@hacknation/contracts/common/common.schema";
import type { Target, UpdateTargetBody } from "@hacknation/contracts/targets/targets.schema";

import { mockError, mockResponse } from "@/api/mock";
import { mockTargets } from "@/features/targets/api/mocks";

// MOCK: api.useMutation("patch", "/targets/{id}", { onSuccess })
export function useUpdateTarget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ params, body }: { params: { path: IdParams }; body: UpdateTargetBody }): Promise<Target> => {
      const target = mockTargets.find(params.path.id);
      return target ? mockResponse(mockTargets.update(target, body)) : mockError(404, "Target not found");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["get", "/targets"] }),
  });
}
