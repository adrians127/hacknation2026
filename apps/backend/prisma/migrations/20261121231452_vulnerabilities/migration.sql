-- CreateEnum
CREATE TYPE "VulnerabilityTriageStatus" AS ENUM ('unreviewed', 'important', 'accepted_risk', 'false_positive');

-- CreateEnum
CREATE TYPE "VulnerabilityJobRequestKind" AS ENUM ('sync', 'full_sync', 'rematch');

-- CreateEnum
CREATE TYPE "MatchConfidence" AS ENUM ('confirmed', 'potential');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('active', 'retracted');

-- CreateEnum
CREATE TYPE "VulnerabilityRetractReason" AS ENUM ('source_withdrawn', 'criteria_changed', 'service_changed', 'source_disabled');

-- CreateEnum
CREATE TYPE "VulnerabilitySyncMode" AS ENUM ('incremental', 'full');

-- CreateEnum
CREATE TYPE "VulnerabilitySyncTrigger" AS ENUM ('schedule', 'manual', 'cli');

-- CreateEnum
CREATE TYPE "VulnerabilitySyncRunStatus" AS ENUM ('running', 'succeeded', 'failed', 'cancelled', 'interrupted');

-- CreateEnum
CREATE TYPE "VulnerabilityStatus" AS ENUM ('active', 'rejected', 'withdrawn');

-- CreateEnum
CREATE TYPE "VulnerabilitySeverity" AS ENUM ('critical', 'high', 'medium', 'low', 'none', 'unknown');

-- CreateTable
CREATE TABLE "PackageMapping" (
    "id" UUID NOT NULL,
    "cpeVendor" TEXT NOT NULL,
    "cpeProduct" TEXT NOT NULL,
    "ecosystem" TEXT NOT NULL,
    "packageName" TEXT NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackageMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceVulnerabilityTriage" (
    "id" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "canonicalId" TEXT NOT NULL,
    "triage" "VulnerabilityTriageStatus" NOT NULL DEFAULT 'unreviewed',
    "note" JSONB,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceVulnerabilityTriage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VulnerabilityCriterion" (
    "id" BIGSERIAL NOT NULL,
    "vulnerabilityId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "matchKey" TEXT NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "VulnerabilityCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VulnerabilityJobRequest" (
    "id" UUID NOT NULL,
    "kind" "VulnerabilityJobRequestKind" NOT NULL,
    "sourceId" TEXT,
    "requestedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "takenAt" TIMESTAMP(3),

    CONSTRAINT "VulnerabilityJobRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VulnerabilityMatch" (
    "id" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "canonicalId" TEXT NOT NULL,
    "confidence" "MatchConfidence" NOT NULL,
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "evidence" JSONB NOT NULL,
    "vulnerabilityId" UUID NOT NULL,
    "title" TEXT,
    "severity" "VulnerabilitySeverity" NOT NULL,
    "cvssScore" DOUBLE PRECISION,
    "kev" BOOLEAN NOT NULL DEFAULT false,
    "basis" JSONB NOT NULL,
    "basisHash" TEXT NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'active',
    "retractReason" "VulnerabilityRetractReason",
    "firstMatchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEvaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retractedAt" TIMESTAMP(3),

    CONSTRAINT "VulnerabilityMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VulnerabilitySource" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "cursor" JSONB,
    "lastIncrementalAt" TIMESTAMP(3),
    "lastFullAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,
    "recordCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VulnerabilitySource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VulnerabilitySyncRun" (
    "id" UUID NOT NULL,
    "sourceId" TEXT NOT NULL,
    "mode" "VulnerabilitySyncMode" NOT NULL,
    "trigger" "VulnerabilitySyncTrigger" NOT NULL,
    "status" "VulnerabilitySyncRunStatus" NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "stats" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,

    CONSTRAINT "VulnerabilitySyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VulnerabilitySyncState" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "lockedBy" TEXT,
    "lockExpiresAt" TIMESTAMP(3),
    "resultCursor" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VulnerabilitySyncState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vulnerability" (
    "id" UUID NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "canonicalId" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "title" TEXT,
    "description" TEXT,
    "status" "VulnerabilityStatus" NOT NULL DEFAULT 'active',
    "withdrawnAt" TIMESTAMP(3),
    "withdrawReason" TEXT,
    "severity" "VulnerabilitySeverity" NOT NULL DEFAULT 'unknown',
    "cvssScore" DOUBLE PRECISION,
    "cvssVector" TEXT,
    "cvssVersion" TEXT,
    "kevAddedAt" TIMESTAMP(3),
    "kevDueDate" TIMESTAMP(3),
    "references" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "publishedAt" TIMESTAMP(3),
    "sourceModifiedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vulnerability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PackageMapping_createdById_idx" ON "PackageMapping"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "PackageMapping_cpeVendor_cpeProduct_ecosystem_packageName_key" ON "PackageMapping"("cpeVendor", "cpeProduct", "ecosystem", "packageName");

-- CreateIndex
CREATE INDEX "ServiceVulnerabilityTriage_updatedById_idx" ON "ServiceVulnerabilityTriage"("updatedById");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceVulnerabilityTriage_serviceId_canonicalId_key" ON "ServiceVulnerabilityTriage"("serviceId", "canonicalId");

-- CreateIndex
CREATE INDEX "VulnerabilityCriterion_matchKey_idx" ON "VulnerabilityCriterion"("matchKey");

-- CreateIndex
CREATE INDEX "VulnerabilityCriterion_vulnerabilityId_idx" ON "VulnerabilityCriterion"("vulnerabilityId");

-- CreateIndex
CREATE INDEX "VulnerabilityJobRequest_sourceId_idx" ON "VulnerabilityJobRequest"("sourceId");

-- CreateIndex
CREATE INDEX "VulnerabilityJobRequest_requestedById_idx" ON "VulnerabilityJobRequest"("requestedById");

-- CreateIndex
CREATE INDEX "VulnerabilityJobRequest_takenAt_idx" ON "VulnerabilityJobRequest"("takenAt");

-- CreateIndex
CREATE INDEX "VulnerabilityMatch_status_confidence_severity_idx" ON "VulnerabilityMatch"("status", "confidence", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "VulnerabilityMatch_serviceId_canonicalId_key" ON "VulnerabilityMatch"("serviceId", "canonicalId");

-- CreateIndex
CREATE INDEX "VulnerabilitySyncRun_sourceId_startedAt_idx" ON "VulnerabilitySyncRun"("sourceId", "startedAt");

-- CreateIndex
CREATE INDEX "Vulnerability_canonicalId_idx" ON "Vulnerability"("canonicalId");

-- CreateIndex
CREATE INDEX "Vulnerability_sourceId_status_lastSeenAt_idx" ON "Vulnerability"("sourceId", "status", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "Vulnerability_sourceId_externalId_key" ON "Vulnerability"("sourceId", "externalId");

-- AddForeignKey
ALTER TABLE "PackageMapping" ADD CONSTRAINT "PackageMapping_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceVulnerabilityTriage" ADD CONSTRAINT "ServiceVulnerabilityTriage_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceVulnerabilityTriage" ADD CONSTRAINT "ServiceVulnerabilityTriage_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VulnerabilityCriterion" ADD CONSTRAINT "VulnerabilityCriterion_vulnerabilityId_fkey" FOREIGN KEY ("vulnerabilityId") REFERENCES "Vulnerability"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VulnerabilityJobRequest" ADD CONSTRAINT "VulnerabilityJobRequest_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "VulnerabilitySource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VulnerabilityJobRequest" ADD CONSTRAINT "VulnerabilityJobRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VulnerabilityMatch" ADD CONSTRAINT "VulnerabilityMatch_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VulnerabilitySyncRun" ADD CONSTRAINT "VulnerabilitySyncRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "VulnerabilitySource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vulnerability" ADD CONSTRAINT "Vulnerability_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "VulnerabilitySource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Starter CPE -> package mappings (hand-written). In the migration rather than a seed, so a mapping
-- an admin deletes stays deleted. Only unversioned source packages: a package that holds one major
-- version only (postgresql-15) would answer "not affected" for any other major.
INSERT INTO "PackageMapping" ("id", "cpeVendor", "cpeProduct", "ecosystem", "packageName")
SELECT uuidv7(), v.vendor, v.product, v.ecosystem, v.package
FROM (VALUES
  ('openbsd', 'openssh', 'Debian', 'openssh'),
  ('openbsd', 'openssh', 'Alpine', 'openssh'),
  ('apache', 'http_server', 'Debian', 'apache2'),
  ('apache', 'http_server', 'Alpine', 'apache2'),
  ('nginx', 'nginx', 'Debian', 'nginx'),
  ('nginx', 'nginx', 'Alpine', 'nginx'),
  ('isc', 'bind', 'Debian', 'bind9'),
  ('isc', 'bind', 'Alpine', 'bind'),
  ('postfix', 'postfix', 'Debian', 'postfix'),
  ('postfix', 'postfix', 'Alpine', 'postfix'),
  ('dovecot', 'dovecot', 'Debian', 'dovecot'),
  ('dovecot', 'dovecot', 'Alpine', 'dovecot'),
  ('exim', 'exim', 'Debian', 'exim4'),
  ('exim', 'exim', 'Alpine', 'exim'),
  ('mariadb', 'mariadb', 'Debian', 'mariadb'),
  ('mariadb', 'mariadb', 'Alpine', 'mariadb'),
  ('squid-cache', 'squid', 'Debian', 'squid'),
  ('squid-cache', 'squid', 'Alpine', 'squid'),
  ('beasts', 'vsftpd', 'Debian', 'vsftpd'),
  ('beasts', 'vsftpd', 'Alpine', 'vsftpd'),
  ('proftpd', 'proftpd', 'Debian', 'proftpd-dfsg'),
  ('samba', 'samba', 'Debian', 'samba'),
  ('samba', 'samba', 'Alpine', 'samba'),
  ('redis', 'redis', 'Debian', 'redis'),
  ('redis', 'redis', 'Alpine', 'redis'),
  ('memcached', 'memcached', 'Debian', 'memcached'),
  ('memcached', 'memcached', 'Alpine', 'memcached'),
  ('haproxy', 'haproxy', 'Debian', 'haproxy'),
  ('haproxy', 'haproxy', 'Alpine', 'haproxy'),
  ('lighttpd', 'lighttpd', 'Debian', 'lighttpd'),
  ('lighttpd', 'lighttpd', 'Alpine', 'lighttpd'),
  ('eclipse', 'jetty', 'Maven', 'org.eclipse.jetty:jetty-server'),
  ('eclipse', 'jetty', 'Maven', 'org.eclipse.jetty:jetty-http'),
  ('apache', 'tomcat', 'Maven', 'org.apache.tomcat:tomcat-catalina'),
  ('apache', 'tomcat', 'Maven', 'org.apache.tomcat.embed:tomcat-embed-core'),
  ('apache', 'activemq', 'Maven', 'org.apache.activemq:activemq-broker'),
  ('apache', 'activemq', 'Maven', 'org.apache.activemq:activemq-client'),
  ('apache', 'solr', 'Maven', 'org.apache.solr:solr-core'),
  ('jenkins', 'jenkins', 'Maven', 'org.jenkins-ci.main:jenkins-core'),
  ('elastic', 'elasticsearch', 'Maven', 'org.elasticsearch:elasticsearch'),
  ('redhat', 'keycloak', 'Maven', 'org.keycloak:keycloak-core'),
  ('grafana', 'grafana', 'Go', 'github.com/grafana/grafana'),
  ('gitea', 'gitea', 'Go', 'code.gitea.io/gitea'),
  ('minio', 'minio', 'Go', 'github.com/minio/minio'),
  ('traefik', 'traefik', 'Go', 'github.com/traefik/traefik/v2'),
  ('traefik', 'traefik', 'Go', 'github.com/traefik/traefik/v3'),
  ('hashicorp', 'consul', 'Go', 'github.com/hashicorp/consul'),
  ('hashicorp', 'vault', 'Go', 'github.com/hashicorp/vault'),
  ('prometheus', 'prometheus', 'Go', 'github.com/prometheus/prometheus'),
  ('phpmyadmin', 'phpmyadmin', 'Packagist', 'phpmyadmin/phpmyadmin'),
  ('drupal', 'drupal', 'Packagist', 'drupal/core'),
  ('nextcloud', 'nextcloud_server', 'Packagist', 'nextcloud/server'),
  ('djangoproject', 'django', 'PyPI', 'django'),
  ('palletsprojects', 'werkzeug', 'PyPI', 'werkzeug'),
  ('pocoo', 'werkzeug', 'PyPI', 'werkzeug'),
  ('gunicorn', 'gunicorn', 'PyPI', 'gunicorn'),
  ('tornadoweb', 'tornado', 'PyPI', 'tornado'),
  ('expressjs', 'express', 'npm', 'express')
) AS v(vendor, product, ecosystem, package)
ON CONFLICT DO NOTHING;
