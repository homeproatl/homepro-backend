import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import {
  AppSettings,
  AppSettingsDocument,
} from './schemas/app-settings.schema';
import { UpdateAppSettingsDto } from './dto/update-app-settings.dto';

const FALLBACK_BUSINESS_TIMEZONE = 'America/New_York';

@Injectable()
export class SettingsService {
  constructor(
    @InjectModel(AppSettings.name)
    private readonly appSettingsModel: Model<AppSettingsDocument>,
    private readonly configService: ConfigService,
  ) {}

  async getAppSettings() {
    const settings = await this.findOrCreateSettings();
    return this.toAppSettingsContract(settings);
  }

  async updateAppSettings(payload: UpdateAppSettingsDto) {
    const settings = await this.findOrCreateSettings();

    if (payload.business_timezone !== undefined) {
      this.assertValidTimeZone(payload.business_timezone);
      settings.business_timezone = payload.business_timezone;
    }

    await settings.save();
    return this.toAppSettingsContract(settings);
  }

  private async findOrCreateSettings() {
    const defaultBusinessTimeZone = this.resolveDefaultBusinessTimeZone();

    const settings = await this.appSettingsModel
      .findOneAndUpdate(
        { singleton_key: 'app' },
        {
          $setOnInsert: {
            singleton_key: 'app',
            business_timezone: defaultBusinessTimeZone,
          },
        },
        {
          upsert: true,
          returnDocument: 'after',
          setDefaultsOnInsert: true,
        },
      )
      .exec();

    if (!settings) {
      throw new BadRequestException(
        'Unable to load business timezone settings',
      );
    }

    if (this.isValidTimeZone(settings.business_timezone)) {
      return settings;
    }

    settings.business_timezone = defaultBusinessTimeZone;
    await settings.save();

    return settings;
  }

  private resolveDefaultBusinessTimeZone() {
    const businessTimeZone =
      this.configService.get<string>('BUSINESS_TIMEZONE') ??
      FALLBACK_BUSINESS_TIMEZONE;

    this.assertValidTimeZone(businessTimeZone);
    return businessTimeZone;
  }

  private toAppSettingsContract(settings: AppSettingsDocument) {
    return {
      id: settings.singleton_key,
      business_timezone: settings.business_timezone,
      created_at: (
        settings as unknown as { created_at?: Date }
      ).created_at?.toISOString(),
      updated_at: (
        settings as unknown as { updated_at?: Date }
      ).updated_at?.toISOString(),
    };
  }

  private assertValidTimeZone(value: string) {
    if (!this.isValidTimeZone(value)) {
      throw new BadRequestException('Invalid business timezone');
    }
  }

  private isValidTimeZone(value: string) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
      return true;
    } catch {
      return false;
    }
  }
}
