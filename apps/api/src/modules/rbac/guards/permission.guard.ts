import {
  Injectable,
  ForbiddenException,
  UnauthorizedException,
  CanActivate,
  ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { prisma } from '../../../database/client';
import { PERMISSIONS_KEY } from '../decorators/require-permission.decorator';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    // Server-side permission resolution
    const dbUser = await prisma.user.findUnique({
      where: { id: user.sub },
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
      throw new UnauthorizedException('User not found or inactive');
    }

    const userPermissions = new Set<string>();
    for (const userRole of dbUser.roles) {
      for (const rolePerm of userRole.role.permissions) {
        userPermissions.add(rolePerm.permission.name);
      }
    }

    // Attach resolved permissions to the request for potential further use
    request.userPermissions = Array.from(userPermissions);

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true; // No permissions required at controller level, but loaded for service
    }

    const hasPermission = requiredPermissions.every((perm) => userPermissions.has(perm));

    if (!hasPermission) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
