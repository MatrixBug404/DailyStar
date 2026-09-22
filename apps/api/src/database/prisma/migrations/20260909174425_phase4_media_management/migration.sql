-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('IMAGE');

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('UPLOADING', 'READY', 'FAILED', 'DELETED');

-- AlterTable
ALTER TABLE "articles" ADD COLUMN     "coverMediaId" TEXT;

-- CreateTable
CREATE TABLE "media" (
    "id" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "originalFilename" VARCHAR(255) NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "mediaType" "MediaType" NOT NULL DEFAULT 'IMAGE',
    "fileSizeBytes" BIGINT NOT NULL,
    "sha256Checksum" CHAR(64) NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "status" "MediaStatus" NOT NULL DEFAULT 'UPLOADING',
    "storageProvider" VARCHAR(50) NOT NULL DEFAULT 'minio',
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "media_objectKey_key" ON "media"("objectKey");

-- CreateIndex
CREATE INDEX "media_uploadedById_idx" ON "media"("uploadedById");

-- CreateIndex
CREATE INDEX "media_status_idx" ON "media"("status");

-- CreateIndex
CREATE INDEX "media_sha256Checksum_idx" ON "media"("sha256Checksum");

-- CreateIndex
CREATE INDEX "articles_coverMediaId_idx" ON "articles"("coverMediaId");

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_coverMediaId_fkey" FOREIGN KEY ("coverMediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
