import { fmtMoney } from "../format";
import {
  __setExactStringSupport,
  compareDecimalStrings,
  currencyInfo,
  formatMoney,
  formatMoneyDto,
  isDecimalString,
  isNegative,
  minorUnit,
  needsIsoCodes,
  parseMoneyInput,
  roundDecimalString,
  sumDecimalStrings,
  supportsExactStringFormatting,
} from "../money";

/** Intl output uses NBSP / narrow NBSP and bidi marks; compare on plain spaces without marks. */
const plain = (s: string) => s.replace(/[  ]/g, " ").replace(/[‎‏؜]/g, "");

describe("currency catalogue", () => {
  it("uses ISO 4217 minor units, not CLDR defaults", () => {
    expect(minorUnit("INR")).toBe(2);
    expect(minorUnit("JPY")).toBe(0);
    expect(minorUnit("IQD")).toBe(3); // CLDR says 0
    expect(minorUnit("KWD")).toBe(3);
    expect(minorUnit("LBP")).toBe(2); // CLDR says 0
    expect(minorUnit("CLF")).toBe(4);
    expect(minorUnit("XAU")).toBeNull();
    expect(minorUnit("nope")).toBeNull();
    expect(currencyInfo("chf")?.payroll_allowed).toBe(true);
    expect(currencyInfo("CHE")?.payroll_allowed).toBe(false); // fund
    expect(currencyInfo("BGN")?.status).toBe("HISTORIC");
  });
});

describe("formatMoney", () => {
  afterEach(() => __setExactStringSupport(null));

  it("formats with exactly the currency's digits and locale grouping", () => {
    expect(plain(formatMoney("1234567.5", "INR", { locale: "en-IN" }))).toBe("₹12,34,567.50");
    expect(plain(formatMoney("96775.65", "INR", { locale: "en-IN" }))).toBe("₹96,775.65");
    expect(plain(formatMoney("1500", "JPY", { locale: "en-US" }))).toBe("¥1,500");
    expect(plain(formatMoney("1234.5", "IQD", { locale: "en-US", useCode: true }))).toBe("IQD 1,234.500");
    expect(plain(formatMoney("12.345", "KWD", { locale: "en-US", useCode: true }))).toBe("KWD 12.345");
  });

  it("keeps every digit of very large amounts (string input, no double rounding)", () => {
    expect(supportsExactStringFormatting()).toBe(true);
    expect(plain(formatMoney("12345678901234567.89", "INR", { locale: "en-IN" }))).toBe("₹12,34,56,78,90,12,34,567.89");
  });

  it("formats exactly through the BigInt fallback when Intl would round strings", () => {
    __setExactStringSupport(false);
    expect(plain(formatMoney("12345678901234567.89", "INR", { locale: "en-IN" }))).toBe("₹12,34,56,78,90,12,34,567.89");
    expect(plain(formatMoney("-0.5", "USD", { locale: "en-US" }))).toBe("-$0.50");
    expect(plain(formatMoney("1234.5", "IQD", { locale: "en-US", useCode: true }))).toBe("IQD 1,234.500");
    expect(plain(formatMoney("1500", "JPY", { locale: "en-US" }))).toBe("¥1,500");
    expect(plain(formatMoney("2.005", "USD", { locale: "en-US" }))).toBe("$2.01");
  });

  it("shows negatives with a minus sign and never a negative zero", () => {
    expect(plain(formatMoney("-1234.5", "USD", { locale: "en-US" }))).toBe("-$1,234.50");
    expect(plain(formatMoney("-0.00", "USD", { locale: "en-US" }))).toBe("$0.00");
    expect(plain(formatMoney("+12", "USD", { locale: "en-US" }))).toBe("$12.00");
    expect(plain(formatMoney("12", "USD", { locale: "en-US", signDisplay: "always" }))).toBe("+$12.00");
  });

  it("uses ISO codes on request and compact notation only when asked", () => {
    expect(plain(formatMoney("1234.5", "USD", { locale: "en-US", useCode: true }))).toBe("USD 1,234.50");
    expect(plain(formatMoney("41200000.00", "INR", { locale: "en-IN", compact: true }))).toBe("₹4.12Cr");
    expect(plain(formatMoney("1300000", "USD", { locale: "en-US", compact: true }))).toBe("$1.3M");
  });

  it("uses Latin digits by default, native digits on request", () => {
    expect(plain(formatMoney("1234.5", "AED", { locale: "ar-AE" }))).toMatch(/1,234\.50/);
    expect(plain(formatMoney("1234.5", "AED", { locale: "ar" }))).toMatch(/1,234\.50/);
    expect(formatMoney("1234.5", "AED", { locale: "ar", numberingSystem: "arab" })).toMatch(/[٠-٩]/);
  });

  it("never hides a bad value and copes with unknown or non-monetary codes", () => {
    expect(formatMoney("12,5", "USD")).toBe("12,5");
    expect(formatMoney("abc", "USD")).toBe("abc");
    expect(plain(formatMoney("1.5", "XAU", { locale: "en-US", useCode: true }))).toBe("XAU 1.5");
    expect(plain(formatMoney("1.50", "bad!", { locale: "en-US" }))).toBe("1.50 BAD!");
    expect(formatMoneyDto(null)).toBe("—");
    expect(plain(formatMoneyDto({ amount: "5", currency: "EUR" }, { locale: "en-US" }))).toBe("€5.00");
  });
});

describe("decimal string helpers", () => {
  it("recognises decimal strings", () => {
    expect(isDecimalString("12.30")).toBe(true);
    expect(isDecimalString("-.5")).toBe(true);
    expect(isDecimalString("1e5")).toBe(false);
    expect(isDecimalString("1,000")).toBe(false);
    expect(isDecimalString(12)).toBe(false);
    expect(isNegative("-0.01")).toBe(true);
    expect(isNegative("-0.00")).toBe(false);
  });

  it("compares exactly", () => {
    expect(compareDecimalStrings("10.10", "10.1")).toBe(0);
    expect(compareDecimalStrings("9007199254740993", "9007199254740992")).toBe(1);
    expect(compareDecimalStrings("-1", "0.5")).toBe(-1);
    expect(compareDecimalStrings("-0.00", "0")).toBe(0);
    expect(() => compareDecimalStrings("1e2", "1")).toThrow();
  });

  it("sums exactly (display previews only)", () => {
    expect(sumDecimalStrings(["0.1", "0.2"])).toBe("0.3");
    expect(sumDecimalStrings(["9007199254740993.01", "1.99"])).toBe("9007199254740995.00");
    expect(sumDecimalStrings(["-5.25", "2"])).toBe("-3.25");
    expect(sumDecimalStrings([])).toBe("0");
  });

  it("rounds half away from zero", () => {
    expect(roundDecimalString("2.005", 2)).toBe("2.01");
    expect(roundDecimalString("-2.005", 2)).toBe("-2.01");
    expect(roundDecimalString("2.004", 2)).toBe("2.00");
    expect(roundDecimalString("7", 3)).toBe("7.000");
    expect(roundDecimalString("0.5", 0)).toBe("1");
  });

  it("needs ISO codes only when several currencies are visible", () => {
    expect(needsIsoCodes(["INR", "inr", null])).toBe(false);
    expect(needsIsoCodes(["INR", "AED"])).toBe(true);
    expect(needsIsoCodes([])).toBe(false);
  });
});

describe("parseMoneyInput", () => {
  it("returns exact strings padded to the minor unit", () => {
    expect(parseMoneyInput("1,25,000.5", "INR", { locale: "en-IN" })).toEqual({ ok: true, amount: "125000.50" });
    expect(parseMoneyInput(" 1500 ", "JPY", { locale: "en-US" })).toEqual({ ok: true, amount: "1500" });
    expect(parseMoneyInput("12.3", "KWD", { locale: "en-US" })).toEqual({ ok: true, amount: "12.300" });
    expect(parseMoneyInput("1.234,5", "EUR", { locale: "de-DE" })).toEqual({ ok: true, amount: "1234.50" });
    expect(parseMoneyInput("١٬٢٣٤٫٥", "AED", { locale: "ar" })).toEqual({ ok: true, amount: "1234.50" });
    expect(parseMoneyInput("10.50", "JPY", { locale: "en-US" })).toMatchObject({ ok: false, error: "TOO_MANY_DIGITS" });
    expect(parseMoneyInput("10.00", "JPY", { locale: "en-US" })).toEqual({ ok: true, amount: "10" });
  });

  it("rejects empty, invalid, negative and non-money input", () => {
    expect(parseMoneyInput("", "INR")).toMatchObject({ ok: false, error: "EMPTY" });
    expect(parseMoneyInput("12abc", "INR", { locale: "en-US" })).toMatchObject({ ok: false, error: "INVALID" });
    expect(parseMoneyInput("−5", "INR", { locale: "en-US" })).toMatchObject({ ok: false, error: "NEGATIVE" });
    expect(parseMoneyInput("−5", "INR", { locale: "en-US", allowNegative: true })).toEqual({ ok: true, amount: "-5.00" });
    expect(parseMoneyInput("1.123", "INR", { locale: "en-US" })).toMatchObject({ ok: false, error: "TOO_MANY_DIGITS" });
    expect(parseMoneyInput("1", "XAU")).toMatchObject({ ok: false, error: "NOT_MONEY" });
  });
});

describe("fmtMoney (legacy wrapper)", () => {
  it("shows exact minor-unit digits instead of whole units", () => {
    expect(plain(fmtMoney(96775.65, "INR"))).toBe("₹96,775.65");
    expect(plain(fmtMoney(42500))).toBe("₹42,500.00");
    expect(plain(fmtMoney(9500, "AED"))).toBe("AED 9,500.00");
    expect(plain(fmtMoney(1500, "JPY"))).toBe("¥1,500");
    expect(plain(fmtMoney("12.5", "USD"))).toBe("$12.50");
  });

  it("keeps its call signature for legacy callers", () => {
    expect(fmtMoney(null)).toBe("—");
    expect(fmtMoney(undefined, "USD")).toBe("—");
    expect(fmtMoney(Number.NaN)).toBe("—");
    expect(plain(fmtMoney(-0, "USD"))).toBe("$0.00");
    expect(plain(fmtMoney(1234.5678, "USD"))).toBe("$1,234.57");
    expect(plain(fmtMoney(1e21, "USD"))).toBe("$1,000,000,000,000,000,000,000.00");
  });
});
