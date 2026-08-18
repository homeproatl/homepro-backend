import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CsrfOriginGuard } from './csrf-origin.guard';

describe('CsrfOriginGuard', () => {
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'FRONTEND_ORIGIN') {
        return 'https://www.homepro.example';
      }

      return undefined;
    }),
  } as unknown as ConfigService;

  const guard = new CsrfOriginGuard(configService);

  it('allows requests from the configured frontend origin', () => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: {
            origin: 'https://www.homepro.example',
          },
        }),
      }),
    };

    expect(guard.canActivate(context as never)).toBe(true);
  });

  it('blocks requests without a trusted origin', () => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: {
            origin: 'https://evil.example',
          },
        }),
      }),
    };

    expect(() => guard.canActivate(context as never)).toThrow(
      ForbiddenException,
    );
  });
});
