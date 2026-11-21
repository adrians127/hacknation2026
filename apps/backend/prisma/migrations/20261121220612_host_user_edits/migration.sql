-- `note` becomes encrypted JSON ({ "$enc": "v1.…" }). Nothing wrote notes before this migration
-- (no API existed), so recreating the column loses no data.
-- CreateEnum
CREATE TYPE "TriageStatus" AS ENUM ('unreviewed', 'reviewed', 'important', 'false_positive');

-- AlterTable
ALTER TABLE "Host" ADD COLUMN     "triage" "TriageStatus" NOT NULL DEFAULT 'unreviewed',
DROP COLUMN "note",
ADD COLUMN     "note" JSONB;

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "nameOverride" TEXT,
ADD COLUMN     "productOverride" TEXT,
ADD COLUMN     "triage" "TriageStatus" NOT NULL DEFAULT 'unreviewed',
ADD COLUMN     "versionOverride" TEXT,
DROP COLUMN "note",
ADD COLUMN     "note" JSONB;
