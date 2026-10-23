import { appendEvidence } from "./support";

/** A DB numeric (e.g. "100604.8400") as a 2-decimal string ("100604.84"); exact string arithmetic, no floats. */
export function money(value: string | number | null | undefined, places = 2): string {
  if (value === null || value === undefined) return "null";
  const s = String(value);
  const neg = s.startsWith("-");
  const [int, frac = ""] = (neg ? s.slice(1) : s).split(".");
  const kept = (frac + "0".repeat(places)).slice(0, places);
  const rest = frac.slice(places).replace(/0+$/, "");
  if (rest) throw new Error(`money(${s}) has more than ${places} significant decimals`);
  return `${neg ? "-" : ""}${int}${places ? "." + kept : ""}`;
}

/** Text without grouping separators (so "₹1,00,604.84" and "100,604.84" both contain "100604.84"). */
export function digits(text: string): string {
  return text.replace(/(\d)[,  ٬](?=\d)/g, "$1");
}

/** One row of the financial verification table (evidence pack C). */
export function financialRow(row: { company: string; run: number; employee: string; check: string; expected: string; actual: string; [k: string]: unknown }) {
  appendEvidence("C-financial-verification.json", { ...row, match: row.expected === row.actual });
}
