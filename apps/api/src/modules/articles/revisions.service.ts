import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '../../database/client';

@Injectable()
export class RevisionsService {
  async appendRevision(
    articleId: string,
    authorId: string,
    title: string,
    body: string,
    excerpt: string | null,
    prismaClient: any, // Accept transactional prisma client
  ) {
    // Get latest revision number
    const lastRev = await prismaClient.articleRevision.findFirst({
      where: { articleId },
      orderBy: { revisionNumber: 'desc' },
    });

    const revisionNumber = lastRev ? lastRev.revisionNumber + 1 : 1;

    return prismaClient.articleRevision.create({
      data: {
        articleId,
        authorId,
        revisionNumber,
        title,
        body,
        excerpt,
      },
    });
  }
}
