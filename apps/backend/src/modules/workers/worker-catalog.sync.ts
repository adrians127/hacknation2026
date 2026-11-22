import { BUILTIN_WORKERS, WorkerParamsSchema } from "@subsurf/contracts/workers/worker-catalog";

import { prisma } from "~backend/lib/prisma";

/**
 * Makes the built-in workers match the code catalog: their definition (stage, inputs, split
 * strategies, fields) is overwritten, while `enabled`, `maxRate` and `defaults` stay the admins'.
 * Defaults for fields that no longer exist are dropped. Idempotent; runs at startup and in the seed.
 */
export async function syncWorkerCatalog(): Promise<void> {
  for (const worker of BUILTIN_WORKERS) {
    const definition = {
      displayName: worker.displayName,
      description: worker.description,
      isBuiltin: true,
      stage: worker.stage,
      inputs: [...worker.inputs],
      splitStrategies: [...worker.splitStrategies],
      paramFields: worker.paramFields.map((field) => ({ ...field })),
    };
    const stored = await prisma.worker.upsert({
      where: { name: worker.name },
      create: { name: worker.name, ...definition, enabled: true, maxRate: worker.maxRate },
      update: definition,
    });

    const keys = new Set(worker.paramFields.map((field) => field.key));
    const defaults = WorkerParamsSchema.safeParse(stored.defaults);
    const kept = Object.fromEntries(
      Object.entries(defaults.success ? defaults.data : {}).filter(([key]) => keys.has(key)),
    );
    if (!defaults.success || Object.keys(kept).length !== Object.keys(defaults.data).length) {
      await prisma.worker.update({ where: { id: stored.id }, data: { defaults: kept } });
    }
  }
}
