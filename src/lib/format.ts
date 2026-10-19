import { format, formatDistanceToNowStrict, parseISO } from "date-fns";

export function fmtDate(value?: string | null, pattern = "d MMM yyyy") {
  if (!value) return "—";
  try {
    return format(parseISO(value), pattern);
  } catch {
    return value;
  }
}

export function fmtTime(value?: string | null) {
  return fmtDate(value, "h:mm a");
}

export function fmtDateTime(value?: string | null) {
  return fmtDate(value, "d MMM yyyy, h:mm a");
}

export function fromNow(value?: string | null) {
  if (!value) return "—";
  try {
    return `${formatDistanceToNowStrict(parseISO(value))} ago`;
  } catch {
    return value;
  }
}

export function fmtMoney(value: number | null | undefined, currency = "INR") {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function fmtDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

/** Duration that may be unknown (a missing punch-out is never shown as zero). */
export function fmtHours(seconds: number | null | undefined) {
  return seconds === null || seconds === undefined ? "—" : fmtDuration(Math.max(0, seconds));
}

/** H:MM:SS for live counters; whole seconds are truncated, never rounded up. */
export function fmtClock(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

/** Distances and accuracy radii: metres below 1 km, kilometres above. */
export function fmtMeters(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return value < 1000 ? `${Math.round(value)} m` : `${(value / 1000).toFixed(value < 10_000 ? 2 : 1)} km`;
}

export function initials(name?: string | null) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function titleCase(value?: string | null) {
  if (!value) return "";
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function todayISO() {
  return format(new Date(), "yyyy-MM-dd");
}
