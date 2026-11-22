import type { Schedule } from "@subsurf/contracts/pipelines/pipelines.schema";

// Fire times are k-th multiples of the interval after `startsAt`, in the schedule's time zone:
// days and weeks keep the wall-clock time across DST changes, hours are exact durations.

const UNIT_MS = { hour: 3_600_000, day: 86_400_000, week: 604_800_000 } as const;

// Enough for an hourly schedule restricted to one weekday (168 candidates per hit).
const MAX_STEPS = 10_000;

function anchor(schedule: Schedule): Temporal.ZonedDateTime {
  return Temporal.PlainDateTime.from(schedule.startsAt).toZonedDateTime(schedule.timezone);
}

function candidate(start: Temporal.ZonedDateTime, schedule: Schedule, k: number) {
  const amount = k * schedule.every;
  const units = { hour: { hours: amount }, day: { days: amount }, week: { weeks: amount } };
  return start.add(units[schedule.unit]);
}

const onAllowedDay = (time: Temporal.ZonedDateTime, schedule: Schedule) =>
  schedule.daysOfWeek.length === 0 || schedule.daysOfWeek.includes(time.dayOfWeek);

/** A lower bound for the index of the first candidate after `after` (DST shifts are < 1 unit). */
function startIndex(start: Temporal.ZonedDateTime, schedule: Schedule, after: Date): number {
  const period = UNIT_MS[schedule.unit] * schedule.every;
  return Math.max(0, Math.floor((after.getTime() - start.epochMilliseconds) / period) - 2);
}

/** The next `count` fire times strictly after `after`; fewer if the schedule never fires again. */
export function nextFireTimes(schedule: Schedule, after: Date, count: number): Date[] {
  const start = anchor(schedule);
  const times: Date[] = [];
  let k = startIndex(start, schedule, after);
  for (let steps = 0; times.length < count && steps < MAX_STEPS; steps += 1, k += 1) {
    const time = candidate(start, schedule, k);
    if (time.epochMilliseconds > after.getTime() && onAllowedDay(time, schedule)) {
      times.push(new Date(time.epochMilliseconds));
    }
  }
  return times;
}

export function nextFireAfter(schedule: Schedule, after: Date): Date | null {
  return nextFireTimes(schedule, after, 1)[0] ?? null;
}

/** The latest fire time at or before `at`: missed fires collapse into this one. */
export function lastFireAtOrBefore(schedule: Schedule, at: Date): Date | null {
  const start = anchor(schedule);
  const period = UNIT_MS[schedule.unit] * schedule.every;
  let k = Math.floor((at.getTime() - start.epochMilliseconds) / period) + 2;
  for (let steps = 0; k >= 0 && steps < MAX_STEPS; steps += 1, k -= 1) {
    const time = candidate(start, schedule, k);
    if (time.epochMilliseconds <= at.getTime() && onAllowedDay(time, schedule)) {
      return new Date(time.epochMilliseconds);
    }
  }
  return null;
}
