import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";

export function useImportTargets() {
  const queryClient = useQueryClient();
  return api.useMutation("post", "/targets/import", {
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["get", "/targets"] }),
        queryClient.invalidateQueries({ queryKey: ["get", "/scans"] }),
      ]),
  });
}
