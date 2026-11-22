import { useState, type PointerEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface TrendPoint {
  date: string;
  value: number;
}

const WIDTH = 240;
const HEIGHT = 40;
const PAD = 5;

/**
 * One value per scan, oldest on the left: a muted line with the newest point in the accent.
 * Hovering or focusing shows the value at the nearest scan; the hidden table keeps every value
 * reachable without a pointer.
 */
function Sparkline({ label, points }: { label: string; points: readonly TrendPoint[] }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const [active, setActive] = useState<number | null>(null);
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const x = (index: number) => PAD + (index * (WIDTH - 2 * PAD)) / (points.length - 1);
  const y = (value: number) => HEIGHT - PAD - ((value - min) * (HEIGHT - 2 * PAD)) / span;
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(point.value)}`).join(" ");
  const last = points.length - 1;
  const shown = active ?? last;
  const shownPoint = points[shown];
  const readout = (point: TrendPoint) =>
    t("dashboard.stats.trendPoint", {
      date: formatDateTime(point.date, locale),
      value: formatNumber(point.value, locale),
    });

  const pick = (event: PointerEvent<HTMLInputElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - box.left) / box.width;
    setActive(Math.min(last, Math.max(0, Math.round(ratio * last))));
  };

  return (
    <div className="grid gap-1">
      <div className="relative h-10">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full overflow-visible"
          aria-hidden
        >
          {active !== null && (
            <line
              x1={x(active)}
              x2={x(active)}
              y1={0}
              y2={HEIGHT}
              className="stroke-muted-foreground/40"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}
          <path
            d={path}
            fill="none"
            strokeWidth={2}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            className="stroke-muted-foreground"
          />
        </svg>
        {/* Dots as HTML, so the stretched SVG does not squash them into ellipses. */}
        {[last, ...(active !== null && active !== last ? [active] : [])].map((index) => (
          <span
            key={index}
            aria-hidden
            className={cn(
              "absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card",
              index === last ? "bg-brand" : "bg-foreground",
            )}
            style={{
              left: `${(x(index) / WIDTH) * 100}%`,
              top: `${(y(points[index]?.value ?? 0) / HEIGHT) * 100}%`,
            }}
          />
        ))}
        {/* The pointer and the arrow keys step through the scans on a native range input. */}
        <input
          type="range"
          min={0}
          max={last}
          step={1}
          value={shown}
          aria-label={t("dashboard.stats.trend", { label })}
          aria-valuetext={shownPoint && readout(shownPoint)}
          onChange={(event) => setActive(Number(event.target.value))}
          onPointerMove={pick}
          onPointerLeave={() => setActive(null)}
          onFocus={() => setActive(last)}
          onBlur={() => setActive(null)}
          className="absolute inset-0 h-full w-full cursor-crosshair opacity-0"
        />
      </div>
      <p className={cn("h-4 text-xs text-muted-foreground tabular-nums", active === null && "invisible")} aria-live="polite">
        {shownPoint && readout(shownPoint)}
      </p>
      <table className="sr-only">
        <caption>{t("dashboard.stats.trend", { label })}</caption>
        <tbody>
          {points.map((point) => (
            <tr key={point.date}>
              <td>{readout(point)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A headline number, optionally with its change since the previous scan, a trend and a link. */
export function StatTile({
  label,
  value,
  hint,
  trend,
  to,
  icon,
}: {
  label: string;
  value: number;
  hint?: string;
  trend?: readonly TrendPoint[];
  to?: string;
  icon?: ReactNode;
}) {
  const { i18n } = useTranslation();
  const number = <span className="text-3xl font-semibold tabular-nums">{formatNumber(value, i18n.resolvedLanguage)}</span>;

  return (
    <Card>
      <CardContent className="grid gap-1.5">
        <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>{label}</span>
          {icon}
        </div>
        {to ? (
          <Link to={to} className="w-fit hover:underline">
            {number}
          </Link>
        ) : (
          number
        )}
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        {trend && trend.length > 1 && <Sparkline label={label} points={trend} />}
      </CardContent>
    </Card>
  );
}
