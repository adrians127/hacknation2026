import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";
import { invalidateSignatureEffects } from "@/features/signatures/api/invalidate-signatures";

export function useUpdateSignature() {
  const queryClient = useQueryClient();
  return api.useMutation("patch", "/signatures/{id}", {
    onSuccess: () => invalidateSignatureEffects(queryClient),
  });
}
