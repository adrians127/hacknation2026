import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";
import { invalidateSignatureEffects } from "@/features/signatures/api/invalidate-signatures";

export function useImportSignatures() {
  const queryClient = useQueryClient();
  return api.useMutation("post", "/signatures/import", {
    onSuccess: () => invalidateSignatureEffects(queryClient),
  });
}
