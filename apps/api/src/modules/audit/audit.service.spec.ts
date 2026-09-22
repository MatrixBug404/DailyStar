import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from './audit.service';
import { prisma } from '../../database/client';

describe('AuditService', () => {
  let service: AuditService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditService],
    }).compile();

    service = module.get<AuditService>(AuditService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should expose only log()', () => {
    const methods = Object.getOwnPropertyNames(AuditService.prototype).filter(
      (name) => name !== 'constructor',
    );
    expect(methods).toEqual(['log']);
  });

  it('should not contain any update or delete API', () => {
    const methods = Object.getOwnPropertyNames(AuditService.prototype);
    expect(methods.some((name) => name.toLowerCase().includes('update'))).toBeFalsy();
    expect(methods.some((name) => name.toLowerCase().includes('delete'))).toBeFalsy();
    expect(methods.some((name) => name.toLowerCase().includes('remove'))).toBeFalsy();
    expect(methods.some((name) => name.toLowerCase().includes('patch'))).toBeFalsy();
  });

  it('should successfully log via a transaction client without leaking sensitive data', async () => {
    const mockTx = {
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-123' }),
      },
    };

    const params = {
      entityType: 'Article',
      entityId: 'art-1',
      action: 'APPROVE',
      actorId: 'usr-1',
      beforeState: { status: 'UNDER_REVIEW' },
      afterState: { status: 'APPROVED' },
      metadata: { reason: 'Looks good' },
    };

    await service.log(params, mockTx);

    expect(mockTx.auditLog.create).toHaveBeenCalledWith({
      data: {
        entityType: 'Article',
        entityId: 'art-1',
        action: 'APPROVE',
        actorId: 'usr-1',
        beforeState: { status: 'UNDER_REVIEW' },
        afterState: { status: 'APPROVED' },
        metadata: { reason: 'Looks good' },
      },
    });
  });
});
