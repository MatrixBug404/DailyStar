import { Injectable } from '@nestjs/common';
import { PrismaClient, User } from '../../database/generated/prisma';
import { PermissionResolverService } from '../rbac/permission-resolver.service';
import { UnauthorizedException, NotFoundException } from '@nestjs/common';

const prisma = new PrismaClient();

@Injectable()
export class UsersService {
  constructor(private readonly permissionResolver: PermissionResolverService) {}

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

  async getMe(userId: string) {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const resolved = await this.permissionResolver.resolveUserPermissions(userId);
    if (!resolved) {
      throw new UnauthorizedException('User not found or inactive');
    }

    const { passwordHash: _passwordHash, ...safeUser } = user;
    return {
      ...safeUser,
      roles: resolved.roles,
      permissions: resolved.permissions,
    };
  }
}
