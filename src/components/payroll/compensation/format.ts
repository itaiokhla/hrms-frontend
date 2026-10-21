/** Plain-language labels for compensation codes (3.8 §12: copy is plain; jargon gets a glossary). */

import { isDecimalString, parseMoneyInput, type Money } from "@/lib/money";

function humanize(code: string | null | undefined): string {
  if (!code) return "—";
  const text = code.replace(/[_-]+/g, " ").trim().toLowerCase();
  return text ? text[0].toUpperCase() + text.slice(1) : "—";
}

export const KIND_LABEL: Record<string, string> = {
  EARNING: "Earning",
  DEDUCTION: "Deduction",
  EMPLOYER_CONTRIBUTION: "Employer contribution",
  REIMBURSEMENT: "Reimbursement",
  BENEFIT_IN_KIND: "Benefit in kind",
  INFORMATIONAL: "Informational",
  ROUNDING: "Rounding",
};

export const METHOD_LABEL: Record<string, string> = {
  FIXED: "Fixed amount",
  PERCENT_OF: "% of other components",
  FORMULA: "Formula",
  RATE_X_UNITS: "Rate × units",
  SLAB: "Slab table",
  INPUT: "Wage input",
  BALANCING: "Balancing (rest of pay basis)",
  SYSTEM: "System (country pack)",
};

export const STRUCTURE_TYPE_LABEL: Record<string, string> = {
  CTC_BASED: "CTC based (annual cost to company)",
  GROSS_BASED: "Gross based (monthly gross)",
  NET_BASED: "Net based (take-home)",
  HOURLY: "Hourly rate",
  DAILY: "Daily rate",
  TASK_BASED: "Task based",
};

export const PAY_BASIS_LABEL: Record<string, string> = {
  CTC_BASED: "Annual CTC",
  GROSS_BASED: "Monthly gross",
  NET_BASED: "Monthly net",
  HOURLY: "Hourly rate",
  DAILY: "Daily rate",
  TASK_BASED: "Rate",
};

export const REASON_LABEL: Record<string, string> = {
  HIRE: "New hire",
  REVISION: "Revision",
  PROMOTION: "Promotion",
  TRANSFER: "Transfer",
  CORRECTION: "Correction",
  MIGRATED: "Migrated",
};

export const CYCLE_METHOD_LABEL: Record<string, string> = {
  PERCENT: "Same % for everyone",
  FIXED_AMOUNT: "Fixed amount per currency",
  PER_ROW: "Amount per employee",
  MATRIX: "Grade × rating matrix",
};

export const CYCLE_STATUS: Record<string, { label: string; tone: "neutral" | "info" | "warning" | "success" | "danger"; glossary: string }> = {
  DRAFT: { label: "Draft", tone: "neutral", glossary: "Being prepared. Nothing changes for anyone yet." },
  PREVIEWED: { label: "Previewed", tone: "info", glossary: "New amounts calculated; not yet sent for approval." },
  PENDING_APPROVAL: { label: "Awaiting approval", tone: "warning", glossary: "Waiting for an approver. Salaries have not changed." },
  APPROVED: { label: "Approved", tone: "info", glossary: "Approved; apply it to put the new salaries in force." },
  APPLIED: { label: "Applied", tone: "success", glossary: "New salaries are in force from the effective date." },
  REJECTED: { label: "Rejected", tone: "danger", glossary: "Rejected by an approver. Salaries did not change." },
  CANCELLED: { label: "Cancelled", tone: "neutral", glossary: "Withdrawn. Salaries did not change." },
};

export const ITEM_STATUS: Record<string, { label: string; tone: "neutral" | "info" | "warning" | "success" | "danger" }> = {
  PROPOSED: { label: "Proposed", tone: "info" },
  EXCLUDED: { label: "Excluded", tone: "neutral" },
  APPLIED: { label: "Applied", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
};

export const GRADE_POSITION: Record<string, { label: string; tone: "neutral" | "success" | "warning" }> = {
  IN_RANGE: { label: "In range", tone: "success" },
  BELOW: { label: "Below range", tone: "warning" },
  ABOVE: { label: "Above range", tone: "warning" },
  NO_RANGE: { label: "No grade range", tone: "neutral" },
  NOT_COMPARABLE: { label: "Not comparable", tone: "neutral" },
};

export const TOTAL_LABEL: Record<string, string> = {
  gross: "Gross",
  deductions: "Deductions",
  employer_contributions: "Employer contributions",
  reimbursements: "Reimbursements",
  ctc: "Cost to company",
  net_estimate: "Net (estimate, before tax)",
};

export const kindLabel = (k: string | null | undefined) => (k ? KIND_LABEL[k] ?? humanize(k) : "—");
export const methodLabel = (m: string | null | undefined) => (m ? METHOD_LABEL[m] ?? humanize(m) : "Component default");
export const structureTypeLabel = (t: string | null | undefined) => (t ? STRUCTURE_TYPE_LABEL[t] ?? humanize(t) : "—");
export const payBasisLabel = (t: string | null | undefined) => (t ? PAY_BASIS_LABEL[t] ?? "Pay basis" : "Pay basis");
export { humanize };

/** Pack hints for well-known tags. No API lists pack tag requirements yet, so these mirror the
 *  backend packs and say where they come from (the IN pack is a FIXTURE, not law). */
export const TAG_HINTS: Record<string, string> = {
  PART_OF_CTC: "Counted in CTC; the balancing line fills the rest of the pay basis.",
  LOP_APPLICABLE: "Reduced for loss-of-pay days.",
  TAXABLE_INCOME: "Counted in taxable income by the country pack.",
  IN_PF_WAGE: "Required for IN PF wage (IN pack — FIXTURE, not law).",
  IN_ESI_WAGE: "Counted in the IN ESI wage (IN pack — FIXTURE, not law).",
};

/** A Money DTO from a typed amount, or null with the parse error. */
export function moneyFromInput(text: string, currency: string): { money: Money | null; error: string | null } {
  if (!text.trim()) return { money: null, error: "Enter an amount." };
  const parsed = parseMoneyInput(text, currency);
  if (!parsed.ok) return { money: null, error: parsed.message };
  return { money: { amount: parsed.amount, currency }, error: null };
}

/** A plain decimal (percent, bounds) typed by a person: trims and checks it, never converts to a number. */
export function decimalFromInput(text: string, { allowNegative = false } = {}): { value: string | null; error: string | null } {
  const raw = text.trim().replace(/[−–]/g, "-").replace(/,/g, "");
  if (!raw) return { value: null, error: null };
  if (!isDecimalString(raw)) return { value: null, error: "Enter a number, for example 12.5." };
  if (!allowNegative && raw.startsWith("-")) return { value: null, error: "Can't be negative." };
  return { value: raw, error: null };
}

/** "12.50" -> "12.5%" (display only; the server sends the percent as a decimal string). */
export function percentText(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return `${value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")}%`;
}

export function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Text of an explanation from the engine trace (string, or a dict with text/explanation). */
export function explanationText(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    for (const key of ["text", "explanation", "summary", "message"]) if (typeof v[key] === "string") return v[key] as string;
  }
  return null;
}

/** Formula of an explanation dict, when the engine gives one. */
export function explanationFormula(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  for (const key of ["formula", "expression"]) if (typeof v[key] === "string") return v[key] as string;
  return null;
}
