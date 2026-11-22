-- Scan.warnings becomes an encrypted value (src/lib/crypto.ts), null when a scan has none.
-- The key never reaches the database, so lists already stored stay as plain arrays here and
-- encryptLegacyRows() (src/lib/encrypt-legacy.ts) encrypts them when the backend starts.
ALTER TABLE "Scan" ALTER COLUMN "warnings" DROP DEFAULT,
                   ALTER COLUMN "warnings" DROP NOT NULL;

UPDATE "Scan" SET "warnings" = NULL WHERE "warnings" = '[]'::jsonb;
