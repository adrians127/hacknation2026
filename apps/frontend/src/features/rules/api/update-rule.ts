import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";
import { invalidateRuleEffects } from "@/features/rules/api/invalidate-rules";

export function useUpdateRule() {
  const queryClient = useQueryClient();
  return api.useMutation("patch", "/rules/{id}", {
    onSuccess: () => invalidateRuleEffects(queryClient),
  });
}
