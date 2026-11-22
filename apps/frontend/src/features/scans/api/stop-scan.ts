import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";

export function useStopScan() {
  const queryClient = useQueryClient();
  return api.useMutation("post", "/scans/{id}/stop", {
    onSuccess: async () => {
      await Promise.all(
        ["/scans", "/scans/{id}", "/scans/{id}/jobs", "/pipelines", "/pipelines/{id}"].map((path) =>
          queryClient.invalidateQueries({ queryKey: ["get", path] }),
        ),
      );
    },
  });
}
