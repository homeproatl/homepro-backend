import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentActor } from '../common/decorators/current-actor.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthActor } from '../common/types/auth-actor';
import { SettingsService } from './settings.service';
import { UpdateAppSettingsDto } from './dto/update-app-settings.dto';

@Controller('settings/app')
@UseGuards(AuthGuard, RolesGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  getAppSettings(@CurrentActor() actor: AuthActor) {
    return this.settingsService.getAppSettings(
      actor.organization_id,
      actor.role,
    );
  }

  @Patch()
  @Roles(UserRole.ADMIN)
  updateAppSettings(
    @Body() payload: UpdateAppSettingsDto,
    @CurrentActor() actor: AuthActor,
  ) {
    return this.settingsService.updateAppSettings(
      payload,
      actor.organization_id,
    );
  }
}
