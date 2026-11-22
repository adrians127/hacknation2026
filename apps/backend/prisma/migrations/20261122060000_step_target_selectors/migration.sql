-- Each step that scans targets gets its own selection; the pipeline-wide one is copied onto them.
ALTER TABLE "PipelineStep" ADD COLUMN "targetSelector" JSONB;

UPDATE "PipelineStep" AS step
SET "targetSelector" = pipeline."targetSelector"
FROM "Pipeline" AS pipeline
WHERE step."pipelineId" = pipeline.id AND step.input = 'targets';

ALTER TABLE "Pipeline" DROP COLUMN "targetSelector";
