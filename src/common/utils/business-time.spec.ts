import {
  calendarDateBoundsInTimeZone,
  calendarDateInTimeZone,
  parseCalendarDateUtc,
  startOfBusinessCalendarDateUtc,
  startOfDayInTimeZone,
} from './business-time';

describe('business time utilities', () => {
  it('returns business-local midnight across the UTC date line', () => {
    expect(
      startOfDayInTimeZone(
        new Date('2026-03-16T02:00:00.000Z'),
        'America/New_York',
      ).toISOString(),
    ).toBe('2026-03-15T04:00:00.000Z');
  });

  it('maps the current instant to a stable stored business calendar date', () => {
    const now = new Date('2026-03-16T02:00:00.000Z');
    expect(calendarDateInTimeZone(now, 'America/New_York')).toBe('2026-03-15');
    expect(
      startOfBusinessCalendarDateUtc(now, 'America/New_York').toISOString(),
    ).toBe('2026-03-15T00:00:00.000Z');
  });

  it('builds an exclusive business-day range across daylight saving time', () => {
    const bounds = calendarDateBoundsInTimeZone(
      '2026-03-08',
      'America/New_York',
    );
    expect(bounds?.start.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(bounds?.endExclusive.toISOString()).toBe('2026-03-09T04:00:00.000Z');
  });

  it('rejects impossible calendar dates instead of normalizing them', () => {
    expect(parseCalendarDateUtc('2026-02-29')).toBeNull();
    expect(
      calendarDateBoundsInTimeZone('2026-02-29', 'America/New_York'),
    ).toBeNull();
    expect(parseCalendarDateUtc('2028-02-29')?.toISOString()).toBe(
      '2028-02-29T00:00:00.000Z',
    );
  });
});
