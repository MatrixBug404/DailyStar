import { Injectable } from '@nestjs/common';
import { prisma } from '../../database/client';

@Injectable()
export class PermissionResolverService {
  async resolveUserPermissions(userId: string): Promise<{ roles: string[]; permissions: string[] } | null> {
    const dbUser = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        roles: {
          include: {
            role: {
              include: {
                permissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!dbUser || !dbUser.isActive) {
      return null;
    }

    const roles: string[] = [];
    const permissions = new Set<string>();

    for (const userRole of dbUser.roles) {
      roles.push(userRole.role.name);
      for (const rolePerm of userRole.role.permissions) {
        permissions.add(rolePerm.permission.name);
      }
    }

    return {
      roles,
      permissions: Array.from(permissions),
    };
  }
}
