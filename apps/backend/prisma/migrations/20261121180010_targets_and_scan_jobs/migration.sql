-- CreateEnum
CREATE TYPE "ScanJobKind" AS ENUM ('discovery', 'service');

-- CreateEnum
CREATE TYPE "ScanJobStatus" AS ENUM ('queued', 'leased', 'completed', 'failed', 'stopped');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('queued', 'running', 'completed', 'stopped', 'failed');

-- CreateEnum
CREATE TYPE "TargetKind" AS ENUM ('ip', 'cidr', 'domain');

-- CreateTable
CREATE TABLE "ScanJob" (
    "id" UUID NOT NULL,
    "scanId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" "ScanJobKind" NOT NULL DEFAULT 'discovery',
    "status" "ScanJobStatus" NOT NULL DEFAULT 'queued',
    "subnet" TEXT NOT NULL,
    "targets" TEXT[],
    "hosts" JSONB NOT NULL DEFAULT '[]',
    "addressCount" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseId" TEXT,
    "leasedBy" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "error" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScanJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanTarget" (
    "scanId" UUID NOT NULL,
    "targetId" UUID NOT NULL,

    CONSTRAINT "ScanTarget_pkey" PRIMARY KEY ("scanId","targetId")
);

-- CreateTable
CREATE TABLE "Scan" (
    "id" UUID NOT NULL,
    "status" "ScanStatus" NOT NULL DEFAULT 'queued',
    "ports" TEXT NOT NULL,
    "maxRate" INTEGER NOT NULL,
    "batchSize" INTEGER NOT NULL,
    "targetCount" INTEGER NOT NULL,
    "addressCount" INTEGER NOT NULL,
    "jobCount" INTEGER NOT NULL,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "requestedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Target" (
    "id" UUID NOT NULL,
    "kind" "TargetKind" NOT NULL,
    "value" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Target_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScanJob_leaseId_key" ON "ScanJob"("leaseId");

-- CreateIndex
CREATE INDEX "ScanJob_scanId_idx" ON "ScanJob"("scanId");

-- CreateIndex
CREATE INDEX "ScanJob_status_leaseExpiresAt_idx" ON "ScanJob"("status", "leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScanJob_scanId_sequence_key" ON "ScanJob"("scanId", "sequence");

-- CreateIndex
CREATE INDEX "ScanTarget_targetId_idx" ON "ScanTarget"("targetId");

-- CreateIndex
CREATE INDEX "Scan_requestedById_idx" ON "Scan"("requestedById");

-- CreateIndex
CREATE INDEX "Scan_status_createdAt_idx" ON "Scan"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Target_value_key" ON "Target"("value");

-- CreateIndex
CREATE INDEX "Target_createdById_idx" ON "Target"("createdById");

-- AddForeignKey
ALTER TABLE "ScanJob" ADD CONSTRAINT "ScanJob_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanTarget" ADD CONSTRAINT "ScanTarget_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanTarget" ADD CONSTRAINT "ScanTarget_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "Target"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scan" ADD CONSTRAINT "Scan_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Target" ADD CONSTRAINT "Target_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
