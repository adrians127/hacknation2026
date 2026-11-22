-- `note` becomes encrypted JSON ({ "$enc": "v1.…" }). The key lives in the backend, so the text
-- is kept here as a JSON string, and the backend encrypts what is not an envelope yet when it
-- starts (src/lib/encrypt-legacy.ts, also `pnpm --filter @subsurf/backend db:encrypt`).
ALTER TABLE "Target" ALTER COLUMN "note" DROP DEFAULT;
ALTER TABLE "Target" ALTER COLUMN "note" DROP NOT NULL;
ALTER TABLE "Target" ALTER COLUMN "note" TYPE JSONB
  USING CASE WHEN "note" = '' THEN NULL ELSE to_jsonb("note") END;

-- AlterTable
ALTER TABLE "Target" ADD COLUMN     "rangeEnd" BIGINT,
ADD COLUMN     "rangeStart" BIGINT;

-- `value` is normalized (an address, or a CIDR without host bits), so it casts to cidr.
UPDATE "Target" SET
  "rangeStart" = host(network("value"::cidr))::inet - '0.0.0.0'::inet,
  "rangeEnd" = host(broadcast("value"::cidr))::inet - '0.0.0.0'::inet
WHERE "kind" <> 'domain';

-- CreateIndex
CREATE INDEX "Target_rangeStart_idx" ON "Target"("rangeStart");
