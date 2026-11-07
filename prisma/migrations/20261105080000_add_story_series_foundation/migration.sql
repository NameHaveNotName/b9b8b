CREATE TABLE "story_series" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "logline" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "current_bible_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "story_series_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "story_seasons" (
    "id" TEXT NOT NULL,
    "series_id" TEXT NOT NULL,
    "season_number" INTEGER NOT NULL,
    "title" TEXT,
    "synopsis" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "story_seasons_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "series_bible_revisions" (
    "id" TEXT NOT NULL,
    "series_id" TEXT NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "series_bible_revisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "story_episodes" (
    "id" TEXT NOT NULL,
    "series_id" TEXT NOT NULL,
    "season_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "bible_revision_id" TEXT NOT NULL,
    "episode_number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "synopsis" TEXT,
    "status" TEXT NOT NULL DEFAULT 'IN_PRODUCTION',
    "continuity_before" JSONB,
    "continuity_after" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "story_episodes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "story_series_user_id_status_updated_at_idx" ON "story_series"("user_id", "status", "updated_at");
CREATE UNIQUE INDEX "story_seasons_series_id_season_number_key" ON "story_seasons"("series_id", "season_number");
CREATE UNIQUE INDEX "series_bible_revisions_series_id_revision_number_key" ON "series_bible_revisions"("series_id", "revision_number");
CREATE INDEX "series_bible_revisions_created_by_id_created_at_idx" ON "series_bible_revisions"("created_by_id", "created_at");
CREATE UNIQUE INDEX "story_episodes_project_id_key" ON "story_episodes"("project_id");
CREATE UNIQUE INDEX "story_episodes_season_id_episode_number_key" ON "story_episodes"("season_id", "episode_number");
CREATE INDEX "story_episodes_series_id_status_episode_number_idx" ON "story_episodes"("series_id", "status", "episode_number");
CREATE INDEX "story_episodes_bible_revision_id_idx" ON "story_episodes"("bible_revision_id");

ALTER TABLE "story_series" ADD CONSTRAINT "story_series_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_seasons" ADD CONSTRAINT "story_seasons_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "story_series"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "series_bible_revisions" ADD CONSTRAINT "series_bible_revisions_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "story_series"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "series_bible_revisions" ADD CONSTRAINT "series_bible_revisions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_episodes" ADD CONSTRAINT "story_episodes_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "story_series"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_episodes" ADD CONSTRAINT "story_episodes_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "story_seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_episodes" ADD CONSTRAINT "story_episodes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_episodes" ADD CONSTRAINT "story_episodes_bible_revision_id_fkey" FOREIGN KEY ("bible_revision_id") REFERENCES "series_bible_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
