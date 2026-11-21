import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";

export function useDeleteMapping() {
  const queryClient = useQueryClient();
  return api.useMutation("delete", "/vulnerabilities/mappings/{id}", {
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["get", "/vulnerabilities/mappings"] }),
  });
}
