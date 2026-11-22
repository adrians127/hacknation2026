BEGIN;

DROP INDEX "HostObservation_scanId_ip_key";
DROP INDEX "HostObservation_resultId_idx";

CREATE UNIQUE INDEX "HostObservation_resultId_ip_key" ON "HostObservation"("resultId", "ip");
CREATE INDEX "HostObservation_scanId_ip_idx" ON "HostObservation"("scanId", "ip");

COMMIT;
