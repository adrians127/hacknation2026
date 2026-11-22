import { Plus } from "lucide-react";
import {
  useDeferredValue,
  useId,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";

import { intToIpv4, rangeSize } from "@subsurf/contracts/targets/ipv4";
import { TARGET_IMPORT_LIMITS } from "@subsurf/contracts/targets/target-input";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TargetKindBadge } from "@/features/targets/components/target-kind-badge";
import {
  addFromText,
  type AddResult,
  type EntryProblem,
  type FormEntry,
  type ParsedEntry,
} from "@/features/targets/lib/entry-list";

// Enough to fix a paste by hand; a longer list belongs in the text tab.
const MAX_SHOWN_PROBLEMS = 20;
const LINE_BREAK = /\r|\n/;

interface TargetEntryComposerProps {
  entries: readonly FormEntry[];
  onAdd: (added: FormEntry[]) => void;
}

/** The value + note fields above the list: Enter adds, a pasted list is added at once. */
export function TargetEntryComposer({ entries, onAdd }: TargetEntryComposerProps) {
  const { t } = useTranslation();
  const id = useId();
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState<AddResult | null>(null);
  const valueRef = useRef<HTMLTextAreaElement>(null);

  const deferredText = useDeferredValue(text);
  // A dry run of what Enter would do, for the line under the field.
  const live = useMemo(
    () => (deferredText.trim() === "" ? null : addFromText(entries, deferredText, note)),
    [entries, deferredText, note],
  );
  const singleProblem = live && live.total <= 1 ? live.problems[0] : undefined;

  function add(source = text) {
    const result = addFromText(entries, source, note);
    if (result.total === 0) return;
    if (result.added.length > 0) onAdd(result.added);
    setText(result.remainingText);
    if (result.remainingText === "") setNote("");
    // One target needs no summary: it shows up at the top of the list.
    setOutcome(result.total > 1 ? result : null);
    // Enter in the note field adds too; the next target goes into the value field.
    valueRef.current?.focus();
  }

  function addOnEnter(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    // Also keeps Enter from submitting the import form around it.
    event.preventDefault();
    add();
  }

  function addPastedList(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = event.clipboardData.getData("text/plain");
    if (!LINE_BREAK.test(pasted.trim())) return;
    event.preventDefault();
    const { selectionStart, selectionEnd } = event.currentTarget;
    add(text.slice(0, selectionStart) + pasted + text.slice(selectionEnd));
  }

  return (
    <div className="grid gap-2">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)_auto] sm:items-start">
        <div className="grid gap-2">
          <Label htmlFor={`${id}-value`}>{t("targets.import.entry.valueLabel")}</Label>
          <Textarea
            ref={valueRef}
            id={`${id}-value`}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setOutcome(null);
            }}
            onKeyDown={addOnEnter}
            onPaste={addPastedList}
            placeholder={t("targets.import.entry.valuePlaceholder")}
            rows={1}
            spellCheck={false}
            autoComplete="off"
            className="max-h-60 min-h-8 resize-none py-[5px] font-mono"
            aria-invalid={singleProblem ? true : undefined}
            aria-describedby={`${id}-status ${id}-hint`}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-note`}>{t("targets.import.entry.noteLabel")}</Label>
          <Input
            id={`${id}-note`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={addOnEnter}
            placeholder={t("targets.import.entry.notePlaceholder")}
            maxLength={TARGET_IMPORT_LIMITS.maxNoteLength}
            autoComplete="off"
          />
        </div>
        <div className="grid gap-2">
          {/* Keeps the button level with the fields under their labels. */}
          <span aria-hidden className="hidden text-sm leading-none sm:block">
            &nbsp;
          </span>
          <Button type="button" variant="secondary" onClick={() => add()} disabled={text.trim() === ""}>
            <Plus />
            {t("targets.import.entry.add")}
          </Button>
        </div>
      </div>

      <div id={`${id}-status`} aria-live="polite" className="grid gap-1 text-sm">
        {outcome && (
          <p>
            {t("targets.import.entry.added", { count: outcome.total, added: outcome.added.length })}
            {outcome.alreadyListed > 0 &&
              ` ${t("targets.import.entry.alreadyListed", { count: outcome.alreadyListed })}`}
          </p>
        )}
        {live && (live.total <= 1 ? <SingleStatus result={live} note={note} /> : <ListStatus result={live} />)}
      </div>
      <p id={`${id}-hint`} className="text-sm text-muted-foreground">
        {live ? t("targets.import.entry.valueHint") : t("targets.import.entry.empty")}
      </p>
    </div>
  );
}

function SingleStatus({ result, note }: { result: AddResult; note: string }) {
  const { t } = useTranslation();
  const [entry] = result.added;
  const [problem] = result.problems;

  if (problem) return <p className="text-destructive">{t(`targets.import.issues.${problem.code}`)}</p>;
  if (result.alreadyListed > 0) {
    return <p className="text-muted-foreground">{t("targets.import.entry.detected.alreadyListed")}</p>;
  }
  if (!entry) return null;
  return (
    <>
      <EntryDescription parsed={entry.parsed} />
      {entry.note !== note.trim() && (
        <p className="text-muted-foreground">{t("targets.import.entry.detected.lineNote", { note: entry.note })}</p>
      )}
    </>
  );
}

function ListStatus({ result }: { result: AddResult }) {
  const { t } = useTranslation();
  return (
    <>
      {result.added.length > 0 && <p>{t("targets.import.entry.linesReady", { count: result.added.length })}</p>}
      {result.problems.length > 0 && <ProblemList problems={result.problems} />}
    </>
  );
}

function ProblemList({ problems }: { problems: readonly EntryProblem[] }) {
  const { t } = useTranslation();
  const hidden = problems.length - MAX_SHOWN_PROBLEMS;
  return (
    <div className="grid gap-1 text-destructive">
      <p>{t("targets.import.entry.toFix")}</p>
      <ul className="grid gap-0.5 pl-4">
        {problems.slice(0, MAX_SHOWN_PROBLEMS).map((problem, index) => (
          // Problems can repeat (the same typo twice), so the index is part of the key.
          <li key={`${index}:${problem.raw}`} className="list-disc">
            <span className="font-mono break-all">{problem.raw}</span>: {t(`targets.import.issues.${problem.code}`)}
          </li>
        ))}
      </ul>
      {hidden > 0 && <p>{t("targets.import.entry.moreProblems", { count: hidden })}</p>}
    </div>
  );
}

/** What the value is and what will be stored: kind, address span, size, normalization. */
export function EntryDescription({ parsed }: { parsed: ParsedEntry }) {
  const { t } = useTranslation();
  const span = parsed.range ? `${intToIpv4(parsed.range.start)} – ${intToIpv4(parsed.range.end)}` : null;
  const details: string[] = [];
  if (parsed.kind === "cidr" && span) details.push(span);
  if (parsed.range && parsed.kind !== "ip") {
    details.push(t("targets.import.entry.detected.addresses", { count: rangeSize(parsed.range) }));
  }
  if (parsed.kind === "range") {
    details.push(t("targets.import.entry.detected.blocks", { count: parsed.blocks.length }));
  }
  if (parsed.kind === "domain") details.push(t("targets.import.entry.detected.domain"));
  const notes = parsed.warnings.filter((code) => code !== "range_split");

  return (
    <div className="grid gap-0.5">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <TargetKindBadge kind={parsed.kind} />
        <span className="font-mono break-all">{parsed.kind === "range" ? span : parsed.value}</span>
        {details.length > 0 && <span className="text-muted-foreground">{details.join(" · ")}</span>}
      </p>
      {notes.map((code) => (
        <p key={code} className="text-muted-foreground">
          {t(`targets.import.issues.${code}`)}
        </p>
      ))}
    </div>
  );
}
