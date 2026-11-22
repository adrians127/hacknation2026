import {
  DayPeriodSchema,
  StabilityClassSchema,
  type DayPeriod,
  type StabilityClass,
  type StabilityReport,
  type StabilityReportQuery,
  type TimeOfDayReport,
  type TimeOfDayReportQuery,
} from "@subsurf/contracts/reports/reports.schema";
import type { HostStatus } from "@subsurf/contracts/workers/worker-result.schema";

import type { Prisma, Scan as ScanRow } from "~backend/generated/prisma/client";
import { chunks } from "~backend/lib/chunks";
import { prisma } from "~backend/lib/prisma";
import { byIpNumber, scanTime, toReportScan } from "~backend/modules/reports/report-data";
import { effectiveSql, findScan } from "~backend/modules/scans/scan-results.service";

interface Observed {
  scanId: string;
  ip: string;
  ipNumber: bigint;
  hostId: string | null;
  status: HostStatus;
  ports: { port: number }[];
  hostnames: { name: string }[];
}

const ID_CHUNK = 10_000;

const OBSERVED_SELECT = {
  scanId: true,
  ip: true,
  ipNumber: true,
  hostId: true,
  status: true,
  ports: { select: { port: true } },
  hostnames: { select: { name: true }, orderBy: { name: "asc" } },
} as const satisfies Prisma.HostObservationSelect;

/** One effective observation per scan and address, for addresses up in at least one of the scans. */
async function observationsOf(scanIds: readonly string[]): Promise<Observed[]> {
  if (scanIds.length === 0) return [];
  // Most addresses of a large range never answer: leave them out before loading anything.
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    WITH effective AS (${effectiveSql(scanIds)})
    SELECT e.id FROM effective e
    WHERE e.ip IN (SELECT ip FROM effective WHERE status = 'up')`;
  const observations: Observed[] = [];
  for (const ids of chunks(rows.map((row) => row.id), ID_CHUNK)) {
    observations.push(...(await prisma.hostObservation.findMany({ where: { id: { in: ids } }, select: OBSERVED_SELECT })));
  }
  return observations;
}

function byAddress(observations: readonly Observed[]): Map<string, Observed[]> {
  const grouped = new Map<string, Observed[]>();
  for (const observation of observations) {
    const list = grouped.get(observation.ip) ?? [];
    list.push(observation);
    grouped.set(observation.ip, list);
  }
  return grouped;
}

const lastNames = (rows: readonly Observed[]) => [
  ...new Set(rows.findLast((row) => row.status === "up")?.hostnames.map((hostname) => hostname.name) ?? []),
];

// --- Stability ------------------------------------------------------------------------------

const NO_ANSWER = new Set<HostStatus>(["timeout", "cancelled", "failed"]);

export interface Stability {
  class: StabilityClass | null;
  up: number;
  transitions: number;
  sinceLastUp: number;
  unstablePorts: number[];
}

/**
 * Classifies one address from its answers in the window, oldest first (`null` = not covered).
 * `null` class = stable, or simply new: nothing to report.
 */
export function classify(
  history: readonly (HostStatus | null)[],
  ports: readonly (readonly number[] | null)[],
  inactiveAfter: number,
  wasUpBefore: boolean,
): Stability {
  const answers = history.filter((status) => status !== null);
  const isUp = answers.map((status) => status === "up");
  let transitions = 0;
  for (let index = 1; index < isUp.length; index += 1) if (isUp[index] !== isUp[index - 1]) transitions += 1;
  const up = isUp.filter(Boolean).length;
  const lastUp = isUp.lastIndexOf(true);
  const sinceLastUp = lastUp === -1 ? answers.length : answers.length - 1 - lastUp;

  // A port is unstable when it opens and closes more than once across the host's `up` answers.
  const upPorts = ports.filter((list): list is readonly number[] => list !== null);
  const flips = new Map<number, number>();
  for (let index = 1; index < upPorts.length; index += 1) {
    const before = new Set(upPorts[index - 1]);
    const after = new Set(upPorts[index]);
    for (const port of new Set([...before, ...after])) {
      if (before.has(port) !== after.has(port)) flips.set(port, (flips.get(port) ?? 0) + 1);
    }
  }
  const unstablePorts = [...flips].filter(([, count]) => count >= 2).map(([port]) => port).toSorted((a, b) => a - b);

  const result = { up, transitions, sinceLastUp, unstablePorts };
  if (up === 0) return { ...result, class: null };
  const last = answers.at(-1);
  if (transitions >= 2) return { ...result, class: "flapping" };
  if (last === "up") {
    if (transitions === 1 && wasUpBefore) return { ...result, class: "returned" };
    return { ...result, class: unstablePorts.length > 0 ? "unstable-ports" : null };
  }
  const trailing = answers.slice(lastUp + 1);
  if (trailing.every((status) => NO_ANSWER.has(status))) return { ...result, class: "unresponsive" };
  let downs = 0;
  for (const status of trailing.toReversed()) {
    if (status !== "down") break;
    downs += 1;
  }
  return { ...result, class: downs >= inactiveAfter ? "inactive" : "going-quiet" };
}

const CLASS_ORDER = new Map(StabilityClassSchema.options.map((name, index) => [name, index]));
const classOrder = (name: StabilityClass) => CLASS_ORDER.get(name) ?? 0;
const emptyCounts = (): Record<StabilityClass, number> => ({
  flapping: 0,
  unresponsive: 0,
  inactive: 0,
  "going-quiet": 0,
  "unstable-ports": 0,
  returned: 0,
});

async function windowScans(anchorId: string | undefined, size: number): Promise<ScanRow[]> {
  const anchor = anchorId
    ? await findScan(anchorId)
    : await prisma.scan.findFirst({ where: { results: { some: {} } }, orderBy: { createdAt: "desc" } });
  if (!anchor) return [];
  const scans = await prisma.scan.findMany({
    where: { createdAt: { lte: anchor.createdAt }, results: { some: {} } },
    orderBy: { createdAt: "desc" },
    take: size,
  });
  return scans.toReversed();
}

export const historyReportsService = {
  async stability(query: StabilityReportQuery): Promise<StabilityReport> {
    const scans = await windowScans(query.scanId, query.window);
    const index = new Map(scans.map((scan, position) => [scan.id, position]));
    const grouped = byAddress(await observationsOf(scans.map((scan) => scan.id)));
    const hostIds = [...new Set([...grouped.values()].flatMap((rows) => rows.flatMap((row) => (row.hostId ? [row.hostId] : []))))];
    const assets = new Map(
      (await prisma.host.findMany({ where: { id: { in: hostIds } }, select: { id: true, firstSeenAt: true } })).map((host) => [
        host.id,
        host.firstSeenAt,
      ]),
    );
    const windowStart = scans[0] ? scanTime(scans[0]) : new Date();

    const counts = emptyCounts();
    const hosts: StabilityReport["hosts"] = [];
    for (const rows of grouped.values()) {
      const hostId = rows.find((row) => row.hostId)?.hostId;
      if (!hostId) continue;
      const history: (HostStatus | null)[] = scans.map(() => null);
      const ports: (number[] | null)[] = scans.map(() => null);
      for (const row of rows) {
        const position = index.get(row.scanId);
        if (position === undefined) continue;
        history[position] = row.status;
        ports[position] = row.status === "up" ? row.ports.map((port) => port.port) : null;
      }
      const firstSeen = assets.get(hostId);
      const stability = classify(history, ports, query.inactiveAfter, firstSeen !== undefined && firstSeen < windowStart);
      if (!stability.class) continue;
      counts[stability.class] += 1;
      const [first] = rows;
      hosts.push({
        hostId,
        ip: first?.ip ?? "",
        hostnames: lastNames(rows),
        class: stability.class,
        history,
        up: stability.up,
        transitions: stability.transitions,
        sinceLastUp: stability.sinceLastUp,
        unstablePorts: stability.unstablePorts,
        recheck: stability.class !== "inactive" && stability.class !== "returned",
      });
    }

    const ipNumbers = new Map([...grouped.values()].map((rows) => [rows[0]?.ip ?? "", rows[0]?.ipNumber ?? 0n]));
    return {
      generatedAt: new Date().toISOString(),
      scans: scans.map(toReportScan),
      inactiveAfter: query.inactiveAfter,
      counts,
      hosts: hosts.toSorted(
        (a, b) =>
          classOrder(a.class) - classOrder(b.class) ||
          b.transitions - a.transitions ||
          byIpNumber({ ipNumber: ipNumbers.get(a.ip) ?? 0n }, { ipNumber: ipNumbers.get(b.ip) ?? 0n }),
      ),
    };
  },

  async timeOfDay(query: TimeOfDayReportQuery): Promise<TimeOfDayReport> {
    const scans = await prisma.scan.findMany({
      where: { results: { some: {} } },
      orderBy: { createdAt: "desc" },
      take: query.scans,
    });
    const periodOf = new Map(scans.map((scan) => [scan.id, dayPeriod(scanTime(scan), query.utcOffsetMinutes)]));
    const scansPerPeriod = new Map<DayPeriod, number>();
    for (const period of periodOf.values()) scansPerPeriod.set(period, (scansPerPeriod.get(period) ?? 0) + 1);
    const comparable = scansPerPeriod.size >= 2;
    const base = {
      generatedAt: new Date().toISOString(),
      utcOffsetMinutes: query.utcOffsetMinutes,
      periods: DayPeriodSchema.options.map((period) => ({ period, scans: scansPerPeriod.get(period) ?? 0 })),
      comparable,
    };
    if (!comparable) return { ...base, hosts: [] };

    const grouped = byAddress(await observationsOf(scans.map((scan) => scan.id)));
    const hosts: TimeOfDayReport["hosts"] = [];
    for (const rows of [...grouped.values()].toSorted((a, b) => byIpNumber(a[0] ?? { ipNumber: 0n }, b[0] ?? { ipNumber: 0n }))) {
      const hostId = rows.find((row) => row.hostId)?.hostId;
      if (!hostId || !rows.some((row) => row.status === "up")) continue;
      const periods = DayPeriodSchema.options.map((period) => {
        const inPeriod = rows.filter((row) => periodOf.get(row.scanId) === period && !NO_ANSWER.has(row.status));
        const upRows = inPeriod.filter((row) => row.status === "up");
        return {
          period,
          observed: inPeriod.length,
          up: upRows.length,
          ports: [...new Set(upRows.flatMap((row) => row.ports.map((port) => port.port)))].toSorted((a, b) => a - b),
        };
      });
      const answered = periods.filter((entry) => entry.observed > 0);
      const upIn = answered.filter((entry) => entry.up / entry.observed >= 0.75).map((entry) => entry.period);
      const downIn = answered.filter((entry) => entry.up / entry.observed <= 0.25).map((entry) => entry.period);
      const upPeriods = periods.filter((entry) => entry.up > 0);
      const allPorts = new Set(upPeriods.flatMap((entry) => entry.ports));
      const periodPorts =
        upPeriods.length < 2
          ? []
          : [...allPorts].filter((port) => upPeriods.some((entry) => !entry.ports.includes(port))).toSorted((a, b) => a - b);
      if ((upIn.length === 0 || downIn.length === 0) && periodPorts.length === 0) continue;
      hosts.push({ hostId, ip: rows[0]?.ip ?? "", hostnames: lastNames(rows), periods, upIn, downIn, periodPorts });
    }
    return { ...base, hosts };
  },
};

export function dayPeriod(at: Date, utcOffsetMinutes: number): DayPeriod {
  const minutes = (((at.getUTCHours() * 60 + at.getUTCMinutes() + utcOffsetMinutes) % 1440) + 1440) % 1440;
  const hour = Math.floor(minutes / 60);
  if (hour < 6) return "night";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}
