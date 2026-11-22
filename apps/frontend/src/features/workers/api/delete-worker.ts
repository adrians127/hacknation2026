import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";

export function useDeleteWorker() {
  const queryClient = useQueryClient();
  return api.useMutation("delete", "/workers/{id}", {
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["get", "/workers"] }),
  });
}
