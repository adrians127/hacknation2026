import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";
import { invalidateAccessQueries } from "@/lib/auth/invalidate-access-queries";

export function useUpdateRole() {
  const queryClient = useQueryClient();
  return api.useMutation("patch", "/roles/{id}", {
    onSuccess: () => invalidateAccessQueries(queryClient),
  });
}
