-- DropIndex
DROP INDEX "ScanJobResult_leaseId_key";

-- AlterTable
ALTER TABLE "ScanJobResult" ADD COLUMN     "taskCount" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "taskIndex" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE UNIQUE INDEX "ScanJobResult_leaseId_taskIndex_key" ON "ScanJobResult"("leaseId", "taskIndex");

