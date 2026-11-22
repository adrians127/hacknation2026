import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";

export function useDeleteTarget() {
  const queryClient = useQueryClient();
  return api.useMutation("delete", "/targets/{id}", {
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["get", "/targets"] }),
  });
}
