import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

/**
 * Unit tests for AppController.
 * Tests the health endpoint in isolation — no HTTP server needed.
 */
describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = module.get<AppController>(AppController);
  });

  describe('getHealth', () => {
    it('should return status "ok"', () => {
      const result = appController.getHealth();
      expect(result.status).toBe('ok');
    });

    it('should include a valid ISO 8601 timestamp', () => {
      const result = appController.getHealth();
      expect(result.timestamp).toBeDefined();
      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    });
  });
});
