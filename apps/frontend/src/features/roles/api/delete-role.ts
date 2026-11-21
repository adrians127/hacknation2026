import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";
import { invalidateAccessQueries } from "@/lib/auth/invalidate-access-queries";

export function useDeleteRole() {
  const queryClient = useQueryClient();
  return api.useMutation("delete", "/roles/{id}", {
    onSuccess: () => invalidateAccessQueries(queryClient),
  });
}
