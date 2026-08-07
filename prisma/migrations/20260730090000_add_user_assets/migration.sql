-- CreateEnum
CREATE TYPE "UserAssetKind" AS ENUM ('CHARACTER', 'ENVIRONMENT', 'REFERENCE');

-- CreateEnum
CREATE TYPE "UserAssetSource" AS ENUM ('UPLOAD', 'GENERATED');

-- CreateTable
CREATE TABLE "user_assets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "UserAssetKind" NOT NULL,
    "source" "UserAssetSource" NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "prompt" TEXT,
    "template_id" TEXT,
    "mime_type" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_assets_user_id_kind_created_at_idx" ON "user_assets"("user_id", "kind", "created_at");

-- AddForeignKey
ALTER TABLE "user_assets" ADD CONSTRAINT "user_assets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
