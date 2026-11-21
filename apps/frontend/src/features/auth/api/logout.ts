import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";

export function useLogout() {
  const queryClient = useQueryClient();
  // Drop every cached response, whether or not the server answered: nothing may outlive the session.
  return api.useMutation("post", "/auth/logout", { onSettled: () => queryClient.clear() });
}
