/**
 * Wall-clock times in a named time zone, sent to the API with an explicit offset (BUG-AS-21: the server refuses
 * naive times with TIMEZONE_REQUIRED). Uses Intl only, so it is correct across DST changes in any IANA zone.
 */

/** Minutes the zone is ahead of UTC at the instant `utcMillis`. */
export function zoneOffsetMinutes(utcMillis: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMillis));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(utcMillis / 1000) * 1000) / 60000);
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** `YYYY-MM-DDTHH:MM:00±HH:MM` for the wall time `hhmm` on `date` in `timeZone`. */
export function zonedIso(date: string, hhmm: string, timeZone: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, h, mi);
  let offset = zoneOffsetMinutes(wall, timeZone);
  const second = zoneOffsetMinutes(wall - offset * 60000, timeZone);
  if (second !== offset) offset = second;
  return `${date}T${hhmm}:00${formatOffset(offset)}`;
}

/** The calendar day after `date` (YYYY-MM-DD), without the device time zone. */
export function nextDayIso(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}
