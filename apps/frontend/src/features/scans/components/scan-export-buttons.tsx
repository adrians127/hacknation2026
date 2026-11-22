import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { Scan } from "@subsurf/contracts/scans/scans.schema";

import { Button } from "@/components/ui/button";
import { useExportScan, type ScanExportFormat } from "@/features/scans/api/export-scan";
import { fileStamp } from "@/features/scans/lib/pair";
import { useErrorMessage } from "@/hooks/use-error-message";

const FORMATS = ["csv", "json"] as const satisfies readonly ScanExportFormat[];

/** Downloads the scan's full results; every role that can read the scan may. */
export function ScanExportButtons({ scan }: { scan: Scan }) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const exportScan = useExportScan();

  return FORMATS.map((format) => (
    <Button
      key={format}
      variant="outline"
      disabled={exportScan.isPending}
      onClick={() =>
        exportScan.mutate(
          { scanId: scan.id, format, fileName: `scan-${fileStamp(scan)}.${format}` },
          {
            onError: (error) =>
              toast.error(t("scans.export.failed", { message: errorMessage(error) })),
          },
        )
      }
    >
      <Download />
      {t("scans.export.button", { format: format.toUpperCase() })}
    </Button>
  ));
}
