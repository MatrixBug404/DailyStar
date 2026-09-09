import { Injectable } from '@nestjs/common';
import type { HealthResponse } from '@dailystar/types';

/**
 * Application-level service.
 * Currently only provides the health check response.
 * Business logic services will live in domain modules (auth/, articles/, etc.).
 */
@Injectable()
export class AppService {
  getHealth(): HealthResponse {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? '0.0.1',
    };
  }
}
