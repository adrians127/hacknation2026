import { useMutation } from "@tanstack/react-query";

import { apiClient } from "@/api/client";
import { saveFile } from "@/lib/download";

/** Downloads every signature (built-ins by key, so whether they are on round-trips) as JSON. */
export const useExportSignatures = () =>
  useMutation({
    mutationFn: async () => {
      const { data, error } = await apiClient.GET("/signatures/export", {
        params: { query: { builtIn: "true" } },
      });
      if (error !== undefined) throw error;
      const date = new Date().toISOString().slice(0, 10);
      saveFile(
        new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: "application/json" }),
        `subsurf-signatures-${date}.json`,
      );
    },
  });
