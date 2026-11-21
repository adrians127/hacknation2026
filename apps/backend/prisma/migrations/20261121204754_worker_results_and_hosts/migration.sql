-- CreateEnum
CREATE TYPE "TransportProtocol" AS ENUM ('tcp');

-- CreateEnum
CREATE TYPE "HostObservationStatus" AS ENUM ('up', 'down', 'timeout', 'cancelled', 'failed');

-- CreateEnum
CREATE TYPE "HostnameSource" AS ENUM ('job', 'ptr', 'tls_san');

-- CreateEnum
CREATE TYPE "ScanJobResultStatus" AS ENUM ('completed', 'partial', 'failed');

-- CreateEnum
CREATE TYPE "ScanStopReason" AS ENUM ('deadline', 'stop_requested', 'lease_lost', 'error');

-- CreateTable
CREATE TABLE "Host" (
    "id" UUID NOT NULL,
    "ip" TEXT NOT NULL,
    "ipNumber" BIGINT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Host_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Service" (
    "id" UUID NOT NULL,
    "hostId" UUID NOT NULL,
    "protocol" "TransportProtocol" NOT NULL,
    "port" INTEGER NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostObservation" (
    "id" UUID NOT NULL,
    "scanId" UUID NOT NULL,
    "resultId" UUID NOT NULL,
    "hostId" UUID,
    "ip" TEXT NOT NULL,
    "ipNumber" BIGINT NOT NULL,
    "status" "HostObservationStatus" NOT NULL,
    "reason" TEXT,
    "observedAt" TIMESTAMP(3),
    "latencyMs" INTEGER,
    "error" JSONB,

    CONSTRAINT "HostObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostnameObservation" (
    "hostObservationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "source" "HostnameSource" NOT NULL,

    CONSTRAINT "HostnameObservation_pkey" PRIMARY KEY ("hostObservationId","name","source")
);

-- CreateTable
CREATE TABLE "PortObservation" (
    "id" UUID NOT NULL,
    "hostObservationId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "protocol" "TransportProtocol" NOT NULL,
    "port" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "reason" TEXT,
    "serviceName" TEXT,
    "serviceProduct" TEXT,
    "serviceVersion" TEXT,
    "serviceExtraInfo" TEXT,
    "serviceCpe" TEXT[],
    "serviceMethod" TEXT,
    "serviceConfidence" INTEGER,
    "fingerprint" TEXT NOT NULL,
    "details" JSONB NOT NULL,

    CONSTRAINT "PortObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanJobResult" (
    "id" UUID NOT NULL,
    "scanId" UUID NOT NULL,
    "scanJobId" UUID NOT NULL,
    "leaseId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "workerVersion" TEXT NOT NULL,
    "nmapVersion" TEXT,
    "status" "ScanJobResultStatus" NOT NULL,
    "stopReason" "ScanStopReason",
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "phasesMs" JSONB NOT NULL,
    "params" JSONB NOT NULL,
    "counts" JSONB NOT NULL,
    "error" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScanJobResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Host_ip_key" ON "Host"("ip");

-- CreateIndex
CREATE INDEX "Host_ipNumber_idx" ON "Host"("ipNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Service_hostId_protocol_port_key" ON "Service"("hostId", "protocol", "port");

-- CreateIndex
CREATE INDEX "HostObservation_resultId_idx" ON "HostObservation"("resultId");

-- CreateIndex
CREATE INDEX "HostObservation_hostId_idx" ON "HostObservation"("hostId");

-- CreateIndex
CREATE INDEX "HostObservation_ipNumber_idx" ON "HostObservation"("ipNumber");

-- CreateIndex
CREATE UNIQUE INDEX "HostObservation_scanId_ip_key" ON "HostObservation"("scanId", "ip");

-- CreateIndex
CREATE INDEX "HostnameObservation_name_idx" ON "HostnameObservation"("name");

-- CreateIndex
CREATE INDEX "PortObservation_serviceId_idx" ON "PortObservation"("serviceId");

-- CreateIndex
CREATE INDEX "PortObservation_details_idx" ON "PortObservation" USING GIN ("details" jsonb_path_ops);

-- CreateIndex
CREATE UNIQUE INDEX "PortObservation_hostObservationId_protocol_port_key" ON "PortObservation"("hostObservationId", "protocol", "port");

-- CreateIndex
CREATE UNIQUE INDEX "ScanJobResult_leaseId_key" ON "ScanJobResult"("leaseId");

-- CreateIndex
CREATE INDEX "ScanJobResult_scanId_idx" ON "ScanJobResult"("scanId");

-- CreateIndex
CREATE INDEX "ScanJobResult_scanJobId_idx" ON "ScanJobResult"("scanJobId");

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostObservation" ADD CONSTRAINT "HostObservation_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostObservation" ADD CONSTRAINT "HostObservation_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "ScanJobResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostObservation" ADD CONSTRAINT "HostObservation_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostnameObservation" ADD CONSTRAINT "HostnameObservation_hostObservationId_fkey" FOREIGN KEY ("hostObservationId") REFERENCES "HostObservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortObservation" ADD CONSTRAINT "PortObservation_hostObservationId_fkey" FOREIGN KEY ("hostObservationId") REFERENCES "HostObservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortObservation" ADD CONSTRAINT "PortObservation_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanJobResult" ADD CONSTRAINT "ScanJobResult_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanJobResult" ADD CONSTRAINT "ScanJobResult_scanJobId_fkey" FOREIGN KEY ("scanJobId") REFERENCES "ScanJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
