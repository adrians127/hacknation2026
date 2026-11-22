import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";

export function useUpdateTarget() {
  const queryClient = useQueryClient();
  return api.useMutation("patch", "/targets/{id}", {
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["get", "/targets"] }),
  });
}
