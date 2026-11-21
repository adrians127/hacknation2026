import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";
import { invalidateAccessQueries } from "@/lib/auth/invalidate-access-queries";

export function useCreateRole() {
  const queryClient = useQueryClient();
  return api.useMutation("post", "/roles", {
    onSuccess: () => invalidateAccessQueries(queryClient),
  });
}
