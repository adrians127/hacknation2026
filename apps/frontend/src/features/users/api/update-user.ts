import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";
import { invalidateAccessQueries } from "@/lib/auth/invalidate-access-queries";

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return api.useMutation("patch", "/users/{id}", {
    onSuccess: () => invalidateAccessQueries(queryClient),
  });
}
