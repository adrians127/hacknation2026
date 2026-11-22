import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";

export function useCreateMapping() {
  const queryClient = useQueryClient();
  return api.useMutation("post", "/vulnerabilities/mappings", {
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["get", "/vulnerabilities/mappings"] }),
  });
}
