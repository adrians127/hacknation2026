import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";
import { invalidateAccessQueries } from "@/lib/auth/invalidate-access-queries";

export function useReactivateUser() {
  const queryClient = useQueryClient();
  return api.useMutation("post", "/users/{id}/reactivate", {
    onSuccess: () => invalidateAccessQueries(queryClient),
  });
}
