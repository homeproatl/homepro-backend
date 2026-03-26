import { AuthRateLimitService } from './auth-rate-limit.service';

describe('AuthRateLimitService', () => {
  it('blocks requests after the configured limit within the window', async () => {
    const futureReset = new Date(Date.now() + 60_000);
    const model = {
      findOneAndUpdate: jest
        .fn()
        .mockReturnValueOnce({
          exec: jest.fn().mockResolvedValue(null),
        })
        .mockReturnValueOnce({
          exec: jest.fn().mockResolvedValue({
            count: 1,
            reset_at: futureReset,
          }),
        })
        .mockReturnValueOnce({
          exec: jest.fn().mockResolvedValue(null),
        }),
      findOne: jest
        .fn()
        .mockReturnValueOnce({
          exec: jest.fn().mockResolvedValue(null),
        })
        .mockReturnValueOnce({
          exec: jest.fn().mockResolvedValue({
            count: 2,
            reset_at: futureReset,
          }),
        }),
    };
    const service = new AuthRateLimitService(model as never);

    await expect(service.consume('login:test', 2, 60_000)).resolves.toBeNull();

    const retryAfter = await service.consume('login:test', 2, 60_000);
    expect(typeof retryAfter).toBe('number');
    expect(retryAfter).toBeGreaterThan(0);
  });
});
