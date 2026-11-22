import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";

export function useUpdateWorker() {
  const queryClient = useQueryClient();
  return api.useMutation("patch", "/workers/{id}", {
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["get", "/workers"] });
      // Pipelines show whether each step's worker is enabled.
      await queryClient.invalidateQueries({ queryKey: ["get", "/pipelines"] });
      await queryClient.invalidateQueries({ queryKey: ["get", "/pipelines/{id}"] });
    },
  });
}
