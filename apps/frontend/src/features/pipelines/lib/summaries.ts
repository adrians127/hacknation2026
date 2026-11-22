import { useTranslation } from "react-i18next";

import type {
  PipelineStepDetail,
  Schedule,
  TargetSelector,
} from "@subsurf/contracts/pipelines/pipelines.schema";

export const WEEKDAY_KEYS = [
  "weekdays.1",
  "weekdays.2",
  "weekdays.3",
  "weekdays.4",
  "weekdays.5",
  "weekdays.6",
  "weekdays.7",
] as const;

/** `90` → `1 h 30 min`; the units read the same in English and Polish. */
export function formatMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours > 0 && minutes > 0) return `${hours} h ${minutes} min`;
  return hours > 0 ? `${hours} h` : `${minutes} min`;
}

export function useScheduleSummary() {
  const { t } = useTranslation("pipelines");
  return (schedule: Schedule | null): string => {
    if (!schedule) return t("schedule.manual");
    const parts = [
      t(`schedule.every.${schedule.unit}`, { count: schedule.every }),
      t("schedule.from", { time: schedule.startsAt.slice(11, 16) }),
    ];
    if (schedule.daysOfWeek.length > 0) {
      const days = schedule.daysOfWeek
        .toSorted((a, b) => a - b)
        .map((day) => {
          const key = WEEKDAY_KEYS[day - 1];
          return key ? t(key) : "";
        });
      parts.push(t("schedule.onDays", { days: days.join(", ") }));
    }
    parts.push(
      schedule.windowMinutes === null
        ? t("schedule.noWindow")
        : t("schedule.window", { duration: formatMinutes(schedule.windowMinutes) }),
    );
    return `${parts.join(", ")} ${t("schedule.timezone", { timezone: schedule.timezone })}`;
  };
}

/** What the steps that scan targets cover, each prefixed with its worker when there are several. */
export function useTargetsSummary() {
  const { t } = useTranslation("pipelines");
  const selectorSummary = ({ tags, targetIds, ranges }: TargetSelector): string => {
    const picks = [
      ...(tags.length > 0 ? [t("targets.tags", { tags: tags.join(", ") })] : []),
      ...(targetIds.length > 0 ? [t("targets.picked", { count: targetIds.length })] : []),
    ];
    const base = picks.length > 0 ? picks.join(", ") : t("targets.all");
    return ranges.length > 0 ? `${base} ${t("targets.ranges", { count: ranges.length })}` : base;
  };
  return (steps: readonly PipelineStepDetail[]): string => {
    const scanning = steps.flatMap((step) => (step.targets ? [{ worker: step.worker, targets: step.targets }] : []));
    if (scanning.length === 1) return selectorSummary(scanning[0].targets);
    return scanning.map(({ worker, targets }) => `${worker.displayName}: ${selectorSummary(targets)}`).join(" · ");
  };
}
