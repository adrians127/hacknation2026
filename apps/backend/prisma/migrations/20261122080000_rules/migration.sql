-- CreateEnum
CREATE TYPE "RuleTargetKind" AS ENUM ('host', 'service');

-- CreateEnum
CREATE TYPE "RuleKind" AS ENUM ('vulnerability', 'service', 'unchanged', 'change_priority');

-- AlterTable
ALTER TABLE "Host" ADD COLUMN     "triageRuleId" UUID;

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "triageRuleId" UUID;

-- AlterTable
ALTER TABLE "ServiceVulnerabilityTriage" ADD COLUMN     "triageRuleId" UUID;

-- CreateTable
CREATE TABLE "RuleState" (
    "id" INTEGER NOT NULL,
    "resultsAt" TIMESTAMP(3),
    "matchesAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "RuleState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleTag" (
    "id" UUID NOT NULL,
    "ruleId" UUID NOT NULL,
    "targetKind" "RuleTargetKind" NOT NULL,
    "targetId" UUID NOT NULL,
    "tag" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rule" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "RuleKind" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "note" JSONB,
    "expiresAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RuleTag_targetId_idx" ON "RuleTag"("targetId");

-- CreateIndex
CREATE UNIQUE INDEX "RuleTag_ruleId_targetKind_targetId_key" ON "RuleTag"("ruleId", "targetKind", "targetId");

-- CreateIndex
CREATE INDEX "Rule_createdById_idx" ON "Rule"("createdById");

-- CreateIndex
CREATE INDEX "Host_triageRuleId_idx" ON "Host"("triageRuleId");

-- CreateIndex
CREATE INDEX "Service_triageRuleId_idx" ON "Service"("triageRuleId");

-- CreateIndex
CREATE INDEX "ServiceVulnerabilityTriage_triageRuleId_idx" ON "ServiceVulnerabilityTriage"("triageRuleId");

-- AddForeignKey
ALTER TABLE "Host" ADD CONSTRAINT "Host_triageRuleId_fkey" FOREIGN KEY ("triageRuleId") REFERENCES "Rule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_triageRuleId_fkey" FOREIGN KEY ("triageRuleId") REFERENCES "Rule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleTag" ADD CONSTRAINT "RuleTag_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rule" ADD CONSTRAINT "Rule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceVulnerabilityTriage" ADD CONSTRAINT "ServiceVulnerabilityTriage_triageRuleId_fkey" FOREIGN KEY ("triageRuleId") REFERENCES "Rule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

