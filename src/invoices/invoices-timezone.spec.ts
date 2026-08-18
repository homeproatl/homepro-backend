import { startOfBusinessCalendarDateUtc } from '../common/utils/business-time';

describe('startOfDayInTimeZone', () => {
  it('returns business-local midnight for America/New_York', () => {
    // 2026-03-15 08:30 UTC → still March 15 in New York (EDT, UTC-4)
    const now = new Date('2026-03-15T08:30:00.000Z');
    const start = startOfBusinessCalendarDateUtc(now, 'America/New_York');
    expect(start.toISOString()).toBe('2026-03-15T00:00:00.000Z');
  });

  it('crosses the UTC date line correctly near midnight', () => {
    // 2026-03-16 02:00 UTC → still March 15 evening in New York
    const now = new Date('2026-03-16T02:00:00.000Z');
    const start = startOfBusinessCalendarDateUtc(now, 'America/New_York');
    expect(start.toISOString()).toBe('2026-03-15T00:00:00.000Z');
  });
});
