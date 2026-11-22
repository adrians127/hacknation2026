// Encrypts values a migration left as plain JSON strings (`pnpm db:encrypt`). The backend does
// the same when it starts; this is for a database nobody has started it on yet.
import { encryptLegacyRows } from "~backend/lib/encrypt-legacy";
import { prisma } from "~backend/lib/prisma";

try {
  const encrypted = await encryptLegacyRows();
  console.log(`Encrypted at rest: ${encrypted} value(s) were still plain text`);
} finally {
  await prisma.$disconnect();
}
