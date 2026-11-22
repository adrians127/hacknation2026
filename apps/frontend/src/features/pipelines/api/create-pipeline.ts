import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";
import { invalidatePipelineQueries } from "@/features/pipelines/api/invalidate";

export function useCreatePipeline() {
  const queryClient = useQueryClient();
  return api.useMutation("post", "/pipelines", {
    onSuccess: () => invalidatePipelineQueries(queryClient),
  });
}
