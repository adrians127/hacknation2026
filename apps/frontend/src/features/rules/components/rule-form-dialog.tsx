import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { TriageStatusSchema } from "@subsurf/contracts/hosts/hosts.schema";
import {
  ChangeRowKindSchema,
  RuleDefinitionSchema,
  RuleKindSchema,
  RuleNameSchema,
  RuleTargetSchema,
  RuleTriageSchema,
  RuleVulnerabilityTriageSchema,
  UNCHANGED_SCANS_MAX,
  type Rule,
  type RulePreviewBody,
} from "@subsurf/contracts/rules/rules.schema";
import { ChangePrioritySchema } from "@subsurf/contracts/scans/scan-changes.schema";
import {
  FieldChangeKindSchema,
  HostLifecycleStateSchema,
  ScanChangeSchema,
} from "@subsurf/contracts/scans/scan-results.schema";
import {
  MatchReasonSchema,
  VulnerabilitySeveritySchema,
} from "@subsurf/contracts/vulnerabilities/vulnerabilities.schema";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCreateRule } from "@/features/rules/api/create-rule";
import { useUpdateRule } from "@/features/rules/api/update-rule";
import { RulePreview } from "@/features/rules/components/rule-preview";
import {
  EMPTY_FORM,
  issueField,
  toDefinition,
  toFormState,
  type RuleFormState,
} from "@/features/rules/lib/rule-form";
import { RULE_PRESET_IDS, RULE_PRESETS, type RulePresetId } from "@/features/rules/lib/rule-presets";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useErrorMessage } from "@/hooks/use-error-message";

const CHANGES = ScanChangeSchema.exclude(["unchanged"]).options;

/** `YYYY-MM-DD` of an ISO time, for a date input. */
const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
/** The end of that day in the user's time zone. */
const fromDateInput = (date: string) => (date ? new Date(`${date}T23:59:59`).toISOString() : null);

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | false;
  children: ReactNode;
}) {
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

function ListInput({
  id,
  label,
  hint,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  error: string | false;
}) {
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
      />
    </Field>
  );
}

function CheckboxGroup<T extends string>({
  legend,
  options,
  value,
  label,
  onChange,
}: {
  legend: string;
  options: readonly T[];
  value: readonly T[];
  label: (option: T) => string;
  onChange: (value: T[]) => void;
}) {
  return (
    <fieldset className="grid gap-1.5">
      <legend className="mb-1.5 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {options.map((option) => (
          <Label key={option} className="flex items-center gap-2 font-normal">
            <Checkbox
              checked={value.includes(option)}
              onCheckedChange={(checked) =>
                onChange(checked === true ? [...value, option] : value.filter((item) => item !== option))
              }
            />
            {label(option)}
          </Label>
        ))}
      </div>
    </fieldset>
  );
}

function Choice<T extends string>({
  id,
  value,
  options,
  label,
  onChange,
}: {
  id: string;
  value: T;
  options: readonly T[];
  label: (option: T) => string;
  onChange: (value: T) => void;
}) {
  return (
    <Select value={value} onValueChange={(raw) => onChange(options.find((option) => option === raw) ?? value)}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {label(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Creates a rule (from scratch or a template) or edits one, with a live preview of its effect. */
export function RuleFormDialog({ rule, onClose }: { rule: Rule | null; onClose: () => void }) {
  const { t } = useTranslation("rules");
  const { t: th } = useTranslation("hosts");
  const { t: tv } = useTranslation("vulnerabilities");
  const { t: tc } = useTranslation();
  const errorMessage = useErrorMessage();
  const create = useCreateRule();
  const update = useUpdateRule();
  const saving = create.isPending || update.isPending;
  const failed = create.isError ? create.error : update.isError ? update.error : null;

  const [form, setForm] = useState<RuleFormState>(() => (rule ? toFormState(rule.definition) : EMPTY_FORM));
  const [name, setName] = useState(rule?.name ?? "");
  const [note, setNote] = useState(rule?.note ?? "");
  const [expires, setExpires] = useState(toDateInput(rule?.expiresAt ?? null));
  const [preset, setPreset] = useState<RulePresetId | "">("");
  const [submitted, setSubmitted] = useState(false);

  const definition = useMemo(() => toDefinition(form), [form]);
  const parsed = useMemo(() => RuleDefinitionSchema.safeParse(definition), [definition]);
  const invalid = useMemo(
    () => new Set(parsed.success ? [] : parsed.error.issues.map((issue) => issueField(issue.path))),
    [parsed],
  );
  const previewBody = useMemo<RulePreviewBody | null>(
    () => (parsed.success ? { definition: parsed.data, ...(rule && { ruleId: rule.id }) } : null),
    [parsed, rule],
  );
  const debouncedPreview = useDebouncedValue(previewBody, 400);
  const isNameValid = RuleNameSchema.safeParse(name).success;

  const show = (field: string) => submitted && invalid.has(field) && t("form.invalid");
  const patch = <K extends Exclude<keyof RuleFormState, "kind">>(
    key: K,
    value: Partial<RuleFormState[K]>,
  ) => setForm((previous) => ({ ...previous, [key]: { ...previous[key], ...value } }));

  function applyPreset(id: RulePresetId) {
    setPreset(id);
    setForm(toFormState(RULE_PRESETS[id]));
    setName(t(`presets.${id}.name`));
    setNote(t(`presets.${id}.description`));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (!parsed.success || !isNameValid) return;
    const fields = { name: name.trim(), note, expiresAt: fromDateInput(expires), definition: parsed.data };
    const onSuccess = () => {
      toast.success(t(rule ? "toast.updated" : "toast.created"));
      onClose();
    };
    if (rule) update.mutate({ params: { path: { id: rule.id } }, body: fields }, { onSuccess });
    else create.mutate({ body: fields }, { onSuccess });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-3xl">
        <form onSubmit={submit} className="grid gap-5" noValidate>
          <DialogHeader>
            <DialogTitle>{rule ? t("form.editTitle") : t("form.createTitle")}</DialogTitle>
            <DialogDescription>{t("form.description")}</DialogDescription>
          </DialogHeader>

          {!rule && (
            <Field id="rule-preset" label={t("form.preset")} hint={t("form.presetHint")}>
              <Select
                value={preset}
                onValueChange={(raw) => {
                  const id = RULE_PRESET_IDS.find((candidate) => candidate === raw);
                  if (id) applyPreset(id);
                }}
              >
                <SelectTrigger id="rule-preset" className="w-full">
                  <SelectValue placeholder={t("form.presetPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {RULE_PRESET_IDS.map((id) => (
                    <SelectItem key={id} value={id}>
                      {t(`presets.${id}.name`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
            <Field id="rule-name" label={t("form.name")} error={submitted && !isNameValid && t("form.nameInvalid")}>
              <Input
                id="rule-name"
                value={name}
                maxLength={100}
                onChange={(event) => setName(event.target.value)}
                aria-invalid={submitted && !isNameValid ? true : undefined}
              />
            </Field>
            <Field id="rule-kind" label={t("form.kind")}>
              <Choice
                id="rule-kind"
                value={form.kind}
                options={RuleKindSchema.options}
                label={(kind) => t(`kinds.${kind}.name`)}
                onChange={(kind) => setForm((previous) => ({ ...previous, kind }))}
              />
            </Field>
          </div>
          <p className="-mt-3 text-xs text-muted-foreground">{t(`kinds.${form.kind}.description`)}</p>

          <fieldset className="grid gap-3 rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">{t("form.scope")}</legend>
            <p className="text-xs text-muted-foreground">{t("form.scopeHint")}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <ListInput
                id="rule-ranges"
                label={t("form.ranges")}
                hint={t("form.rangesHint")}
                value={form.scope.ranges}
                onChange={(ranges) => patch("scope", { ranges })}
                error={show("scope.ranges")}
              />
              <ListInput
                id="rule-host-tags"
                label={t("form.hostTags")}
                hint={t("form.listHint")}
                value={form.scope.hostTags}
                onChange={(hostTags) => patch("scope", { hostTags })}
                error={show("scope.hostTags")}
              />
              <ListInput
                id="rule-ports"
                label={t("form.ports")}
                hint={t("form.portsHint")}
                value={form.scope.ports}
                onChange={(ports) => patch("scope", { ports })}
                error={show("scope.ports")}
              />
              <ListInput
                id="rule-products"
                label={t("form.products")}
                hint={t("form.productsHint")}
                value={form.scope.products}
                onChange={(products) => patch("scope", { products })}
                error={show("scope.products")}
              />
            </div>
          </fieldset>

          <fieldset className="grid gap-3 rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">{t("form.condition")}</legend>
            {form.kind === "vulnerability" && (
              <>
                <Field
                  id="rule-ids"
                  label={t("form.vulnerabilityIds")}
                  hint={t("form.vulnerabilityIdsHint")}
                  error={show("condition.vulnerabilityIds")}
                >
                  <Textarea
                    id="rule-ids"
                    rows={2}
                    value={form.vulnerability.ids}
                    onChange={(event) => patch("vulnerability", { ids: event.target.value })}
                  />
                </Field>
                <CheckboxGroup
                  legend={t("form.severities")}
                  options={VulnerabilitySeveritySchema.options}
                  value={form.vulnerability.severities}
                  label={(severity) => tv(`severity.${severity}`)}
                  onChange={(severities) => patch("vulnerability", { severities })}
                />
                <div className="grid gap-3 sm:grid-cols-4">
                  <ListInput
                    id="rule-cvss-min"
                    label={t("form.cvssAtLeast")}
                    hint="0–10"
                    value={form.vulnerability.cvssAtLeast}
                    onChange={(cvssAtLeast) => patch("vulnerability", { cvssAtLeast })}
                    error={show("condition.cvssAtLeast")}
                  />
                  <ListInput
                    id="rule-cvss-below"
                    label={t("form.cvssBelow")}
                    hint="0–10"
                    value={form.vulnerability.cvssBelow}
                    onChange={(cvssBelow) => patch("vulnerability", { cvssBelow })}
                    error={show("condition.cvssBelow")}
                  />
                  <Field id="rule-kev" label={t("form.kev")}>
                    <Choice
                      id="rule-kev"
                      value={form.vulnerability.kev}
                      options={["any", "yes", "no"] as const}
                      label={(value) => t(`form.kevOptions.${value}`)}
                      onChange={(kev) => patch("vulnerability", { kev })}
                    />
                  </Field>
                  <Field id="rule-confidence" label={t("form.confidence")}>
                    <Choice
                      id="rule-confidence"
                      value={form.vulnerability.confidence}
                      options={["any", "confirmed", "potential"] as const}
                      label={(value) => (value === "any" ? t("form.any") : tv(`confidence.${value}`))}
                      onChange={(confidence) => patch("vulnerability", { confidence })}
                    />
                  </Field>
                </div>
                <CheckboxGroup
                  legend={t("form.reasons")}
                  options={MatchReasonSchema.options}
                  value={form.vulnerability.reasons}
                  label={(reason) => t(`reasons.${reason}`)}
                  onChange={(reasons) => patch("vulnerability", { reasons })}
                />
              </>
            )}
            {form.kind === "service" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="rule-target" label={t("form.target")}>
                  <Choice
                    id="rule-target"
                    value={form.service.target}
                    options={RuleTargetSchema.options}
                    label={(target) => t(`targets.${target}`)}
                    onChange={(target) => patch("service", { target })}
                  />
                </Field>
                <ListInput
                  id="rule-titles"
                  label={t("form.titles")}
                  hint={t("form.listHint")}
                  value={form.service.titles}
                  onChange={(titles) => patch("service", { titles })}
                  error={show("condition.titles")}
                />
              </div>
            )}
            {form.kind === "unchanged" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="rule-target" label={t("form.target")}>
                  <Choice
                    id="rule-target"
                    value={form.unchanged.target}
                    options={RuleTargetSchema.options}
                    label={(target) => t(`targets.${target}`)}
                    onChange={(target) => patch("unchanged", { target })}
                  />
                </Field>
                <Field
                  id="rule-scans"
                  label={t("form.scans")}
                  hint={t("form.scansHint", { max: UNCHANGED_SCANS_MAX })}
                  error={show("condition.scans")}
                >
                  <Input
                    id="rule-scans"
                    type="number"
                    min={1}
                    max={UNCHANGED_SCANS_MAX}
                    value={form.unchanged.scans}
                    onChange={(event) => patch("unchanged", { scans: event.target.value })}
                  />
                </Field>
              </div>
            )}
            {form.kind === "change_priority" && (
              <>
                <CheckboxGroup
                  legend={t("form.rows")}
                  options={ChangeRowKindSchema.options}
                  value={form.change.rows}
                  label={(row) => t(`rows.${row}`)}
                  onChange={(rows) => patch("change", { rows })}
                />
                <CheckboxGroup
                  legend={t("form.changes")}
                  options={CHANGES}
                  value={form.change.changes}
                  label={(change) => th(`change.${change}`)}
                  onChange={(changes) => patch("change", { changes })}
                />
                <CheckboxGroup
                  legend={t("form.fields")}
                  options={FieldChangeKindSchema.options}
                  value={form.change.fields}
                  label={(field) => th(`fieldChange.fields.${field}`)}
                  onChange={(fields) => patch("change", { fields })}
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <ListInput
                    id="rule-keys"
                    label={t("form.keys")}
                    hint={t("form.keysHint")}
                    value={form.change.keys}
                    onChange={(keys) => patch("change", { keys })}
                    error={show("condition.keys")}
                  />
                </div>
                <CheckboxGroup
                  legend={t("form.lifecycles")}
                  options={HostLifecycleStateSchema.options}
                  value={form.change.lifecycles}
                  label={(state) => t(`lifecycles.${state}`)}
                  onChange={(lifecycles) => patch("change", { lifecycles })}
                />
                <CheckboxGroup
                  legend={t("form.priorities")}
                  options={ChangePrioritySchema.options}
                  value={form.change.priorities}
                  label={(priority) => tc(`dashboard.priority.${priority}`)}
                  onChange={(priorities) => patch("change", { priorities })}
                />
              </>
            )}
          </fieldset>

          <fieldset className="grid gap-3 rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">{t("form.action")}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {form.kind === "vulnerability" && (
                <Field id="rule-action" label={t("form.setTriage")}>
                  <Choice
                    id="rule-action"
                    value={form.vulnerability.triage}
                    options={RuleVulnerabilityTriageSchema.options}
                    label={(triage) => tv(`triage.${triage}`)}
                    onChange={(triage) => patch("vulnerability", { triage })}
                  />
                </Field>
              )}
              {form.kind === "service" && (
                <>
                  <Field id="rule-action" label={t("form.setTriage")} error={show("action")}>
                    <Choice
                      id="rule-action"
                      value={form.service.triage}
                      options={["none", ...RuleTriageSchema.options] as const}
                      label={(triage) => (triage === "none" ? t("form.noTriage") : th(`triage.${triage}`))}
                      onChange={(triage) => patch("service", { triage })}
                    />
                  </Field>
                  <ListInput
                    id="rule-tag"
                    label={t("form.tag")}
                    hint={t("form.tagHint")}
                    value={form.service.tag}
                    onChange={(tag) => patch("service", { tag })}
                    error={show("action.tag")}
                  />
                </>
              )}
              {form.kind === "unchanged" && (
                <Field id="rule-action" label={t("form.setTriage")}>
                  <Choice
                    id="rule-action"
                    value={form.unchanged.triage}
                    options={TriageStatusSchema.exclude(["unreviewed"]).options}
                    label={(triage) => th(`triage.${triage}`)}
                    onChange={(triage) => patch("unchanged", { triage })}
                  />
                </Field>
              )}
              {form.kind === "change_priority" && (
                <Field id="rule-action" label={t("form.changeAction")}>
                  <Choice
                    id="rule-action"
                    value={form.change.action}
                    options={["mute", ...ChangePrioritySchema.options] as const}
                    label={(action) =>
                      action === "mute"
                        ? t("actions.mute")
                        : t("summary.priority", { priority: tc(`dashboard.priority.${action}`) })
                    }
                    onChange={(action) => patch("change", { action })}
                  />
                </Field>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {t(form.kind === "change_priority" ? "form.readTimeHint" : "form.ownershipHint")}
            </p>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
            <Field id="rule-note" label={t("form.note")}>
              <Textarea
                id="rule-note"
                rows={2}
                maxLength={2000}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </Field>
            <Field id="rule-expires" label={t("form.expiresAt")} hint={t("form.expiresHint")}>
              <Input
                id="rule-expires"
                type="date"
                value={expires}
                onChange={(event) => setExpires(event.target.value)}
              />
            </Field>
          </div>

          <section className="grid gap-2 rounded-lg border border-dashed p-3" aria-labelledby="rule-preview-title">
            <h3 id="rule-preview-title" className="text-sm font-medium">
              {t("preview.title")}
            </h3>
            <RulePreview body={debouncedPreview} />
          </section>

          {failed && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(failed)}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              {tc("actions.cancel")}
            </Button>
            <Button type="submit" disabled={saving}>
              {rule ? t("form.save") : t("form.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
