import { ConfigService } from '@nestjs/config';
import {
  clearRefreshTokenCookie,
  setRefreshTokenCookie,
} from './auth-cookie';

describe('auth-cookie', () => {
  it('uses SameSite=lax for refresh cookies in production', () => {
    const response = {
      cookie: jest.fn(),
    };
    const configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'NODE_ENV') {
          return 'production';
        }

        return undefined;
      }),
      getOrThrow: jest.fn().mockImplementation((key: string) => {
        if (key === 'JWT_REFRESH_TTL') {
          return '7d';
        }

        throw new Error(`Unexpected config key: ${key}`);
      }),
    } as unknown as ConfigService;

    setRefreshTokenCookie(response as never, configService, 'refresh-token');

    expect(response.cookie).toHaveBeenCalledWith(
      'rico_refresh_token',
      'refresh-token',
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
      }),
    );
  });

  it('clears refresh cookies with the same hardened options', () => {
    const response = {
      clearCookie: jest.fn(),
    };
    const configService = {
      get: jest.fn().mockReturnValue('production'),
      getOrThrow: jest.fn().mockReturnValue('7d'),
    } as unknown as ConfigService;

    clearRefreshTokenCookie(response as never, configService);

    expect(response.clearCookie).toHaveBeenCalledWith(
      'rico_refresh_token',
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
      }),
    );
  });
});
