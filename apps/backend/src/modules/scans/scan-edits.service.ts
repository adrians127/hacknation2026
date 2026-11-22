import type { UpdatedScan, UpdateScanBody } from "@subsurf/contracts/scans/scans.schema";

import { Prisma } from "~backend/generated/prisma/client";
import { decryptText, encryptText } from "~backend/lib/crypto";
import { HttpError } from "~backend/lib/http-error";
import { prisma } from "~backend/lib/prisma";
import { vulnerabilitiesService } from "~backend/modules/vulnerabilities/vulnerabilities.service";

/**
 * What users change on a scan itself: its name and note, in any state (PDF item 14), and its
 * removal. Results are never edited; host and service edits go through `hostsService`.
 */
export const scanEditsService = {
  async update(id: string, body: UpdateScanBody): Promise<UpdatedScan> {
    const { count } = await prisma.scan.updateMany({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name.trim() }),
        ...(body.note !== undefined && { note: encryptText(body.note.trim()) ?? Prisma.DbNull }),
      },
    });
    if (count === 0) throw HttpError.notFound("Scan not found");
    const scan = await prisma.scan.findUniqueOrThrow({
      where: { id },
      select: { id: true, name: true, note: true },
    });
    return { id: scan.id, name: scan.name, note: decryptText(scan.note) };
  },

  /**
   * Deletes the scan with its jobs and observations (cascades). Host and Service rows stay,
   * with the users' edits, and the remaining scans are compared with each other from then on.
   */
  async remove(id: string, requestedById: string): Promise<void> {
    const scan = await prisma.scan.findUnique({ where: { id }, select: { status: true } });
    if (!scan) throw HttpError.notFound("Scan not found");
    if (scan.status === "running") {
      throw HttpError.conflict("A running scan cannot be deleted", "SCAN_RUNNING");
    }
    await prisma.scan.delete({ where: { id } });
    // A service's matches are judged on its newest observation, which may have been this scan's.
    await vulnerabilitiesService.requestRematch(requestedById);
  },
};
