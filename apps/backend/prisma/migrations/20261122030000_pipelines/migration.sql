-- CreateEnum
CREATE TYPE "PipelineStepInput" AS ENUM ('targets', 'previous');

-- CreateEnum
CREATE TYPE "ScanTrigger" AS ENUM ('import', 'manual', 'schedule');

-- AlterEnum
ALTER TYPE "ScanStatus" ADD VALUE 'paused';

-- AlterTable
ALTER TABLE "ScanJob" ADD COLUMN     "params" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "stepIndex" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "worker" TEXT NOT NULL DEFAULT 'masscan';

-- AlterTable
ALTER TABLE "Scan" ADD COLUMN     "pipelineId" UUID,
ADD COLUMN     "steps" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "trigger" "ScanTrigger" NOT NULL DEFAULT 'import',
ADD COLUMN     "windowEndsAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PipelineStep" (
    "id" UUID NOT NULL,
    "pipelineId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "workerId" UUID NOT NULL,
    "input" "PipelineStepInput" NOT NULL,
    "ports" TEXT NOT NULL,
    "rate" INTEGER NOT NULL,
    "batchSize" INTEGER NOT NULL,
    "maxDurationSeconds" INTEGER NOT NULL,
    "split" JSONB NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "PipelineStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pipeline" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "targetSelector" JSONB NOT NULL,
    "schedule" JSONB,
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pipeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerManager" (
    "id" UUID NOT NULL,
    "managerId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "workers" TEXT[],
    "maxParallel" INTEGER NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkerManager_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Worker" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "isBuiltin" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "stage" INTEGER NOT NULL DEFAULT 100,
    "inputs" TEXT[] DEFAULT ARRAY['targets']::TEXT[],
    "splitStrategies" TEXT[] DEFAULT ARRAY['none']::TEXT[],
    "paramFields" JSONB NOT NULL DEFAULT '[]',
    "defaults" JSONB NOT NULL DEFAULT '{}',
    "maxRate" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Worker_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PipelineStep_workerId_idx" ON "PipelineStep"("workerId");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineStep_pipelineId_position_key" ON "PipelineStep"("pipelineId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Pipeline_name_key" ON "Pipeline"("name");

-- CreateIndex
CREATE INDEX "Pipeline_enabled_nextRunAt_idx" ON "Pipeline"("enabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "Pipeline_createdById_idx" ON "Pipeline"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "WorkerManager_managerId_key" ON "WorkerManager"("managerId");

-- CreateIndex
CREATE UNIQUE INDEX "Worker_name_key" ON "Worker"("name");

-- CreateIndex
CREATE INDEX "ScanJob_scanId_stepIndex_idx" ON "ScanJob"("scanId", "stepIndex");

-- CreateIndex
CREATE INDEX "Scan_pipelineId_idx" ON "Scan"("pipelineId");

-- AddForeignKey
ALTER TABLE "PipelineStep" ADD CONSTRAINT "PipelineStep_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineStep" ADD CONSTRAINT "PipelineStep_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pipeline" ADD CONSTRAINT "Pipeline_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scan" ADD CONSTRAINT "Scan_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE SET NULL ON UPDATE CASCADE;
