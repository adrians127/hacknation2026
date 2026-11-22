-- A scan read from a results file was queued by nothing. Its own migration: a new enum value
-- cannot be used in the transaction that adds it.
ALTER TYPE "ScanTrigger" ADD VALUE 'results_import';
