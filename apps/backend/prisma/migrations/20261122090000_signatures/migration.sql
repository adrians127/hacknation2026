-- CreateTable
CREATE TABLE "SignatureMatch" (
    "id" UUID NOT NULL,
    "scanId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "signatureId" UUID NOT NULL,
    "confidence" TEXT NOT NULL,
    "version" TEXT,
    "sources" TEXT[],
    "evidence" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignatureMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignatureScanState" (
    "scanId" UUID NOT NULL,
    "setHash" TEXT NOT NULL,
    "resultCount" INTEGER NOT NULL,
    "services" INTEGER NOT NULL,
    "matches" INTEGER NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignatureScanState_pkey" PRIMARY KEY ("scanId")
);

-- CreateTable
CREATE TABLE "Signature" (
    "id" UUID NOT NULL,
    "key" TEXT,
    "name" TEXT NOT NULL,
    "description" JSONB,
    "category" TEXT NOT NULL,
    "product" TEXT,
    "severity" TEXT,
    "confidence" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "definition" JSONB NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Signature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SignatureMatch_scanId_signatureId_idx" ON "SignatureMatch"("scanId", "signatureId");

-- CreateIndex
CREATE INDEX "SignatureMatch_serviceId_idx" ON "SignatureMatch"("serviceId");

-- CreateIndex
CREATE INDEX "SignatureMatch_signatureId_idx" ON "SignatureMatch"("signatureId");

-- CreateIndex
CREATE UNIQUE INDEX "SignatureMatch_scanId_serviceId_signatureId_key" ON "SignatureMatch"("scanId", "serviceId", "signatureId");

-- CreateIndex
CREATE UNIQUE INDEX "Signature_key_key" ON "Signature"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Signature_name_key" ON "Signature"("name");

-- CreateIndex
CREATE INDEX "Signature_createdById_idx" ON "Signature"("createdById");

-- AddForeignKey
ALTER TABLE "SignatureMatch" ADD CONSTRAINT "SignatureMatch_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureMatch" ADD CONSTRAINT "SignatureMatch_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureMatch" ADD CONSTRAINT "SignatureMatch_signatureId_fkey" FOREIGN KEY ("signatureId") REFERENCES "Signature"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureScanState" ADD CONSTRAINT "SignatureScanState_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signature" ADD CONSTRAINT "Signature_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

