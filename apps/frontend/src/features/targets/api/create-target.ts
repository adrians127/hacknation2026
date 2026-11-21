import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { CreateTargetBody, Target } from "@hacknation/contracts/targets/targets.schema";

import { mockError, mockResponse } from "@/api/mock";
import { mockTargets } from "@/features/targets/api/mocks";

// MOCK: api.useMutation("post", "/targets", { onSuccess })
export function useCreateTarget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ body }: { body: CreateTargetBody }): Promise<Target> =>
      mockTargets.hasValue(body.value)
        ? mockError(409, "Target already exists", "TARGET_EXISTS")
        : mockResponse(mockTargets.add(body)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["get", "/targets"] }),
  });
}
