import { PrismaPg } from "@prisma/adapter-pg";

import { env } from "~backend/config/env";
import { PrismaClient } from "~backend/generated/prisma/client";

const adapter = new PrismaPg({ connectionString: env.databaseUrl });

export const prisma = new PrismaClient({ adapter });
