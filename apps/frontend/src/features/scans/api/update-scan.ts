import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";

/** Renames or annotates a scan; the list and the scan's page show it at once. */
export function useUpdateScan() {
  const queryClient = useQueryClient();
  return api.useMutation("patch", "/scans/{id}", {
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["get", "/scans"] }),
        queryClient.invalidateQueries({ queryKey: ["get", "/scans/{id}"] }),
      ]),
  });
}
