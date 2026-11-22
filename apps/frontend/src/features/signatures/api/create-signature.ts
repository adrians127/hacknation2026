import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";
import { invalidateSignatureEffects } from "@/features/signatures/api/invalidate-signatures";

export function useCreateSignature() {
  const queryClient = useQueryClient();
  return api.useMutation("post", "/signatures", {
    onSuccess: () => invalidateSignatureEffects(queryClient),
  });
}
