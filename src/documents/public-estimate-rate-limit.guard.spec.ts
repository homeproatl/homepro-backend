import { HttpException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { PublicEstimateRateLimitGuard } from './public-estimate-rate-limit.guard';

function createContext(method: string) {
  const request = {
    method,
    ip: '203.0.113.10',
    socket: {},
    params: { token: 'public-token' },
    headers: { 'x-forwarded-for': '198.51.100.20' },
  };
  const response = { setHeader: jest.fn() };

  return {
    request,
    response,
    context: {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext,
  };
}

describe('PublicEstimateRateLimitGuard', () => {
  it('uses the larger read budget and trusted request IP', async () => {
    const consume = jest.fn().mockResolvedValue(null);
    const guard = new PublicEstimateRateLimitGuard({ consume } as never);
    const { context } = createContext('GET');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(consume).toHaveBeenNthCalledWith(
      1,
      'public-document:v2:read:ip:203.0.113.10',
      240,
      60_000,
    );
    expect(consume).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('public-document:v2:read:token:'),
      240,
      60_000,
    );
  });

  it('keeps checkout and other writes in a stricter action bucket', async () => {
    const consume = jest.fn().mockResolvedValue(null);
    const guard = new PublicEstimateRateLimitGuard({ consume } as never);
    const { context } = createContext('POST');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(consume).toHaveBeenNthCalledWith(
      1,
      'public-document:v2:action:ip:203.0.113.10',
      20,
      60_000,
    );
  });

  it('returns a Retry-After header when a bucket is exhausted', async () => {
    const consume = jest.fn().mockResolvedValueOnce(12);
    const guard = new PublicEstimateRateLimitGuard({ consume } as never);
    const { context, response } = createContext('GET');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '12');
  });
});
