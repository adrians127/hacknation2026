-- CreateEnum
CREATE TYPE "DefectDojoPushScope" AS ENUM ('scan', 'selection');

-- CreateTable
CREATE TABLE "DefectDojoPush" (
    "id" UUID NOT NULL,
    "scanId" UUID NOT NULL,
    "scope" "DefectDojoPushScope" NOT NULL,
    "status" "DefectDojoSyncStatus" NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "startedById" UUID,
    "findings" INTEGER NOT NULL DEFAULT 0,
    "testId" INTEGER,
    "stats" JSONB,
    "error" TEXT,

    CONSTRAINT "DefectDojoPush_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DefectDojoPush_scanId_idx" ON "DefectDojoPush"("scanId");

-- CreateIndex
CREATE INDEX "DefectDojoPush_startedById_idx" ON "DefectDojoPush"("startedById");

-- CreateIndex
CREATE INDEX "DefectDojoPush_startedAt_idx" ON "DefectDojoPush"("startedAt");

-- AddForeignKey
ALTER TABLE "DefectDojoPush" ADD CONSTRAINT "DefectDojoPush_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectDojoPush" ADD CONSTRAINT "DefectDojoPush_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
