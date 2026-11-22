import { useDeferredValue, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { TagsSchema } from "@subsurf/contracts/common/common.schema";
import {
  parseTargetJson,
  parseTargetText,
  TARGET_IMPORT_LIMITS,
} from "@subsurf/contracts/targets/target-input";
import type { ImportTargetsResponse } from "@subsurf/contracts/targets/targets.schema";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { FileInput, type LoadedFile } from "@/components/file-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useImportTargets } from "@/features/targets/api/import-targets";
import { TargetEntryComposer } from "@/features/targets/components/target-entry-composer";
import { TargetEntryList } from "@/features/targets/components/target-entry-list";
import { TargetImportPreview } from "@/features/targets/components/target-import-preview";
import { useLeaveGuard } from "@/features/targets/hooks/use-leave-guard";
import { analyzeEntries, toImportEntries, type FormEntry } from "@/features/targets/lib/entry-list";
import { useErrorMessage } from "@/hooks/use-error-message";
import { useBlockedReason } from "@/lib/auth/use-blocked-reason";
import { useCan } from "@/lib/auth/use-can";
import { parseTags } from "@/lib/tags";
import { cn } from "@/lib/utils";

const SOURCES = ["form", "text", "csv", "json"] as const;
type Source = (typeof SOURCES)[number];
type TextSource = Exclude<Source, "form">;
type FileSource = Exclude<TextSource, "text">;

const isSource = (value: string): value is Source => (SOURCES as readonly string[]).includes(value);

const FILE_ACCEPT: Record<FileSource, string> = {
  csv: ".csv,.txt,text/csv,text/plain",
  json: ".json,application/json",
};

const parse = (source: TextSource, text: string) =>
  source === "json" ? parseTargetJson(text) : parseTargetText(text);

/**
 * Every tab goes through the shared parser, so what the page shows is exactly what the API
 * will accept. Only the active tab is imported; the others keep their input meanwhile.
 */
export function TargetImportForm({ onImported }: { onImported: (result: ImportTargetsResponse) => void }) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const importTargets = useImportTargets();
  const canRunScans = useCan("scans:run");
  const scanBlockedReason = useBlockedReason(["scans:run"]);

  const [source, setSource] = useState<Source>("form");
  const [entries, setEntries] = useState<FormEntry[]>([]);
  const [entryPage, setEntryPage] = useState(1);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Record<FileSource, LoadedFile | null>>({ csv: null, json: null });
  const [tags, setTags] = useState("");
  const [hasTagsError, setHasTagsError] = useState(false);
  const [startScan, setStartScan] = useState(true);

  const blocker = useLeaveGuard(entries.length > 0);

  // Parsing 100k lines (or list rows) on every keystroke would make typing lag.
  const deferredEntries = useDeferredValue(entries);
  const analysis = useMemo(() => analyzeEntries(deferredEntries), [deferredEntries]);

  const textInput = useMemo(
    () =>
      source === "form" ? null : { source, text: source === "text" ? text : (files[source]?.text ?? "") },
    [source, text, files],
  );
  const deferredText = useDeferredValue(textInput);
  const parsed = useMemo(
    () =>
      deferredText === null || deferredText.text.trim() === ""
        ? null
        : parse(deferredText.source, deferredText.text),
    [deferredText],
  );

  const isFormTab = source === "form";
  const isCurrent = isFormTab ? deferredEntries === entries : deferredText === textInput;
  // `null` while the deferred parse still lags behind the input.
  const ready = isCurrent ? (isFormTab ? analysis.result : parsed) : null;
  const canSubmit = ready !== null && ready.entries.length > 0 && ready.listErrors.length === 0;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (ready === null || !canSubmit || importTargets.isPending) return;
    const tagList = parseTags(tags);
    if (!TagsSchema.safeParse(tagList).success) {
      setHasTagsError(true);
      return;
    }
    importTargets.mutate(
      {
        body: {
          entries: isFormTab
            ? toImportEntries(entries)
            : ready.entries.map(({ value, note }) => (note ? { value, note } : { value })),
          startScan: startScan && canRunScans,
          ...(tagList.length > 0 && { tags: tagList }),
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
      <FileInput
        id={`targets-${fileSource}-file`}
        accept={FILE_ACCEPT[fileSource]}
        maxBytes={TARGET_IMPORT_LIMITS.maxFileBytes}
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
            {/* Kept mounted: lines left in the entry field must survive a look at another tab. */}
            <TabsContent value="form" forceMount className="grid gap-6 data-[state=inactive]:hidden">
              <TargetEntryComposer
                entries={entries}
                onAdd={(added) => {
                  setEntries((prev) => [...prev, ...added]);
                  setEntryPage(1);
                }}
              />
              <TargetEntryList
                entries={entries}
                analysis={analysis}
                page={entryPage}
                onPageChange={setEntryPage}
                onNoteChange={(value, note) =>
                  setEntries((prev) =>
                    prev.map((entry) => (entry.parsed.value === value ? { ...entry, note } : entry)),
                  )
                }
                onRemove={(value) => setEntries((prev) => prev.filter((entry) => entry.parsed.value !== value))}
                onClear={() => setEntries([])}
              />
            </TabsContent>
            <TabsContent value="text" className="grid gap-2">
              <Label htmlFor="targets-text">{t("targets.import.text.label")}</Label>
              <Textarea
                id="targets-text"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder={t("targets.import.text.placeholder")}
                rows={10}
                spellCheck={false}
                className="max-h-96 min-h-48 font-mono"
                aria-describedby="targets-text-hint"
              />
              <p id="targets-text-hint" className="text-sm text-muted-foreground">
                {t("targets.import.text.hint")}
              </p>
            </TabsContent>
            {fileTab("csv")}
            {fileTab("json")}
          </Tabs>

          {!isFormTab &&
            (parsed ? (
              <TargetImportPreview result={parsed} position={deferredText?.source === "json" ? "item" : "line"} />
            ) : (
              <p className="text-sm text-muted-foreground">{t("targets.import.preview.empty")}</p>
            ))}

          <div className="grid max-w-xl gap-2">
            <Label htmlFor="targets-tags">{t("targets.import.tags.label")}</Label>
            <Input
              id="targets-tags"
              value={tags}
              onChange={(event) => {
                setTags(event.target.value);
                setHasTagsError(false);
              }}
              placeholder={t("targets.import.tags.placeholder")}
              aria-invalid={hasTagsError ? true : undefined}
              aria-describedby="targets-tags-hint"
            />
            <p
              id="targets-tags-hint"
              className={cn("text-sm", hasTagsError ? "text-destructive" : "text-muted-foreground")}
            >
              {t(hasTagsError ? "targets.import.tags.invalid" : "targets.import.tags.hint")}
            </p>
          </div>

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
                : t("targets.import.submit", { count: ready?.entries.length ?? 0 })}
            </Button>
          </div>
        </form>
      </CardContent>
      {blocker.state === "blocked" && (
        <ConfirmDialog
          title={t("targets.import.entry.leave.title")}
          description={t("targets.import.entry.leave.description", { count: entries.length })}
          confirmLabel={t("targets.import.entry.leave.confirm")}
          destructive
          onConfirm={() => blocker.proceed()}
          onCancel={() => blocker.reset()}
        />
      )}
    </Card>
  );
}
