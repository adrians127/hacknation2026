import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import {
  ScheduleSchema,
  ScheduleUnitSchema,
  type Schedule,
} from "@subsurf/contracts/pipelines/pipelines.schema";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSchedulePreview } from "@/features/pipelines/api/preview-schedule";
import { defaultSchedule } from "@/features/pipelines/lib/draft";
import { WEEKDAY_KEYS } from "@/features/pipelines/lib/summaries";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatDateTime } from "@/lib/format";

const DEFAULT_WINDOW_MINUTES = 240;
const numberValue = (value: number | null) => (value === null || Number.isNaN(value) ? "" : value);
const parseNumber = (raw: string) => (raw === "" ? Number.NaN : Number(raw));

interface ScheduleFieldsProps {
  schedule: Schedule | null;
  enabled: boolean;
  onScheduleChange: (schedule: Schedule | null) => void;
  onEnabledChange: (enabled: boolean) => void;
  /** Zod issue paths inside the schedule, e.g. `windowMinutes`. */
  invalidPaths: ReadonlySet<string>;
  showErrors: boolean;
  /** The role cannot change the schedule (it lacks scans:run), or cannot edit at all. */
  disabled: boolean;
  disabledReason?: string;
}

export function ScheduleFields({
  schedule,
  enabled,
  onScheduleChange,
  onEnabledChange,
  invalidPaths,
  showErrors,
  disabled,
  disabledReason,
}: ScheduleFieldsProps) {
  const { t, i18n } = useTranslation("pipelines");
  const locale = i18n.resolvedLanguage;
  const timezones = useMemo(() => Intl.supportedValuesOf("timeZone"), []);
  const debounced = useDebouncedValue(schedule, 400);
  const valid = debounced && ScheduleSchema.safeParse(debounced).success ? debounced : null;
  const preview = useSchedulePreview(valid);

  const set = (patch: Partial<Schedule>) => schedule && onScheduleChange({ ...schedule, ...patch });
  const invalid = (path: string) => (showErrors && invalidPaths.has(path)) || undefined;

  return (
    <div className="grid gap-4">
      {disabledReason && <p className="text-sm text-muted-foreground">{disabledReason}</p>}
      <div className="flex items-center gap-3">
        <Checkbox
          id="schedule-on"
          checked={schedule !== null}
          disabled={disabled}
          onCheckedChange={(checked) => {
            onScheduleChange(checked === true ? defaultSchedule() : null);
            onEnabledChange(checked === true);
          }}
        />
        <Label htmlFor="schedule-on">{t("editor.schedule.enabled")}</Label>
      </div>

      {schedule && (
        <>
          <div className="flex items-start gap-3">
            <Checkbox
              id="schedule-active"
              checked={enabled}
              disabled={disabled}
              onCheckedChange={(checked) => onEnabledChange(checked === true)}
              aria-describedby="schedule-active-hint"
            />
            <div className="grid gap-1">
              <Label htmlFor="schedule-active">{t("editor.schedule.active")}</Label>
              <p id="schedule-active-hint" className="text-xs text-muted-foreground">
                {t("editor.schedule.activeHint")}
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="schedule-every">{t("editor.schedule.every")}</Label>
              <div className="flex gap-2">
                <Input
                  id="schedule-every"
                  type="number"
                  min={1}
                  max={365}
                  className="w-20"
                  value={numberValue(schedule.every)}
                  disabled={disabled}
                  onChange={(event) => set({ every: parseNumber(event.target.value) })}
                  aria-invalid={invalid("every")}
                />
                <Select
                  value={schedule.unit}
                  disabled={disabled}
                  onValueChange={(value) => {
                    const unit = ScheduleUnitSchema.safeParse(value);
                    if (unit.success) set({ unit: unit.data });
                  }}
                >
                  <SelectTrigger aria-label={t("editor.schedule.every")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ScheduleUnitSchema.options.map((unit) => (
                      <SelectItem key={unit} value={unit}>
                        {t(`editor.schedule.units.${unit}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="schedule-starts">{t("editor.schedule.startsAt")}</Label>
              <Input
                id="schedule-starts"
                type="datetime-local"
                value={schedule.startsAt}
                disabled={disabled}
                onChange={(event) => set({ startsAt: event.target.value.slice(0, 16) })}
                aria-invalid={invalid("startsAt")}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="schedule-timezone">{t("editor.schedule.timezone")}</Label>
              <Select value={schedule.timezone} disabled={disabled} onValueChange={(timezone) => set({ timezone })}>
                <SelectTrigger id="schedule-timezone" aria-invalid={invalid("timezone")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(timezones.includes(schedule.timezone) ? timezones : [schedule.timezone, ...timezones]).map(
                    (zone) => (
                      <SelectItem key={zone} value={zone}>
                        {zone}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <fieldset className="grid gap-1.5">
            <legend className="mb-1 text-sm font-medium">{t("editor.schedule.days")}</legend>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAY_KEYS.map((key, index) => {
                const day = index + 1;
                const isOn = schedule.daysOfWeek.includes(day);
                return (
                  <Button
                    key={key}
                    type="button"
                    size="sm"
                    variant={isOn ? "default" : "outline"}
                    aria-pressed={isOn}
                    disabled={disabled}
                    onClick={() =>
                      set({
                        daysOfWeek: isOn
                          ? schedule.daysOfWeek.filter((existing) => existing !== day)
                          : [...schedule.daysOfWeek, day].toSorted((a, b) => a - b),
                      })
                    }
                  >
                    {t(key)}
                  </Button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">{t("editor.schedule.daysHint")}</p>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-center gap-3">
              <Checkbox
                id="schedule-window"
                checked={schedule.windowMinutes !== null}
                disabled={disabled}
                onCheckedChange={(checked) =>
                  set({ windowMinutes: checked === true ? DEFAULT_WINDOW_MINUTES : null })
                }
              />
              <Label htmlFor="schedule-window">{t("editor.schedule.window")}</Label>
            </div>
            {schedule.windowMinutes !== null && (
              <div className="grid gap-1.5">
                <Label htmlFor="schedule-window-minutes">{t("editor.schedule.windowMinutes")}</Label>
                <Input
                  id="schedule-window-minutes"
                  type="number"
                  min={5}
                  max={10_080}
                  value={numberValue(schedule.windowMinutes)}
                  disabled={disabled}
                  onChange={(event) => set({ windowMinutes: parseNumber(event.target.value) })}
                  aria-invalid={invalid("windowMinutes")}
                  aria-describedby="schedule-window-hint"
                />
                <p
                  id="schedule-window-hint"
                  className={invalid("windowMinutes") ? "text-sm text-destructive" : "text-xs text-muted-foreground"}
                >
                  {t("editor.schedule.windowHint")}
                </p>
              </div>
            )}
          </div>

          <div className="grid gap-1.5" aria-live="polite">
            <p className="text-sm font-medium">{t("editor.schedule.nextRuns")}</p>
            {preview.data && preview.data.times.length === 0 ? (
              <p className="text-sm text-destructive">{t("editor.schedule.noRuns")}</p>
            ) : (
              <ul className="grid gap-0.5 text-sm text-muted-foreground tabular-nums">
                {(valid ? (preview.data?.times ?? []) : []).map((time) => (
                  <li key={time}>{formatDateTime(time, locale)}</li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
