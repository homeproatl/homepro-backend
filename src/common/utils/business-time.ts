function zonedParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  return Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;
}

function zonedDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  timeZone: string,
) {
  const targetAsUtc = Date.UTC(year, month - 1, day);
  let result = targetAsUtc;

  // Two passes handle offsets that differ between the initial UTC guess and
  // the requested local date (including daylight-saving boundaries).
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = zonedParts(new Date(result), timeZone);
    const representedAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    result = targetAsUtc - (representedAsUtc - result);
  }
  return new Date(result);
}

export function startOfDayInTimeZone(now: Date, timeZone: string): Date {
  const parts = zonedParts(now, timeZone);
  return zonedDateTimeToUtc(
    Number(parts.year),
    Number(parts.month),
    Number(parts.day),
    timeZone,
  );
}

export function calendarDateInTimeZone(now: Date, timeZone: string): string {
  const parts = zonedParts(now, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** UTC storage boundary for a business-local calendar date such as a due date. */
export function startOfBusinessCalendarDateUtc(
  now: Date,
  timeZone: string,
): Date {
  return new Date(`${calendarDateInTimeZone(now, timeZone)}T00:00:00.000Z`);
}

export function parseCalendarDateUtc(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

export function calendarDateBoundsInTimeZone(
  dateValue: string,
  timeZone: string,
) {
  const source = parseCalendarDateUtc(dateValue);
  if (!source) return null;
  const year = source.getUTCFullYear();
  const month = source.getUTCMonth() + 1;
  const day = source.getUTCDate();
  const next = new Date(source);
  next.setUTCDate(next.getUTCDate() + 1);
  const start = zonedDateTimeToUtc(year, month, day, timeZone);
  const endExclusive = zonedDateTimeToUtc(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    timeZone,
  );
  return { start, endExclusive };
}
