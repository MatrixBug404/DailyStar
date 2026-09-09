import { Injectable } from '@nestjs/common';
import { prisma } from '../../database/client';

export interface CreateAuditLogParams {
  entityType: string;
  entityId: string;
  action: string;
  actorId?: string;
  beforeState?: any;
  afterState?: any;
  metadata?: any;
}

@Injectable()
export class AuditService {
  /**
   * Writes an audit log entry.
   * MUST accept a transaction client to ensure atomic state updates.
   */
  async log(params: CreateAuditLogParams, tx: any = prisma) {
    return tx.auditLog.create({
      data: {
        entityType: params.entityType,
        entityId: params.entityId,
        action: params.action,
        actorId: params.actorId,
        beforeState: params.beforeState ? params.beforeState : undefined,
        afterState: params.afterState ? params.afterState : undefined,
        metadata: params.metadata ? params.metadata : undefined,
      },
    });
  }
}
