import { useTranslation } from "react-i18next";

import type { SignaturePreviewBody } from "@subsurf/contracts/signatures/signatures.schema";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useScans } from "@/features/scans/api/get-scans";
import { useSignaturePreview } from "@/features/signatures/api/preview-signature";
import { useErrorMessage } from "@/hooks/use-error-message";
import { toApiError } from "@/lib/api-error";
import { formatDateTime } from "@/lib/format";

const NEWEST = "newest";

/** What the API said about a pattern RE2 refused, as written there (it names the condition). */
function patternErrors(error: unknown): string[] {
  const details = toApiError(error)?.details;
  if (typeof details !== "object" || details === null || !("fieldErrors" in details)) return [];
  const { fieldErrors } = details;
  if (typeof fieldErrors !== "object" || fieldErrors === null || !("definition" in fieldErrors)) return [];
  const { definition } = fieldErrors;
  return Array.isArray(definition) ? definition.filter((item) => typeof item === "string") : [];
}

function PreviewError({ error }: { error: unknown }) {
  const { t } = useTranslation("signatures");
  const errorMessage = useErrorMessage();
  const patterns = patternErrors(error);
  return (
    <div role="alert" className="grid gap-1 text-destructive">
      {patterns.length > 0 ? (
        patterns.map((message) => <p key={message}>{t("preview.patternError", { message })}</p>)
      ) : (
        <p>{errorMessage(error)}</p>
      )}
    </div>
  );
}

/** What the signature in the form matches in a scan, before it is saved. */
export function SignaturePreview({
  body,
  scanId,
  onScanChange,
}: {
  body: Omit<SignaturePreviewBody, "scanId"> | null;
  scanId: string | null;
  onScanChange: (scanId: string | null) => void;
}) {
  const { t, i18n } = useTranslation("signatures");
  const scans = useScans();
  const preview = useSignaturePreview(body === null ? null : { ...body, ...(scanId && { scanId }) });
  const withResults = (scans.data?.items ?? []).filter((scan) =>
    Object.values(scan.hosts).some((count) => count > 0),
  );
  const scanLabel = (scan: (typeof withResults)[number]) =>
    scan.name || formatDateTime(scan.startedAt ?? scan.createdAt, i18n.language);

  return (
    <div className="grid gap-3 text-sm">
      <div className="grid max-w-sm gap-1.5">
        <Label htmlFor="signature-preview-scan">{t("preview.scanLabel")}</Label>
        <Select value={scanId ?? NEWEST} onValueChange={(value) => onScanChange(value === NEWEST ? null : value)}>
          <SelectTrigger id="signature-preview-scan" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NEWEST}>{t("preview.newest")}</SelectItem>
            {withResults.map((scan) => (
              <SelectItem key={scan.id} value={scan.id}>
                {scanLabel(scan)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {body === null ? (
        <p className="text-muted-foreground">{t("preview.invalid")}</p>
      ) : preview.isPending ? (
        <Skeleton className="h-20 w-full" />
      ) : preview.isError ? (
        <PreviewError error={preview.error} />
      ) : preview.data.scan === null ? (
        <p className="text-muted-foreground">{t("preview.noScan")}</p>
      ) : (
        <div className="grid gap-2" aria-live="polite">
          <p>
            {t("preview.counts", { services: preview.data.services, hosts: preview.data.hosts })}
            {preview.data.scan.startedAt && (
              <span className="text-muted-foreground">
                {" "}
                · {t("preview.scan", { date: formatDateTime(preview.data.scan.startedAt, i18n.language) })}
              </span>
            )}
          </p>
          {preview.data.unprobedPaths.length > 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {t("preview.unprobed", { paths: preview.data.unprobedPaths.join(", ") })}
            </p>
          )}
          {preview.data.samples.length > 0 && (
            <ul className="grid max-h-56 gap-2 overflow-y-auto rounded-md border p-2 text-xs">
              {preview.data.samples.map((sample) => (
                <li key={sample.serviceId} className="grid gap-0.5">
                  <span className="flex flex-wrap gap-x-2">
                    <span className="font-mono font-medium">
                      {sample.ip}:{sample.port}
                    </span>
                    {sample.version && <span>{t("preview.version", { version: sample.version })}</span>}
                    <span className="text-muted-foreground">{t(`confidence.${sample.confidence}`)}</span>
                  </span>
                  {sample.evidence.slice(0, 3).map((evidence) => (
                    <span
                      key={`${evidence.target}|${evidence.url}|${evidence.key}|${evidence.value}`}
                      className="break-all font-mono text-muted-foreground"
                    >
                      {t(`targets.${evidence.target}`)}
                      {evidence.key && ` ${evidence.key}`}: {evidence.value}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
