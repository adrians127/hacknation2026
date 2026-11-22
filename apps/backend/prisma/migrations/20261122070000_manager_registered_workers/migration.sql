-- Workers are registered by managers only: no built-in catalog, no enable switch, no admin
-- defaults and no stage. Existing rows stay and are refreshed by the next manager that offers them.
ALTER TABLE "Worker" DROP COLUMN "isBuiltin",
DROP COLUMN "enabled",
DROP COLUMN "stage",
DROP COLUMN "defaults";
