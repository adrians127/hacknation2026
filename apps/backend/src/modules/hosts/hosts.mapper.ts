import type { HostEdits, ServiceEdits } from "@subsurf/contracts/hosts/hosts.schema";

import type { Host, Service } from "~backend/generated/prisma/client";
import { decryptText } from "~backend/lib/crypto";

export function toHostEdits(host: Pick<Host, "id" | "triage" | "tags" | "note">): HostEdits {
  return { id: host.id, triage: host.triage, tags: host.tags, note: decryptText(host.note) };
}

export function toServiceEdits(service: Service): ServiceEdits {
  return {
    ...toHostEdits(service),
    overrides: {
      name: service.nameOverride,
      product: service.productOverride,
      version: service.versionOverride,
    },
  };
}
