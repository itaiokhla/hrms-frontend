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
