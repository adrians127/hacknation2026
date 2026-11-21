import { PrismaPg } from "@prisma/adapter-pg";

import { env } from "~backend/config/env";
import { Prisma, PrismaClient } from "~backend/generated/prisma/client";

const adapter = new PrismaPg({ connectionString: env.databaseUrl });

export const prisma = new PrismaClient({ adapter });

/** A unique constraint rejected the write (e.g. a duplicate email or role name). */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
