import type { ServiceIdentity } from "@subsurf/contracts/hosts/hosts.schema";

export function serviceLabel({ name, product, version }: ServiceIdentity): string {
  const software = [product, version].filter(Boolean).join(" ");
  if (software && name) return `${software} (${name})`;
  return software || name || "—";
}

export function formatPercent(value: number, locale: string | undefined): string {
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(value);
}

/** `+01:00` for `utcOffsetMinutes = 60`. */
export function formatUtcOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const absolute = Math.abs(minutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

/** The viewer's offset from UTC in minutes, as the time-of-day report expects it. */
export const localUtcOffset = (): number => -new Date().getTimezoneOffset();
