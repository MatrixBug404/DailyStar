-- CreateEnum
CREATE TYPE "PublicationScheduleStatus" AS ENUM ('PENDING', 'EXECUTED', 'CANCELLED', 'FAILED');



-- CreateTable
CREATE TABLE "publication_schedules" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" "PublicationScheduleStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "scheduledById" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "expectedArticleVersion" INTEGER NOT NULL,
    "approvedRevisionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "publication_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "publication_schedules_status_scheduledFor_idx" ON "publication_schedules"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "publication_schedules_articleId_idx" ON "publication_schedules"("articleId");

-- AddForeignKey
ALTER TABLE "publication_schedules" ADD CONSTRAINT "publication_schedules_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_schedules" ADD CONSTRAINT "publication_schedules_scheduledById_fkey" FOREIGN KEY ("scheduledById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_schedules" ADD CONSTRAINT "publication_schedules_approvedRevisionId_fkey" FOREIGN KEY ("approvedRevisionId") REFERENCES "article_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
