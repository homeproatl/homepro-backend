import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from './users.service';

@Injectable()
export class UsersBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UsersBootstrapService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  async onApplicationBootstrap() {
    const ownerAdminName = this.configService.get<string>('OWNER_ADMIN_NAME');
    const ownerAdminEmail = this.configService.get<string>('OWNER_ADMIN_EMAIL');
    const ownerAdminPassword = this.configService.get<string>(
      'OWNER_ADMIN_PASSWORD',
    );

    if (!ownerAdminName || !ownerAdminEmail || !ownerAdminPassword) {
      this.logger.warn(
        'Owner admin bootstrap skipped because OWNER_ADMIN_* env values are incomplete.',
      );
      return;
    }

    const user = await this.usersService.ensureOwnerAdmin();
    this.logger.log(`Owner admin ready: ${user.email}`);
  }
}
