import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/api/client";

interface ImportScan {
  /** The file as it is: the backend reads it with the same code as the preview. */
  text: string;
  contentType: "application/json" | "text/csv";
  name: string;
  edits: "skip" | "fill";
}

/** Uploads a results file (`POST /scans/import`); it becomes a new scan. */
export function useImportScan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ text, contentType, name, edits }: ImportScan) => {
      const { data, error } = await apiClient.POST("/scans/import", {
        params: { query: { edits, name } },
        body: text,
        headers: { "Content-Type": contentType },
        // Sent untouched: the default would wrap the text in a JSON string.
        bodySerializer: () => text,
      });
      if (error !== undefined) throw error;
      return data;
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["get", "/scans"] }),
        queryClient.invalidateQueries({ queryKey: ["get", "/dashboard"] }),
      ]),
  });
}
