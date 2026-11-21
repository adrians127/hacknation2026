import type {
  CreateTargetBody,
  Target,
  TargetKind,
  TargetListResponse,
  UpdateTargetBody,
} from "@hacknation/contracts/targets/targets.schema";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const CIDR = /^(?:\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;

/** The backend will validate and classify targets; the mock only tells the shapes apart. */
export function detectTargetKind(value: string): TargetKind {
  if (CIDR.test(value)) return "cidr";
  if (IPV4.test(value)) return "ip";
  return "domain";
}

const targets: Target[] = [
  { id: crypto.randomUUID(), kind: "cidr", value: "10.20.0.0/16", note: "Campus network", tags: ["campus"], activeHosts: 1284, lastScanAt: ago(2 * HOUR), createdAt: ago(30 * DAY) },
  { id: crypto.randomUUID(), kind: "cidr", value: "172.16.8.0/22", note: "Student labs", tags: ["labs", "staging"], activeHosts: 212, lastScanAt: ago(2 * HOUR), createdAt: ago(21 * DAY) },
  { id: crypto.randomUUID(), kind: "domain", value: "example-agh.pl", note: "Main website", tags: ["web", "cms"], activeHosts: 3, lastScanAt: ago(26 * HOUR), createdAt: ago(14 * DAY) },
  { id: crypto.randomUUID(), kind: "ip", value: "192.0.2.15", note: "Unstable IoT gateway", tags: ["iot", "unstable"], activeHosts: 0, lastScanAt: ago(26 * HOUR), createdAt: ago(7 * DAY) },
];

// MOCK: GET/POST /targets, PATCH/DELETE /targets/{id}. Mutations change this list.
export const mockTargets = {
  list: (): TargetListResponse => ({ items: targets }),
  find: (id: string) => targets.find((target) => target.id === id),
  hasValue: (value: string) => targets.some((target) => target.value === value),
  add(body: CreateTargetBody): Target {
    const target: Target = {
      id: crypto.randomUUID(),
      kind: detectTargetKind(body.value),
      value: body.value,
      note: body.note ?? "",
      tags: body.tags ?? [],
      activeHosts: 0,
      lastScanAt: null,
      createdAt: new Date().toISOString(),
    };
    targets.unshift(target);
    return target;
  },
  update(target: Target, { note, tags }: UpdateTargetBody): Target {
    if (note !== undefined) target.note = note;
    if (tags !== undefined) target.tags = tags;
    return target;
  },
  remove(target: Target): void {
    targets.splice(targets.indexOf(target), 1);
  },
};
