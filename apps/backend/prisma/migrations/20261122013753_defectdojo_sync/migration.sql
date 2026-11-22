-- CreateEnum
CREATE TYPE "DefectDojoSyncStatus" AS ENUM ('running', 'succeeded', 'failed');

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "remediationPlannedOn" DATE,
ADD COLUMN     "riskAcceptedUntil" DATE,
ADD COLUMN     "slaDueOn" DATE;

-- CreateTable
CREATE TABLE "DefectDojoSync" (
    "id" UUID NOT NULL,
    "status" "DefectDojoSyncStatus" NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "startedById" UUID,
    "stats" JSONB,
    "error" TEXT,

    CONSTRAINT "DefectDojoSync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DefectDojoSync_startedById_idx" ON "DefectDojoSync"("startedById");

-- CreateIndex
CREATE INDEX "DefectDojoSync_startedAt_idx" ON "DefectDojoSync"("startedAt");

-- AddForeignKey
ALTER TABLE "DefectDojoSync" ADD CONSTRAINT "DefectDojoSync_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
