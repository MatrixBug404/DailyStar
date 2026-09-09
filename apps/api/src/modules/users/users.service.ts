import { Injectable } from '@nestjs/common';
import { PrismaClient, User } from '../../database/generated/prisma';

const prisma = new PrismaClient();

@Injectable()
export class UsersService {
  async findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
  }

  async createUser(data: { email: string; passwordHash: string; displayName: string }) {
    const defaultRole = await prisma.role.findUnique({
      where: { name: 'author' },
    });

    if (!defaultRole) {
      throw new Error('Default author role not found');
    }

    return prisma.user.create({
      data: {
        email: data.email.toLowerCase().trim(),
        passwordHash: data.passwordHash,
        displayName: data.displayName,
        roles: {
          create: {
            roleId: defaultRole.id,
          },
        },
      },
    });
  }
}
