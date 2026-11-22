import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";
import { invalidateRuleEffects } from "@/features/rules/api/invalidate-rules";

export function useCreateRule() {
  const queryClient = useQueryClient();
  return api.useMutation("post", "/rules", {
    onSuccess: () => invalidateRuleEffects(queryClient),
  });
}
