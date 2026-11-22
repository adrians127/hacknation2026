import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";
import { invalidateRuleEffects } from "@/features/rules/api/invalidate-rules";

export function useDeleteRule() {
  const queryClient = useQueryClient();
  return api.useMutation("delete", "/rules/{id}", {
    onSuccess: () => invalidateRuleEffects(queryClient),
  });
}
