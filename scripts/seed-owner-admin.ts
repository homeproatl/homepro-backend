import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/users/users.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const usersService = app.get(UsersService);
    const user = await usersService.ensureOwnerAdmin();
    // eslint-disable-next-line no-console
    console.log(`Owner admin ready: ${user.email}`);
  } finally {
    await app.close();
  }
}

void bootstrap();
