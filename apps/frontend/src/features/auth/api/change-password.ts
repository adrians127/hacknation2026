import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";
import { meQueryKey } from "@/lib/auth/me-query";

export function useChangePassword() {
  const queryClient = useQueryClient();
  return api.useMutation("post", "/auth/change-password", {
    onSuccess: () => {
      // Update the cache first: the protected loader reads it right after, and a stale
      // `mustChangePassword: true` would send the user straight back here.
      queryClient.setQueryData(meQueryKey(), (me) => me && { ...me, mustChangePassword: false });
      return queryClient.invalidateQueries({ queryKey: meQueryKey() });
    },
  });
}
