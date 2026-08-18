import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

@Injectable()
export class AppService {
  private readonly startedAt = new Date().toISOString();

  constructor(@InjectConnection() private readonly connection: Connection) {}

  getRoot() {
    return {
      service: 'contractor-backend',
      status: 'ok' as const,
      health_url: '/health',
      readiness_url: '/ready',
    };
  }

  getHealth() {
    return {
      status: 'ok' as const,
      service: 'contractor-backend',
      started_at: this.startedAt,
    };
  }

  getReadiness() {
    const mongoReady = this.connection.readyState === 1;
    return {
      status: mongoReady ? ('ready' as const) : ('not_ready' as const),
      service: 'contractor-backend',
      started_at: this.startedAt,
      checks: {
        mongo: mongoReady ? ('ready' as const) : ('not_ready' as const),
      },
    };
  }
}
