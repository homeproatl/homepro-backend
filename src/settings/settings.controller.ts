import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { SettingsService } from './settings.service';
import { UpdateAppSettingsDto } from './dto/update-app-settings.dto';

@Controller('settings/app')
@UseGuards(AuthGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  getAppSettings() {
    return this.settingsService.getAppSettings();
  }

  @Patch()
  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  updateAppSettings(@Body() payload: UpdateAppSettingsDto) {
    return this.settingsService.updateAppSettings(payload);
  }
}
