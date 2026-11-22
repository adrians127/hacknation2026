import { useMutation } from "@tanstack/react-query";

import { apiClient } from "@/api/client";
import { saveFile } from "@/lib/download";

export type ScanExportFormat = "csv" | "json";

interface ExportScan {
  scanId: string;
  format: ScanExportFormat;
  fileName: string;
}

/** Downloads one scan's results with the users' edits (`GET /scans/{id}/export`) as a file. */
export const useExportScan = () =>
  useMutation({
    mutationFn: async ({ scanId, format, fileName }: ExportScan) => {
      const { data, error } = await apiClient.GET("/scans/{id}/export", {
        params: { path: { id: scanId }, query: { format } },
        parseAs: "blob",
      });
      if (error !== undefined) throw error;
      saveFile(data, fileName);
    },
  });
