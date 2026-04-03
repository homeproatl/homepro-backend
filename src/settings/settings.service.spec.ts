import { ConfigService } from '@nestjs/config';
import { SettingsService } from './settings.service';

describe('SettingsService', () => {
  it('creates app settings with the configured default timezone using an atomic upsert', async () => {
    const createdAt = new Date('2026-04-03T08:00:00.000Z');
    const updatedAt = new Date('2026-04-03T09:00:00.000Z');
    const findOneAndUpdate = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        singleton_key: 'app',
        business_timezone: 'America/Chicago',
        created_at: createdAt,
        updated_at: updatedAt,
        toObject: () => ({
          singleton_key: 'app',
          business_timezone: 'America/Chicago',
        }),
      }),
    });

    const service = new SettingsService(
      { findOneAndUpdate } as never,
      {
        get: jest.fn().mockReturnValue('America/Chicago'),
      } as unknown as ConfigService,
    );

    const settings = await service.getAppSettings();

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { singleton_key: 'app' },
      {
        $setOnInsert: {
          singleton_key: 'app',
          business_timezone: 'America/Chicago',
        },
      },
      {
        upsert: true,
        returnDocument: 'after',
        setDefaultsOnInsert: true,
      },
    );
    expect(settings).toEqual({
      id: 'app',
      business_timezone: 'America/Chicago',
      created_at: createdAt.toISOString(),
      updated_at: updatedAt.toISOString(),
    });
  });

  it('rejects invalid timezones during update', async () => {
    const save = jest.fn();
    const findOneAndUpdate = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        singleton_key: 'app',
        business_timezone: 'America/New_York',
        save,
      }),
    });

    const service = new SettingsService(
      { findOneAndUpdate } as never,
      {
        get: jest.fn().mockReturnValue('America/New_York'),
      } as unknown as ConfigService,
    );

    await expect(
      service.updateAppSettings({ business_timezone: 'Broken/Timezone' }),
    ).rejects.toThrow('Invalid business timezone');
    expect(save).not.toHaveBeenCalled();
  });

  it('self-heals an invalid stored timezone by falling back to the configured default', async () => {
    const save = jest.fn();
    const invalidStoredSettings = {
      singleton_key: 'app',
      business_timezone: 'Broken/Timezone',
      save,
      toObject: () => ({
        singleton_key: 'app',
        business_timezone: 'America/New_York',
      }),
    };
    const findOneAndUpdate = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(invalidStoredSettings),
    });

    const service = new SettingsService(
      { findOneAndUpdate } as never,
      {
        get: jest.fn().mockReturnValue('America/New_York'),
      } as unknown as ConfigService,
    );

    const settings = await service.getAppSettings();

    expect(save).toHaveBeenCalled();
    expect(invalidStoredSettings.business_timezone).toBe('America/New_York');
    expect(settings.business_timezone).toBe('America/New_York');
  });
});
