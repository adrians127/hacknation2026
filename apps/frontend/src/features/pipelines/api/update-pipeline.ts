import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";
import { invalidatePipelineQueries } from "@/features/pipelines/api/invalidate";

export function useUpdatePipeline() {
  const queryClient = useQueryClient();
  return api.useMutation("patch", "/pipelines/{id}", {
    onSuccess: () => invalidatePipelineQueries(queryClient),
  });
}
