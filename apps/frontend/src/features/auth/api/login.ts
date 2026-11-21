import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";
import { meQueryKey } from "@/lib/auth/me-query";

export function useLogin() {
  const queryClient = useQueryClient();
  return api.useMutation("post", "/auth/login", {
    onSuccess: (me) => queryClient.setQueryData(meQueryKey(), me),
  });
}
