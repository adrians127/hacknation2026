import type {
  DefectDojoPush,
  DefectDojoPushBody,
  DefectDojoPushStats,
} from "@subsurf/contracts/defectdojo/defectdojo.schema";
import { effectiveServiceIdentity } from "@subsurf/contracts/hosts/hosts.schema";

import { HttpError } from "~backend/lib/http-error";
import { logger } from "~backend/lib/logger";
import { prisma } from "~backend/lib/prisma";
import { decryptText } from "~backend/lib/crypto";
import {
  configuredClient,
  type DefectDojoClient,
  type DojoImportResult,
} from "~backend/modules/defectdojo/defectdojo.client";
import { PUSH_INCLUDE, toDefectDojoPush } from "~backend/modules/defectdojo/defectdojo.mapper";
import { buildReport, type ExportService } from "~backend/modules/defectdojo/defectdojo.report";
import { openPortDetails } from "~backend/modules/results/details";
import {
  hostnames,
  resolveServices,
  type HostInScan,
} from "~backend/modules/scans/scan-results.mapper";
import { scanResultsService } from "~backend/modules/scans/scan-results.service";

/** Where every push lands; created by the first import (`auto_create_context`). */
export const DOJO_CONTEXT = {
  productType: "SubSurf",
  product: "SubSurf discovery",
  engagement: "SubSurf continuous discovery",
  test: "SubSurf scan results",
} as const;

const REPORT_VERSION = "1";
const STALE_PUSH_MS = 10 * 60_000;

/**
 * Services of the scan to push. `gone` services are left out (a whole-scan reimport closes
 * them); an `unknown` host keeps the services it had in the base scan, since a timeout is not
 * an answer and must not close anything (docs/worker-result-format.md).
 */
export function servicesToPush(hosts: readonly HostInScan[], body: DefectDojoPushBody): ExportService[] {
  const hostIds = new Set(body.hostIds ?? []);
  const serviceIds = new Set(body.serviceIds ?? []);
  const selection = hostIds.size > 0 || serviceIds.size > 0;

  return hosts.flatMap((entry) => {
    const names = hostnames(entry.current.status === "up" ? entry.current : entry.base);
    return resolveServices(entry)
      .filter(({ diff }) => diff.change !== "gone")
      .filter(({ service }) => !selection || hostIds.has(entry.host.id) || serviceIds.has(service.id))
      .map(({ service, port, diff }): ExportService => ({
        ip: entry.host.ip,
        hostnames: names,
        port: service.port,
        identity: effectiveServiceIdentity({
          observed: { name: port.serviceName, product: port.serviceProduct, version: port.serviceVersion },
          overrides: {
            name: service.nameOverride,
            product: service.productOverride,
            version: service.versionOverride,
          },
        }),
        extraInfo: port.serviceExtraInfo,
        cpe: port.serviceCpe,
        http: openPortDetails(port.details).http,
        triage: service.triage,
        tags: service.tags,
        note: decryptText(service.note),
        detections:
          (diff.observedIn === "base" ? entry.detections.base : entry.detections.current).get(service.id) ?? [],
      }));
  });
}

const count = (bucket: { total?: { total?: number } } | undefined) => bucket?.total?.total ?? 0;

function pushStats(result: DojoImportResult, kind: "import" | "reimport"): DefectDojoPushStats {
  const delta = result.statistics?.delta;
  if (kind === "import" && !delta) {
    return { created: result.statistics?.after?.total?.total ?? 0, closed: 0, reactivated: 0, untouched: 0 };
  }
  return {
    created: count(delta?.created),
    closed: count(delta?.closed),
    reactivated: count(delta?.reactivated),
    untouched: count(delta?.untouched),
  };
}

/** The test earlier pushes went into, if DefectDojo still has it. */
async function existingTest(dojo: DefectDojoClient): Promise<number | null> {
  const last = await prisma.defectDojoPush.findFirst({
    where: { status: "succeeded", testId: { not: null } },
    orderBy: { startedAt: "desc" },
    select: { testId: true },
  });
  return last?.testId != null && (await dojo.testExists(last.testId)) ? last.testId : null;
}

let pushInProgress = false;

export const defectDojoPushService = {
  async push(userId: string, body: DefectDojoPushBody): Promise<DefectDojoPush> {
    const dojo = configuredClient();
    const { scan, hosts } = await scanResultsService.hostsForExport(body.scanId);
    const scope = (body.hostIds?.length ?? 0) + (body.serviceIds?.length ?? 0) > 0 ? "selection" : "scan";
    const services = servicesToPush(hosts, body);
    if (services.length === 0) {
      throw HttpError.badRequest("The scan has no open services to push", "NOTHING_TO_PUSH");
    }

    const running = await prisma.defectDojoPush.findFirst({
      where: { status: "running", startedAt: { gt: new Date(Date.now() - STALE_PUSH_MS) } },
    });
    if (pushInProgress || running) {
      throw HttpError.conflict("A DefectDojo push is already running", "DEFECTDOJO_PUSH_RUNNING");
    }

    pushInProgress = true;
    const row = await prisma.defectDojoPush.create({
      data: {
        scanId: scan.id,
        scope,
        startedById: userId,
        findings: services.reduce(
          (sum, service) => sum + 1 + service.detections.filter((detection) => detection.severity !== null).length,
          0,
        ),
      },
    });
    try {
      const scanDate = (scan.startedAt ?? scan.createdAt).toISOString().slice(0, 10);
      const report = buildReport(services, scanDate, REPORT_VERSION);
      const form = new FormData();
      form.set("scan_type", "Generic Findings Import");
      form.set("file", new Blob([JSON.stringify(report)], { type: "application/json" }), "subsurf-scan.json");
      form.set("scan_date", scanDate);
      form.set("minimum_severity", "Info");
      form.set("group_by", "component_name");
      form.set("deduplication_execution_mode", "sync");
      // A selection is a partial report: closing what it lacks would close the rest of the scan.
      form.set("close_old_findings", String(scope === "scan"));

      const testId = await existingTest(dojo);
      const kind = testId === null ? "import" : "reimport";
      if (testId === null) {
        form.set("product_type_name", DOJO_CONTEXT.productType);
        form.set("product_name", DOJO_CONTEXT.product);
        form.set("engagement_name", DOJO_CONTEXT.engagement);
        form.set("test_title", DOJO_CONTEXT.test);
        form.set("auto_create_context", "true");
        form.set("tags", "subsurf");
      } else {
        form.set("test", String(testId));
      }

      const result = await dojo.uploadReport(kind, form);
      const stats = pushStats(result, kind);
      const done = await prisma.defectDojoPush.update({
        where: { id: row.id },
        data: { status: "succeeded", finishedAt: new Date(), testId: result.test_id, stats },
        include: PUSH_INCLUDE,
      });
      logger.info({ pushId: row.id, scanId: scan.id, kind, stats }, "DefectDojo push finished");
      return toDefectDojoPush(done);
    } catch (error) {
      await prisma.defectDojoPush.update({
        where: { id: row.id },
        data: {
          status: "failed",
          finishedAt: new Date(),
          error: error instanceof HttpError ? error.message : "Internal error during the push",
        },
      });
      throw error;
    } finally {
      pushInProgress = false;
    }
  },
};
