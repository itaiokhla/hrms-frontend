/**
 * Money display for payroll v2 (3.2 §3.4–§3.5, 3.8 §9).
 *
 * - Amounts arrive from the API as decimal strings: `{"amount": "12345.67", "currency": "INR"}`.
 * - They are NEVER converted to a JS number for arithmetic. Formatting passes the string straight
 *   to `Intl.NumberFormat`, which formats string input exactly in modern engines; engines that
 *   would round through a double get an exact BigInt-based fallback.
 * - Fraction digits come from the ISO 4217 catalogue generated from the backend
 *   (`catalogues.generated.ts`), never from Intl/CLDR defaults: CLDR gives IQD 0 digits where ISO
 *   says 3, LBP and RSD 0 where ISO says 2.
 * - `compareDecimalStrings` and `sumDecimalStrings` use exact string/BigInt arithmetic. They are for
 *   display previews only (sorting, a "selected total" hint); real totals always come from the server.
 */

import { CURRENCIES, type CurrencyInfo } from "@/lib/payroll/catalogues.generated";

export interface Money {
  /** Decimal string with exactly the currency's minor-unit digits ("1500" JPY, "12.345" KWD). */
  amount: string;
  /** ISO 4217 code. */
  currency: string;
}

const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const CODE = /^[A-Z]{3}$/;
const MAX_FRACTION_DIGITS = 20;

/** True for a plain decimal string ("12", "-0.50", "+3."); no exponents, no grouping. */
export function isDecimalString(value: unknown): value is string {
  return typeof value === "string" && DECIMAL.test(value);
}

export function currencyInfo(code: string | null | undefined): CurrencyInfo | undefined {
  if (!code) return undefined;
  return CURRENCIES[code.toUpperCase()];
}

/** ISO minor unit of a currency; `null` for non-monetary or unknown codes. */
export function minorUnit(code: string | null | undefined): number | null {
  return currencyInfo(code)?.minor_unit ?? null;
}

/* ------------------------------------------------------------------ decimal helpers (exact) */

interface Parsed {
  negative: boolean;
  int: string; // digits, no leading zeros ("0" for zero)
  frac: string; // digits, may be ""
}

function parse(value: string): Parsed {
  if (!isDecimalString(value)) throw new Error(`Not a decimal string: ${JSON.stringify(value)}`);
  let s = value;
  let negative = false;
  if (s[0] === "+" || s[0] === "-") {
    negative = s[0] === "-";
    s = s.slice(1);
  }
  const [rawInt, rawFrac = ""] = s.split(".");
  const int = rawInt.replace(/^0+(?=\d)/, "") || "0";
  const frac = rawFrac;
  const zero = /^0*$/.test(int) && /^0*$/.test(frac);
  return { negative: negative && !zero, int, frac };
}

function toScaled(p: Parsed, scale: number): bigint {
  const digits = p.int + p.frac.padEnd(scale, "0").slice(0, scale);
  const n = BigInt(digits);
  return p.negative ? -n : n;
}

function fromScaled(n: bigint, scale: number): string {
  const negative = n < BigInt(0);
  const digits = (negative ? -n : n).toString().padStart(scale + 1, "0");
  const int = digits.slice(0, digits.length - scale);
  const frac = scale ? `.${digits.slice(digits.length - scale)}` : "";
  return `${negative ? "-" : ""}${int}${frac}`;
}

/** Fraction digits written in a decimal string ("1.50" -> 2). */
export function fractionDigitsOf(value: string): number {
  return parse(value).frac.length;
}

export function isNegative(value: string): boolean {
  return isDecimalString(value) && parse(value).negative;
}

export function isZero(value: string): boolean {
  if (!isDecimalString(value)) return false;
  const p = parse(value);
  return /^0*$/.test(p.int) && /^0*$/.test(p.frac);
}

/** Exact comparison of two decimal strings: -1, 0 or 1. Throws on a non-decimal string. */
export function compareDecimalStrings(a: string, b: string): -1 | 0 | 1 {
  const pa = parse(a);
  const pb = parse(b);
  const scale = Math.max(pa.frac.length, pb.frac.length);
  const x = toScaled(pa, scale);
  const y = toScaled(pb, scale);
  return x === y ? 0 : x < y ? -1 : 1;
}

/**
 * Exact sum of decimal strings, with as many fraction digits as the most precise input.
 *
 * NON-AUTHORITATIVE: for display previews only (for example "3 selected · total 1,234.00").
 * Payroll totals, nets and anything stored or paid always come from the server.
 */
export function sumDecimalStrings(values: readonly string[]): string {
  const parsed = values.map(parse);
  const scale = parsed.reduce((m, p) => Math.max(m, p.frac.length), 0);
  const total = parsed.reduce((acc, p) => acc + toScaled(p, scale), BigInt(0));
  return fromScaled(total, scale);
}

/** Round a decimal string half away from zero to `digits` fraction digits (exact, string based). */
export function roundDecimalString(value: string, digits: number): string {
  const p = parse(value);
  if (p.frac.length <= digits) return fromScaled(toScaled(p, digits), digits);
  const kept = toScaled({ ...p, negative: false }, digits);
  const next = Number(p.frac[digits]);
  const magnitude = next >= 5 ? kept + BigInt(1) : kept;
  return fromScaled(p.negative ? -magnitude : magnitude, digits);
}

/* ------------------------------------------------------------------ formatting */

export interface FormatMoneyOptions {
  /** BCP 47 locale; defaults to the document language (the brand's default locale). */
  locale?: string;
  /** ISO code ("INR 1,234.00") instead of the symbol; use when several currencies are visible. */
  useCode?: boolean;
  /** Compact notation ("₹4.12Cr"). KPI cards only (3.8 §9); never in tables, payslips or exports. */
  compact?: boolean;
  signDisplay?: Intl.NumberFormatOptions["signDisplay"];
  /** Digits script; defaults to Latin digits so amounts match payslips and exports in every locale. */
  numberingSystem?: string;
}

/** The locale money is shown in: the `<html lang>` the brand sets, or "en" on the server. */
export function defaultMoneyLocale(): string {
  if (typeof document === "undefined") return "en";
  return document.documentElement.lang || "en";
}

let exactStrings: boolean | null = null;

/** Whether this engine formats decimal strings exactly (Intl.NumberFormat v3). */
export function supportsExactStringFormatting(): boolean {
  if (exactStrings === null) {
    try {
      const nf = new Intl.NumberFormat("en-US", { useGrouping: false, maximumFractionDigits: 0 });
      exactStrings = formatString(nf, "9007199254740993") === "9007199254740993";
    } catch {
      exactStrings = false;
    }
  }
  return exactStrings;
}

/** Test hook: force the fallback path (`false`) or re-detect (`null`). */
export function __setExactStringSupport(value: boolean | null) {
  exactStrings = value;
}

function formatString(nf: Intl.NumberFormat, value: string): string {
  // Intl accepts decimal strings at runtime (ES2023 Intl.NumberFormat v3); the TS lib here is ES2020.
  return (nf.format as unknown as (v: string) => string)(value);
}

const cache = new Map<string, Intl.NumberFormat>();

function numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let nf = cache.get(key);
  if (!nf) {
    try {
      nf = new Intl.NumberFormat(locale, options);
    } catch {
      nf = new Intl.NumberFormat("en", options);
    }
    cache.set(key, nf);
  }
  return nf;
}

/** Exact formatting for engines that would round strings through a double. */
function formatFallback(locale: string, options: Intl.NumberFormatOptions, value: string, digits: number): string {
  const rounded = roundDecimalString(value, digits);
  const p = parse(rounded);
  const intFormat = numberFormat(locale, { ...options, minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const signed = BigInt(p.int) * (p.negative ? BigInt(-1) : BigInt(1));
  // A negative zero integer part ("-0.50") needs a sign the BigInt cannot carry.
  const parts = intFormat.formatToParts(p.negative && p.int === "0" ? -0.1 : (signed as unknown as number));
  if (!digits) return parts.map((x) => x.value).join("");
  const decimal = numberFormat(locale, { ...options, minimumFractionDigits: 1 }).formatToParts(1.5).find((x) => x.type === "decimal")?.value ?? ".";
  let lastInteger = -1;
  parts.forEach((x, i) => {
    if (x.type === "integer") lastInteger = i;
  });
  if (p.negative && p.int === "0") {
    parts.forEach((x) => {
      if (x.type === "integer") x.value = "0";
    });
  }
  const out = parts.map((x) => x.value);
  out.splice(lastInteger + 1, 0, decimal + p.frac);
  return out.join("");
}

/**
 * Format an exact decimal string in a currency, with exactly the currency's ISO minor-unit digits.
 *
 * Returns the input unchanged when it is not a decimal string, so a bad value is visible instead of
 * silently shown as zero.
 */
export function formatMoney(amount: string, currency: string, opts: FormatMoneyOptions = {}): string {
  if (!isDecimalString(amount)) return String(amount ?? "—");
  const code = (currency || "").toUpperCase();
  const info = CURRENCIES[code];
  const value = isZero(amount) ? amount.replace(/^[+-]/, "") : amount.replace(/^\+/, "");
  const digits = Math.min(info?.minor_unit ?? fractionDigitsOf(value), MAX_FRACTION_DIGITS);
  const locale = opts.locale || defaultMoneyLocale();
  const options: Intl.NumberFormatOptions = {
    numberingSystem: opts.numberingSystem ?? "latn",
    signDisplay: opts.signDisplay,
  } as Intl.NumberFormatOptions;
  const wellFormed = CODE.test(code);
  if (wellFormed) {
    options.style = "currency";
    options.currency = code;
    options.currencyDisplay = opts.useCode ? "code" : "symbol";
  }
  if (opts.compact) {
    options.notation = "compact";
    options.compactDisplay = "short";
    options.minimumFractionDigits = 0;
    options.maximumFractionDigits = Math.min(2, digits);
  } else {
    options.minimumFractionDigits = digits;
    options.maximumFractionDigits = digits;
  }
  if (!options.signDisplay) delete options.signDisplay;
  const nf = numberFormat(locale, options);
  let text: string;
  if (opts.compact) {
    // Compact notation shows at most 3 significant digits, so a double is precise enough here.
    text = supportsExactStringFormatting() ? formatString(nf, value) : nf.format(Number(value));
  } else {
    text = supportsExactStringFormatting() ? formatString(nf, value) : formatFallback(locale, options, value, digits);
  }
  return wellFormed ? text : `${text} ${code}`.trim();
}

/** `formatMoney` for a `{amount, currency}` DTO; "—" for null. */
export function formatMoneyDto(money: Money | null | undefined, opts?: FormatMoneyOptions): string {
  if (!money) return "—";
  return formatMoney(money.amount, money.currency, opts);
}

/** ISO codes are needed whenever more than one currency is visible (EC-MON-16: "$" alone is ambiguous). */
export function needsIsoCodes(currencies: Iterable<string | null | undefined>): boolean {
  const seen = new Set<string>();
  for (const c of currencies) if (c) seen.add(c.toUpperCase());
  return seen.size > 1;
}

/* ------------------------------------------------------------------ input parsing */

export type ParseMoneyError = "EMPTY" | "INVALID" | "TOO_MANY_DIGITS" | "NEGATIVE" | "NOT_MONEY";

export type ParseMoneyResult = { ok: true; amount: string } | { ok: false; error: ParseMoneyError; message: string };

const DIGIT_BLOCKS = [0x0660, 0x06f0, 0x0966, 0x09e6]; // Arabic-Indic, Extended Arabic-Indic, Devanagari, Bengali

function latinDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹०-९০-৯]/g, (ch) => {
    const cp = ch.charCodeAt(0);
    const base = DIGIT_BLOCKS.find((b) => cp >= b && cp <= b + 9) ?? 0;
    return String(cp - base);
  });
}

function decimalSeparator(locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { minimumFractionDigits: 1, numberingSystem: "latn" } as Intl.NumberFormatOptions)
      .formatToParts(1.5)
      .find((p) => p.type === "decimal")?.value ?? ".";
  } catch {
    return ".";
  }
}

/**
 * Parse what a person typed into an exact decimal string for the API (EC-MON-15: money is sent as
 * a string, never a JSON number). Accepts locale grouping, the locale's decimal separator, Arabic
 * and Devanagari digits and the Unicode minus sign. Rejects more fraction digits than the
 * currency's minor unit. The result is padded to exactly the minor-unit digits ("1500" JPY, "12.50" INR).
 */
export function parseMoneyInput(
  input: string,
  currency: string,
  opts: { locale?: string; allowNegative?: boolean } = {},
): ParseMoneyResult {
  const unit = minorUnit(currency);
  if (unit === null) return { ok: false, error: "NOT_MONEY", message: `${currency || "This currency"} can't be used for amounts.` };
  let text = latinDigits(input ?? "").trim();
  if (!text) return { ok: false, error: "EMPTY", message: "Enter an amount." };
  text = text.replace(/[−‒–﹣－]/g, "-").replace(/٫/g, ".").replace(/[\s  ٬'’_]/g, "");
  const decimal = decimalSeparator(opts.locale || defaultMoneyLocale());
  if (decimal === ",") text = text.replace(/\./g, "").replace(/,/g, ".");
  else text = text.replace(/,/g, "");
  if (!isDecimalString(text)) return { ok: false, error: "INVALID", message: "Enter a number, for example 1250.50." };
  const p = parse(text);
  if (p.negative && !opts.allowNegative) return { ok: false, error: "NEGATIVE", message: "The amount can't be negative." };
  const frac = p.frac.replace(/0+$/, "");
  if (frac.length > unit) {
    return {
      ok: false,
      error: "TOO_MANY_DIGITS",
      message: unit === 0 ? `${currency.toUpperCase()} amounts have no decimals.` : `${currency.toUpperCase()} amounts have at most ${unit} decimals.`,
    };
  }
  return { ok: true, amount: fromScaled(toScaled({ ...p, frac }, unit), unit) };
}
