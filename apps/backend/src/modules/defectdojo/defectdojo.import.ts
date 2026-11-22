import { z } from "zod";

import { MAX_TAGS, TagSchema } from "@subsurf/contracts/common/common.schema";
import type { TriageStatus } from "@subsurf/contracts/hosts/hosts.schema";

import type { DojoFinding, DojoProduct } from "~backend/modules/defectdojo/defectdojo.client";

/** Our own marker on everything SubSurf pushes; it says nothing about the asset. */
const IGNORED_TAGS = new Set(["subsurf"]);

const DEFAULT_PORTS: Record<string, number> = { "http:": 80, "https:": 443 };

export interface Address {
  ip: string;
  port: number;
}

export const addressKey = ({ ip, port }: Address) => `${ip}:${port}`;

const isIpv4 = (value: string) => z.ipv4().safeParse(value).success;

function address(ip: string, port: string | number): Address | undefined {
  const number = Number(port);
  return isIpv4(ip) && Number.isInteger(number) && number >= 1 && number <= 65_535
    ? { ip, port: number }
    : undefined;
}

function fromLocation(value: string): Address | undefined {
  try {
    const url = new URL(value);
    const port = url.port === "" ? DEFAULT_PORTS[url.protocol] : Number(url.port);
    return port === undefined ? undefined : address(url.hostname, port);
  } catch {
    return undefined;
  }
}

/**
 * The host:port pairs a finding is about. Our own findings carry it in `unique_id_from_tool`
 * (`subsurf:<ip>:<port>:<id>`) and start the description with `<ip>:<port>/tcp`
 * (docs/defectdojo-integration.md); other scanners' findings are matched by their locations.
 */
export function findingAddresses(finding: DojoFinding): Address[] {
  const own = /^subsurf:([\d.]+):(\d+):/.exec(finding.unique_id_from_tool ?? "");
  const fromId = own && address(own[1], own[2]);
  if (fromId) return [fromId];

  const prefix = /^([\d.]+):(\d+)\/tcp\b/.exec(finding.description ?? "");
  const fromDescription = prefix && address(prefix[1], prefix[2]);
  if (fromDescription) return [fromDescription];

  const found = new Map<string, Address>();
  for (const location of finding.locations) {
    const parsed = fromLocation(location);
    if (parsed) found.set(addressKey(parsed), parsed);
  }
  return [...found.values()];
}

/** One of the findings `POST /defectdojo/push` creates (defectdojo.report.ts). */
const isOwnObservation = (finding: DojoFinding) =>
  /^subsurf:[\d.]+:\d+:service$/.test(finding.unique_id_from_tool ?? "");

const hasDecision = (finding: DojoFinding) =>
  finding.verified || finding.false_p || finding.risk_accepted || finding.out_of_scope;

/** A finding someone ruled out describes nothing real about the service. */
const isRuledOut = (finding: DojoFinding) => finding.false_p || finding.out_of_scope;

function cleanTags(tags: Iterable<string>): string[] {
  const clean: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim();
    if (!IGNORED_TAGS.has(tag.toLowerCase()) && TagSchema.safeParse(tag).success) clean.push(tag);
  }
  return clean;
}

/**
 * Adds tags the asset does not have yet (case-insensitive), up to the limit a user edit
 * accepts, so the next `PATCH` with the full list still validates.
 */
export function mergeTags(existing: readonly string[], incoming: Iterable<string>) {
  const tags = [...existing];
  const seen = new Set(existing.map((tag) => tag.toLowerCase()));
  let added = 0;
  let skipped = 0;
  for (const tag of incoming) {
    if (seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    if (tags.length >= MAX_TAGS) {
      skipped += 1;
      continue;
    }
    tags.push(tag);
    added += 1;
  }
  return { tags, added, skipped };
}

/**
 * DefectDojo's verdict on a service, from all its findings; `null` while one is still open
 * and unconfirmed. A plain `is_mitigated` is no verdict: a reimport sets it on every finding
 * the scan no longer reports (our own push included), the same as a manual "fixed".
 */
export function triageFromFindings(all: readonly DojoFinding[]): TriageStatus | null {
  // Our pushed observations mirror SubSurf's own state; only a decision made on them counts.
  const findings = all.filter((finding) => !isOwnObservation(finding) || hasDecision(finding));
  if (findings.length === 0) return null;
  if (findings.some((finding) => finding.active && finding.verified)) return "important";
  if (findings.some((finding) => finding.active)) return null;
  if (findings.every((finding) => finding.false_p)) return "false_positive";
  if (findings.some((finding) => finding.false_p || finding.risk_accepted || finding.out_of_scope)) {
    return "reviewed";
  }
  return null;
}

export interface Remediation {
  plannedOn: string | null;
  slaDueOn: string | null;
  riskAcceptedUntil: string | null;
}

const day = (value: string | null | undefined) =>
  value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;

function earliest(values: Iterable<string | null | undefined>): string | null {
  let result: string | null = null;
  for (const value of values) {
    const date = day(value);
    if (date && (result === null || date < result)) result = date;
  }
  return result;
}

/** The earliest date of each kind; SLA and plans only count while a finding is open. */
export function remediationFromFindings(findings: readonly DojoFinding[]): Remediation {
  const open = findings.filter((finding) => finding.active);
  return {
    plannedOn: earliest(open.map((finding) => finding.planned_remediation_date)),
    slaDueOn: earliest(open.map((finding) => finding.sla_expiration_date)),
    riskAcceptedUntil: earliest(
      findings
        .filter((finding) => finding.risk_accepted)
        .flatMap((finding) => finding.accepted_risks.map((risk) => risk.expiration_date)),
    ),
  };
}

export interface ServicePlan {
  address: Address;
  findings: DojoFinding[];
  tags: string[];
}

export interface ImportPlan {
  findings: number;
  /** Findings without any usable host:port. */
  withoutAddress: number;
  services: Map<string, ServicePlan>;
  /** Product tags and owners, per IP. */
  hostTags: Map<string, Set<string>>;
}

export interface ProductData {
  product: DojoProduct;
  findings: DojoFinding[];
}

/** Groups every finding by the service it is about and collects the tags each asset gets. */
export function planImport(
  products: readonly ProductData[],
  usernames: ReadonlyMap<number, string>,
): ImportPlan {
  const plan: ImportPlan = { findings: 0, withoutAddress: 0, services: new Map(), hostTags: new Map() };

  for (const { product, findings } of products) {
    const owners = [
      product.product_manager != null && usernames.get(product.product_manager),
      product.technical_contact != null && usernames.get(product.technical_contact),
    ];
    const productTags = cleanTags([
      ...product.tags,
      ...(owners[0] ? [`owner:${owners[0]}`] : []),
      ...(owners[1] ? [`contact:${owners[1]}`] : []),
    ]);

    for (const finding of findings) {
      plan.findings += 1;
      const addresses = findingAddresses(finding);
      if (addresses.length === 0) plan.withoutAddress += 1;

      for (const found of addresses) {
        const hostTags = plan.hostTags.get(found.ip) ?? new Set<string>();
        for (const tag of productTags) hostTags.add(tag);
        plan.hostTags.set(found.ip, hostTags);

        const key = addressKey(found);
        const service = plan.services.get(key) ?? { address: found, findings: [], tags: [] };
        service.findings.push(finding);
        if (!isRuledOut(finding)) service.tags.push(...cleanTags(finding.tags));
        plan.services.set(key, service);
      }
    }
  }

  for (const service of plan.services.values()) service.tags = [...new Set(service.tags)].toSorted();
  return plan;
}
