import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";

/** Deletes a scan. The other scans are compared with each other afterwards, so they reload. */
export function useDeleteScan() {
  const queryClient = useQueryClient();
  return api.useMutation("delete", "/scans/{id}", {
    onSuccess: (_data, { params }) =>
      queryClient.invalidateQueries({
        queryKey: ["get"],
        // Not the deleted scan's own queries: a 404 would replace the page that is still open on
        // it, and with the page its "go back to the list" would be gone.
        predicate: (query) => !JSON.stringify(query.queryKey).includes(params.path.id),
      }),
  });
}
