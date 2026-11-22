import { useDeferredValue, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import {
  readScanCsv,
  readScanJsonText,
  SCAN_IMPORT_LIMITS,
  summarizeScanImport,
} from "@subsurf/contracts/scans/scan-import";
import {
  ScanAlreadyImportedDetailsSchema,
  type ImportScanResponse,
} from "@subsurf/contracts/scans/scan-import.schema";

import { FileInput, type LoadedFile } from "@/components/file-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useImportScan } from "@/features/scans/api/import-scan";
import { ScanImportPreview } from "@/features/scans/components/scan-import-preview";
import { useErrorMessage } from "@/hooks/use-error-message";
import { toApiError } from "@/lib/api-error";
import { useBlockedReason } from "@/lib/auth/use-blocked-reason";
import { useCan } from "@/lib/auth/use-can";

const ACCEPT = ".json,.csv,application/json,text/csv";
const MAX_NAME_LENGTH = 200;
const SAMPLES = ["json", "csv"] as const;

/** By extension; a file without a telling one is JSON when it starts like JSON. */
function isCsv(file: LoadedFile): boolean {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) return true;
  if (name.endsWith(".json")) return false;
  return !/^\s*[[{]/.test(file.text);
}

/**
 * The file is read here with the reader the API uses, so the preview shows exactly what an
 * import adds; the file itself is uploaded, not the parsed result.
 */
export function ScanImportForm({ onImported }: { onImported: (result: ImportScanResponse) => void }) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const importScan = useImportScan();
  const canEditHosts = useCan("hosts:update");
  const editsBlockedReason = useBlockedReason(["hosts:update"]);

  const [file, setFile] = useState<LoadedFile | null>(null);
  const [name, setName] = useState("");
  const [applyEdits, setApplyEdits] = useState(true);

  // Reading tens of megabytes must not freeze the file picker.
  const deferredFile = useDeferredValue(file);
  const read = useMemo(
    () =>
      deferredFile === null
        ? null
        : isCsv(deferredFile)
          ? readScanCsv(deferredFile.text)
          : readScanJsonText(deferredFile.text),
    [deferredFile],
  );
  const ready = deferredFile === file ? read : null;
  const carriesEdits = useMemo(() => {
    if (!ready?.ok) return false;
    const summary = summarizeScanImport(ready.import);
    return summary.hostEdits + summary.serviceEdits > 0;
  }, [ready]);

  function load(next: LoadedFile | null) {
    setFile(next);
    setName(next?.name.slice(0, MAX_NAME_LENGTH) ?? "");
    importScan.reset();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || !ready?.ok || importScan.isPending) return;
    importScan.mutate(
      {
        text: file.text,
        contentType: isCsv(file) ? "text/csv" : "application/json",
        name: name.trim(),
        edits: carriesEdits && applyEdits && canEditHosts ? "fill" : "skip",
      },
      { onSuccess: onImported },
    );
  }

  const failure = importScan.isError ? toApiError(importScan.error) : null;
  const existing =
    failure?.code === "SCAN_ALREADY_IMPORTED"
      ? ScanAlreadyImportedDetailsSchema.safeParse(failure.details).data
      : undefined;

  return (
    <Card>
      <CardContent>
        <form onSubmit={submit} className="grid gap-6" noValidate>
          <div className="grid gap-3">
            <FileInput
              id="scan-import-file"
              accept={ACCEPT}
              maxBytes={SCAN_IMPORT_LIMITS.maxFileBytes}
              file={file}
              onLoad={load}
            />
            <p className="text-sm text-muted-foreground">{t("scans.import.hint")}</p>
            <p className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              {SAMPLES.map((format) => (
                <a
                  key={format}
                  href={`/samples/scan-results.${format}`}
                  download
                  className="text-brand underline-offset-4 hover:underline"
                >
                  {t(`scans.import.samples.${format}`)}
                </a>
              ))}
            </p>
          </div>

          {ready ? (
            <ScanImportPreview read={ready} />
          ) : (
            <p className="text-sm text-muted-foreground">
              {t(file ? "scans.import.reading" : "scans.import.empty")}
            </p>
          )}

          {ready?.ok && (
            <>
              <div className="grid max-w-xl gap-2">
                <Label htmlFor="scan-import-name">{t("scans.import.name.label")}</Label>
                <Input
                  id="scan-import-name"
                  value={name}
                  maxLength={MAX_NAME_LENGTH}
                  onChange={(event) => setName(event.target.value)}
                  aria-describedby="scan-import-name-hint"
                />
                <p id="scan-import-name-hint" className="text-sm text-muted-foreground">
                  {t("scans.import.name.hint")}
                </p>
              </div>

              <div className="flex items-start gap-3">
                <Checkbox
                  id="scan-import-edits"
                  checked={carriesEdits && applyEdits && canEditHosts}
                  disabled={!carriesEdits || !canEditHosts}
                  onCheckedChange={(checked) => setApplyEdits(checked === true)}
                  aria-describedby="scan-import-edits-hint"
                />
                <div className="grid gap-1">
                  <Label htmlFor="scan-import-edits">{t("scans.import.edits.label")}</Label>
                  <p id="scan-import-edits-hint" className="text-sm text-muted-foreground">
                    {carriesEdits
                      ? (editsBlockedReason ?? t("scans.import.edits.hint"))
                      : t("scans.import.edits.none")}
                  </p>
                </div>
              </div>
            </>
          )}

          {failure !== null && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(importScan.error)}{" "}
              {existing && (
                <Link to={`/app/scans/${existing.scanId}`} className="underline underline-offset-4">
                  {t("scans.import.openExisting")}
                </Link>
              )}
            </p>
          )}
          {importScan.isError && failure === null && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(importScan.error)}
            </p>
          )}

          <div>
            <Button type="submit" disabled={!ready?.ok || importScan.isPending}>
              {t(importScan.isPending ? "scans.import.submitting" : "scans.import.submit")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
