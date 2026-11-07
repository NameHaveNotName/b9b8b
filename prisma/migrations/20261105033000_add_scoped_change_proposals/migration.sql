CREATE TABLE "scoped_change_proposals" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "workflow_step_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "step_type" "WorkflowStepType" NOT NULL,
    "scope_type" TEXT NOT NULL,
    "scope_key" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "base_hash" TEXT NOT NULL,
    "before_snapshot" JSONB NOT NULL,
    "operations" JSONB NOT NULL,
    "summary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "applied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scoped_change_proposals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "scoped_change_proposals_project_id_status_created_at_idx"
ON "scoped_change_proposals"("project_id", "status", "created_at");

CREATE INDEX "scoped_change_proposals_workflow_step_id_scope_type_scope_key_idx"
ON "scoped_change_proposals"("workflow_step_id", "scope_type", "scope_key", "created_at");

CREATE INDEX "scoped_change_proposals_created_by_id_created_at_idx"
ON "scoped_change_proposals"("created_by_id", "created_at");

ALTER TABLE "scoped_change_proposals"
ADD CONSTRAINT "scoped_change_proposals_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "scoped_change_proposals"
ADD CONSTRAINT "scoped_change_proposals_workflow_step_id_fkey"
FOREIGN KEY ("workflow_step_id") REFERENCES "WorkflowStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "scoped_change_proposals"
ADD CONSTRAINT "scoped_change_proposals_created_by_id_fkey"
FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
