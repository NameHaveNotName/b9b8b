CREATE TABLE "production_delivery_states" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "current_stage" TEXT NOT NULL,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_delivery_states_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "production_delivery_milestones" (
    "id" TEXT NOT NULL,
    "state_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "note" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_delivery_milestones_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "production_delivery_states_project_id_key"
ON "production_delivery_states"("project_id");

CREATE UNIQUE INDEX "production_delivery_milestones_state_id_stage_key"
ON "production_delivery_milestones"("state_id", "stage");

CREATE INDEX "production_delivery_milestones_project_id_created_at_idx"
ON "production_delivery_milestones"("project_id", "created_at");

ALTER TABLE "production_delivery_states"
ADD CONSTRAINT "production_delivery_states_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "production_delivery_milestones"
ADD CONSTRAINT "production_delivery_milestones_state_id_fkey"
FOREIGN KEY ("state_id") REFERENCES "production_delivery_states"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "production_delivery_milestones"
ADD CONSTRAINT "production_delivery_milestones_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
