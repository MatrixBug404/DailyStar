import {
  Injectable,
  ForbiddenException,
  UnauthorizedException,
  CanActivate,
  ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/require-permission.decorator';
import { PermissionResolverService } from '../permission-resolver.service';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private permissionResolver: PermissionResolverService,
  ) {}

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
    const resolved = await this.permissionResolver.resolveUserPermissions(user.sub);

    if (!resolved) {
      throw new UnauthorizedException('User not found or inactive');
    }

    // Attach resolved permissions to the request for potential further use
    request.userPermissions = resolved.permissions;

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true; // No permissions required at controller level, but loaded for service
    }

    const userPermissionsSet = new Set(resolved.permissions);
    const hasPermission = requiredPermissions.every((perm) => userPermissionsSet.has(perm));

    if (!hasPermission) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
