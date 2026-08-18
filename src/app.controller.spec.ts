import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: getConnectionToken(),
          useValue: { readyState: 1 },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return service metadata', () => {
      expect(appController.getRoot()).toEqual(
        expect.objectContaining({
          service: 'contractor-backend',
          status: 'ok',
          health_url: '/health',
          readiness_url: '/ready',
        }),
      );
    });
  });

  describe('health', () => {
    it('should return runtime health metadata', () => {
      expect(appController.getHealth()).toEqual(
        expect.objectContaining({
          status: 'ok',
          service: 'contractor-backend',
        }),
      );
      expect(appController.getHealth().started_at).toEqual(expect.any(String));
    });
  });

  describe('ready', () => {
    it('should return runtime readiness metadata', () => {
      expect(appController.getReadiness()).toEqual(
        expect.objectContaining({
          status: 'ready',
          service: 'contractor-backend',
          checks: { mongo: 'ready' },
        }),
      );
      expect(appController.getReadiness().started_at).toEqual(
        expect.any(String),
      );
    });
  });
});
