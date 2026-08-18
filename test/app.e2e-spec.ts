import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.objectContaining({
            service: 'contractor-backend',
            status: 'ok',
            health_url: '/health',
            readiness_url: '/ready',
          }),
        );
      });
  });

  it('/ready (GET)', () => {
    return request(app.getHttpServer())
      .get('/ready')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.objectContaining({
            service: 'contractor-backend',
            status: 'ready',
          }),
        );
        expect(body.started_at).toEqual(expect.any(String));
      });
  });
});
