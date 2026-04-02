import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
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
  updateAppSettings(@Body() payload: UpdateAppSettingsDto) {
    return this.settingsService.updateAppSettings(payload);
  }
}
