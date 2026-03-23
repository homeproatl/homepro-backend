import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  private readonly startedAt = new Date().toISOString();

  getHello(): string {
    return 'Hello World!';
  }

  getHealth() {
    return {
      status: 'ok' as const,
      service: 'rico-backend',
      started_at: this.startedAt,
    };
  }
}
