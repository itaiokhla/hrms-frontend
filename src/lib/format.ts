import { format, formatDistanceToNowStrict, parseISO } from "date-fns";

import { formatMoney, minorUnit } from "./money";

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

/**
 * Legacy money display, now a thin wrapper over `formatMoney` (`@/lib/money`): exactly the
 * currency's ISO minor-unit digits instead of whole units, so payslip lines add up to their totals.
 *
 * Legacy APIs still send numbers; they are converted with `toString()` for display only (never
 * for arithmetic). Payroll v2 code must pass the API's decimal strings to `formatMoney` /
 * `MoneyText` instead. The legacy locale choice (en-IN for INR, en-US otherwise) is kept so
 * existing screens and their tests keep their grouping and symbols.
 */
export function fmtMoney(value: number | string | null | undefined, currency = "INR") {
  if (value === null || value === undefined || value === "") return "—";
  const locale = currency === "INR" ? "en-IN" : "en-US";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—";
    const text = value.toString();
    // Exponent notation (1e21, 5e-7) is not a decimal string; Intl handles those numbers directly.
    if (/e/i.test(text)) {
      return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: minorUnit(currency) ?? 2, maximumFractionDigits: minorUnit(currency) ?? 2 }).format(value);
    }
    return formatMoney(text, currency, { locale });
  }
  return formatMoney(value, currency, { locale });
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
