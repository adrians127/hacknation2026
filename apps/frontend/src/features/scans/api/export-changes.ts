import { useMutation } from "@tanstack/react-query";

import { apiClient } from "@/api/client";
import { saveFile } from "@/lib/download";

export type ChangesFormat = "csv" | "json";

interface ExportChanges {
  scanId: string;
  base: string;
  format: ChangesFormat;
  fileName: string;
}

/** Downloads the changes between two scans (`GET /scans/{id}/changes`) as a file. */
export const useExportChanges = () =>
  useMutation({
    mutationFn: async ({ scanId, base, format, fileName }: ExportChanges) => {
      const { data, error } = await apiClient.GET("/scans/{id}/changes", {
        params: { path: { id: scanId }, query: { base, format } },
        parseAs: "blob",
      });
      if (error !== undefined) throw error;
      saveFile(data, fileName);
    },
  });
