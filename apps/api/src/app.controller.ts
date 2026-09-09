import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import type { HealthResponse } from '@dailystar/types';

/**
 * Root controller providing the application health check endpoint.
 *
 * GET /health — returns API health status.
 * Note: this endpoint is intentionally placed outside the /api global prefix
 * so infrastructure health checkers (load balancers, Docker, etc.) can access
 * it without versioning concerns.
 */
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /**
   * Health check endpoint.
   * Returns HTTP 200 with `{ status: "ok" }` when the service is healthy.
   */
  @Get('health')
  getHealth(): HealthResponse {
    return this.appService.getHealth();
  }
}
