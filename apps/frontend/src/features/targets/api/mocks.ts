import type {
  Target,
  TargetListResponse,
  UpdateTargetBody,
} from "@subsurf/contracts/targets/targets.schema";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const targets: Target[] = [
  { id: crypto.randomUUID(), kind: "cidr", value: "10.20.0.0/16", note: "Campus network", tags: ["campus"], activeHosts: 1284, lastScanAt: ago(2 * HOUR), createdAt: ago(30 * DAY) },
  { id: crypto.randomUUID(), kind: "cidr", value: "172.16.8.0/22", note: "Student labs", tags: ["labs", "staging"], activeHosts: 212, lastScanAt: ago(2 * HOUR), createdAt: ago(21 * DAY) },
  { id: crypto.randomUUID(), kind: "domain", value: "example-agh.pl", note: "Main website", tags: ["web", "cms"], activeHosts: 3, lastScanAt: ago(26 * HOUR), createdAt: ago(14 * DAY) },
  { id: crypto.randomUUID(), kind: "ip", value: "192.0.2.15", note: "Unstable IoT gateway", tags: ["iot", "unstable"], activeHosts: 0, lastScanAt: ago(26 * HOUR), createdAt: ago(7 * DAY) },
];

// MOCK: GET /targets, PATCH/DELETE /targets/{id}. Mutations change this list. New targets
// come from the real POST /targets/import and do not show up here until GET /targets exists.
export const mockTargets = {
  list: (): TargetListResponse => ({ items: targets }),
  find: (id: string) => targets.find((target) => target.id === id),
  update(target: Target, { note, tags }: UpdateTargetBody): Target {
    if (note !== undefined) target.note = note;
    if (tags !== undefined) target.tags = tags;
    return target;
  },
  remove(target: Target): void {
    targets.splice(targets.indexOf(target), 1);
  },
};
