import type { QueryClient } from "@tanstack/react-query";

/** Pipelines show their last and active run, so a run, stop or edit refreshes both lists. */
export async function invalidatePipelineQueries(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["get", "/pipelines"] }),
    queryClient.invalidateQueries({ queryKey: ["get", "/pipelines/{id}"] }),
    queryClient.invalidateQueries({ queryKey: ["get", "/scans"] }),
  ]);
}
