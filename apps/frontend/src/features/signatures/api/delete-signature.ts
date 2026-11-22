import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";
import { invalidateSignatureEffects } from "@/features/signatures/api/invalidate-signatures";

export function useDeleteSignature() {
  const queryClient = useQueryClient();
  return api.useMutation("delete", "/signatures/{id}", {
    onSuccess: () => invalidateSignatureEffects(queryClient),
  });
}
