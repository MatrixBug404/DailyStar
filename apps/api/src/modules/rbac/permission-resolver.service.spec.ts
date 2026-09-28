import { Test, TestingModule } from '@nestjs/testing';
import { PermissionResolverService } from './permission-resolver.service';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from './guards/permission.guard';

// Mock the prisma singleton
jest.mock('../../database/client', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
  },
}));
import { prisma } from '../../database/client';

describe('PermissionResolverService and PermissionGuard', () => {
  let resolver: PermissionResolverService;
  let guard: PermissionGuard;
  let reflector: Reflector;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PermissionResolverService, PermissionGuard, Reflector],
    }).compile();

    resolver = module.get<PermissionResolverService>(PermissionResolverService);
    guard = module.get<PermissionGuard>(PermissionGuard);
    reflector = module.get<Reflector>(Reflector);
    jest.clearAllMocks();
  });

  describe('PermissionResolverService', () => {
    it('returns null if user does not exist', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      const result = await resolver.resolveUserPermissions('missing-id');
      expect(result).toBeNull();
    });

    it('returns null if user is inactive', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'inactive-id', isActive: false });
      const result = await resolver.resolveUserPermissions('inactive-id');
      expect(result).toBeNull();
    });

    it('returns roles and permissions for active user', async () => {
      const mockDbUser = {
        id: 'active-id',
        isActive: true,
        roles: [
          {
            role: {
              name: 'editor',
              permissions: [
                { permission: { name: 'article.read' } },
                { permission: { name: 'article.create' } },
              ],
            },
          },
        ],
      };
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockDbUser);

      const result = await resolver.resolveUserPermissions('active-id');
      expect(result).toEqual({
        roles: ['editor'],
        permissions: ['article.read', 'article.create'],
      });
    });
  });

  describe('PermissionGuard', () => {
    const createMockContext = (user: any, handler: any = jest.fn(), cls: any = jest.fn()): ExecutionContext => ({
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
      getHandler: () => handler,
      getClass: () => cls,
    } as unknown as ExecutionContext);

    it('throws UnauthorizedException if no user on request', async () => {
      const context = createMockContext(undefined);
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([]);

      await expect(guard.canActivate(context)).rejects.toThrow(new UnauthorizedException('Authentication required'));
    });

    it('throws UnauthorizedException if resolver returns null (missing or inactive)', async () => {
      const context = createMockContext({ sub: 'inactive-id' });
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([]);
      jest.spyOn(resolver, 'resolveUserPermissions').mockResolvedValue(null);

      await expect(guard.canActivate(context)).rejects.toThrow(new UnauthorizedException('User not found or inactive'));
    });

    it('returns true if no permissions are required and attaches userPermissions', async () => {
      const req: any = { user: { sub: 'active-id' } };
      const context = {
        switchToHttp: () => ({ getRequest: () => req }),
        getHandler: jest.fn(),
        getClass: jest.fn(),
      } as unknown as ExecutionContext;
      
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      jest.spyOn(resolver, 'resolveUserPermissions').mockResolvedValue({
        roles: ['author'],
        permissions: ['article.read'],
      });

      const result = await guard.canActivate(context);
      expect(result).toBe(true);
      expect(req.userPermissions).toEqual(['article.read']);
    });

    it('throws ForbiddenException if required permission is missing', async () => {
      const context = createMockContext({ sub: 'active-id' });
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['article.delete']);
      jest.spyOn(resolver, 'resolveUserPermissions').mockResolvedValue({
        roles: ['author'],
        permissions: ['article.read'],
      });

      await expect(guard.canActivate(context)).rejects.toThrow(new ForbiddenException('Insufficient permissions'));
    });

    it('returns true if required permissions are met', async () => {
      const context = createMockContext({ sub: 'active-id' });
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['article.read']);
      jest.spyOn(resolver, 'resolveUserPermissions').mockResolvedValue({
        roles: ['author'],
        permissions: ['article.read', 'article.create'],
      });

      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });
  });
});
