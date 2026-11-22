-- CreateEnum
CREATE TYPE "ScanOrigin" AS ENUM ('adhoc', 'manual', 'scheduled', 'imported');

-- AlterTable
ALTER TABLE "Scan" ADD COLUMN     "importKey" TEXT,
ADD COLUMN     "name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "origin" "ScanOrigin" NOT NULL DEFAULT 'adhoc';

-- CreateIndex
CREATE UNIQUE INDEX "Scan_importKey_key" ON "Scan"("importKey");
