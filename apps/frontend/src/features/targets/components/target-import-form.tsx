import { useDeferredValue, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { parseTargetJson, parseTargetText } from "@hacknation/contracts/targets/target-input";
import type { ImportTargetsResponse } from "@hacknation/contracts/targets/targets.schema";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useImportTargets } from "@/features/targets/api/import-targets";
import { TargetFileInput, type LoadedFile } from "@/features/targets/components/target-file-input";
import { TargetImportPreview } from "@/features/targets/components/target-import-preview";
import { useErrorMessage } from "@/hooks/use-error-message";
import { useBlockedReason } from "@/lib/auth/use-blocked-reason";
import { useCan } from "@/lib/auth/use-can";

const SOURCES = ["manual", "csv", "json"] as const;
type Source = (typeof SOURCES)[number];
type FileSource = Exclude<Source, "manual">;

const isSource = (value: string): value is Source => (SOURCES as readonly string[]).includes(value);

const FILE_ACCEPT: Record<FileSource, string> = {
  csv: ".csv,.txt,text/csv,text/plain",
  json: ".json,application/json",
};

const parse = (source: Source, text: string) =>
  source === "json" ? parseTargetJson(text) : parseTargetText(text);

/**
 * Manual text, CSV and JSON all go through the shared parser, so the preview shows exactly
 * what the API will accept; only the parsed entries are sent.
 */
export function TargetImportForm({ onImported }: { onImported: (result: ImportTargetsResponse) => void }) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const importTargets = useImportTargets();
  const canRunScans = useCan("scans:run");
  const scanBlockedReason = useBlockedReason(["scans:run"]);

  const [source, setSource] = useState<Source>("manual");
  const [manualText, setManualText] = useState("");
  const [files, setFiles] = useState<Record<FileSource, LoadedFile | null>>({ csv: null, json: null });
  const [startScan, setStartScan] = useState(true);

  const input = useMemo(
    () => ({ source, text: source === "manual" ? manualText : (files[source]?.text ?? "") }),
    [source, manualText, files],
  );
  // Parsing 100k lines on every keystroke would make typing lag.
  const deferred = useDeferredValue(input);
  const parsed = useMemo(
    () => (deferred.text.trim() === "" ? null : parse(deferred.source, deferred.text)),
    [deferred],
  );
  const isStale = deferred !== input;
  const canSubmit =
    parsed !== null && !isStale && parsed.entries.length > 0 && parsed.listErrors.length === 0;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || parsed === null || importTargets.isPending) return;
    importTargets.mutate(
      {
        body: {
          entries: parsed.entries.map(({ value, note }) => (note ? { value, note } : { value })),
          startScan: startScan && canRunScans,
        },
      },
      {
        onSuccess: (result) => {
          toast.success(t("targets.import.toast"));
          onImported(result);
        },
      },
    );
  }

  const fileTab = (fileSource: FileSource) => (
    <TabsContent value={fileSource} className="grid gap-3">
      <TargetFileInput
        id={`targets-${fileSource}-file`}
        accept={FILE_ACCEPT[fileSource]}
        file={files[fileSource]}
        onLoad={(file) => setFiles((prev) => ({ ...prev, [fileSource]: file }))}
      />
      <p className="text-sm text-muted-foreground">{t(`targets.import.${fileSource}.hint`)}</p>
      <a
        href={`/samples/targets.${fileSource}`}
        download
        className="w-fit text-sm text-brand underline-offset-4 hover:underline"
      >
        {t(`targets.import.${fileSource}.sample`)}
      </a>
    </TabsContent>
  );

  return (
    <Card>
      <CardContent>
        <form onSubmit={submit} className="grid gap-6" noValidate>
          <Tabs value={source} onValueChange={(value) => isSource(value) && setSource(value)}>
            <TabsList>
              {SOURCES.map((value) => (
                <TabsTrigger key={value} value={value}>
                  {t(`targets.import.tabs.${value}`)}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value="manual" className="grid gap-2">
              <Label htmlFor="targets-manual">{t("targets.import.manual.label")}</Label>
              <Textarea
                id="targets-manual"
                value={manualText}
                onChange={(event) => setManualText(event.target.value)}
                placeholder={t("targets.import.manual.placeholder")}
                rows={10}
                spellCheck={false}
                className="max-h-96 min-h-48 font-mono"
                aria-describedby="targets-manual-hint"
              />
              <p id="targets-manual-hint" className="text-sm text-muted-foreground">
                {t("targets.import.manual.hint")}
              </p>
            </TabsContent>
            {fileTab("csv")}
            {fileTab("json")}
          </Tabs>

          {parsed ? (
            <TargetImportPreview result={parsed} position={deferred.source === "json" ? "item" : "line"} />
          ) : (
            <p className="text-sm text-muted-foreground">{t("targets.import.preview.empty")}</p>
          )}

          <div className="flex items-start gap-3">
            <Checkbox
              id="targets-start-scan"
              checked={startScan && canRunScans}
              disabled={!canRunScans}
              onCheckedChange={(checked) => setStartScan(checked === true)}
              aria-describedby="targets-start-scan-hint"
            />
            <div className="grid gap-1">
              <Label htmlFor="targets-start-scan">{t("targets.import.startScan.label")}</Label>
              <p id="targets-start-scan-hint" className="text-sm text-muted-foreground">
                {scanBlockedReason ?? t("targets.import.startScan.hint")}
              </p>
            </div>
          </div>

          {importTargets.isError && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(importTargets.error)}
            </p>
          )}

          <div>
            <Button type="submit" disabled={!canSubmit || importTargets.isPending}>
              {importTargets.isPending
                ? t("targets.import.submitting")
                : t("targets.import.submit", { count: parsed?.entries.length ?? 0 })}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
