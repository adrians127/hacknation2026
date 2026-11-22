-- `Scan.origin` (20261122032500_scan_import) said what `Scan.trigger` from the pipelines
-- migration says. One column stays: imported scans move over, then origin goes.
UPDATE "Scan" SET "trigger" = 'results_import' WHERE "origin" = 'imported';

-- AlterTable
ALTER TABLE "Scan" DROP COLUMN "origin";

-- DropEnum
DROP TYPE "ScanOrigin";
