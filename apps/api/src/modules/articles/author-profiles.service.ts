import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '../../database/client';

@Injectable()
export class AuthorProfilesService {
  async findOrCreateProfile(userId: string, displayName: string) {
    let profile = await prisma.authorProfile.findUnique({ where: { userId } });
    if (!profile) {
      try {
        profile = await prisma.authorProfile.create({
          data: {
            userId,
            displayName,
          },
        });
      } catch (e) {
        profile = await prisma.authorProfile.findUnique({ where: { userId } });
      }
    }
    return profile;
  }
}
