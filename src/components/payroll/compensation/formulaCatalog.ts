/**
 * Formula language vocabulary for the editor's autocomplete and highlighting.
 *
 * Components come from the API (GET /payroll/components). The backend has no endpoint that lists
 * formula functions, variables or tables yet, so functions and variables mirror
 * hrms-backend/app/payroll/formula/{functions,variables}.py (the language grammar, not tenant data);
 * the server's validate-formula check stays the authority on what is valid. Tables are not listed
 * (no endpoint): names typed inside SLAB/BAND/LOOKUP are checked by validate-formula only.
 */

export interface FunctionInfo {
  name: string;
  group: string;
  signature: string;
  description: string;
}

export interface VariableInfo {
  name: string;
  type: string;
  description: string;
  /** Country packs only (EC-CMP-19): never offered for company formulas. */
  protected?: boolean;
}

const f = (name: string, group: string, signature: string, description: string): FunctionInfo => ({ name, group, signature, description });

export const FUNCTIONS: FunctionInfo[] = [
  f("MIN", "Math", "MIN(a, b, …)", "Smallest value"),
  f("MAX", "Math", "MAX(a, b, …)", "Largest value"),
  f("ABS", "Math", "ABS(x)", "Absolute value"),
  f("ROUND", "Math", "ROUND(x, places[, mode])", "Round to places decimals (default HALF_UP)"),
  f("ROUNDUP", "Math", "ROUNDUP(x, places)", "Round away from zero"),
  f("ROUNDDOWN", "Math", "ROUNDDOWN(x, places)", "Round toward zero"),
  f("FLOOR", "Math", "FLOOR(x, step)", "Multiple of step at or below x"),
  f("CEIL", "Math", "CEIL(x, step)", "Multiple of step at or above x"),
  f("CLAMP", "Math", "CLAMP(x, lo, hi)", "x limited to the range lo..hi"),
  f("DIVIDE", "Math", "DIVIDE(a, b, fallback)", "a / b, or fallback when b is zero"),
  f("IF", "Logic", "IF(cond, then, else)", "then when cond is TRUE, else otherwise"),
  f("SWITCH", "Logic", "SWITCH(x, k1, v1, …, default)", "Value of the first key equal to x"),
  f("IN", "Logic", "IN(x, v1, v2, …)", "TRUE when x equals one of the values"),
  f("COALESCE", "Logic", "COALESCE(a, b, …)", "First value that is not NULL"),
  f("SUM_TAG", "Components", 'SUM_TAG("TAG")', "Current-run amounts of the components with the tag, after proration"),
  f("SUM_TAG_RATE", "Components", 'SUM_TAG_RATE("TAG")', "Full-period rates of the components with the tag, before proration"),
  f("RATE", "Components", 'RATE("CODE")', "Full-period rate of a component, before proration"),
  f("PRORATE", "Components", "PRORATE(x)", "x prorated by the current component's proration"),
  f("INPUT", "Components", 'INPUT("CODE")', "Approved wage-input amount for the period (0 when none)"),
  f("UNITS", "Components", 'UNITS("CODE")', "Approved wage-input units for the period (0 when none)"),
  f("PREV", "Components", 'PREV("CODE")', "Amount in the last finalized period (0 when none)"),
  f("YTD", "Components", 'YTD("CODE")', "Tax-year-to-date amount (0 when none)"),
  f("SLAB", "Tables", 'SLAB("TABLE", x)', "Progressive amount from a SLAB table"),
  f("BAND", "Tables", 'BAND("TABLE", x)', "Flat value of the band containing x"),
  f("LOOKUP", "Tables", 'LOOKUP("TABLE", key, default)', "Value for key, or default when absent"),
  f("DATE", "Dates", "DATE(y, m, d)", "A date"),
  f("YEAR", "Dates", "YEAR(d)", "Year of a date"),
  f("MONTH", "Dates", "MONTH(d)", "Month of a date (1–12)"),
  f("DAYS_BETWEEN", "Dates", "DAYS_BETWEEN(d1, d2)", "d2 − d1 in days"),
  f("MONTHS_BETWEEN", "Dates", "MONTHS_BETWEEN(d1, d2)", "Completed months from d1 to d2"),
  f("YEARS_BETWEEN", "Dates", "YEARS_BETWEEN(d1, d2)", "Completed years from d1 to d2"),
];

export const KEYWORDS = ["AND", "OR", "NOT", "TRUE", "FALSE", "NULL"];

const v = (name: string, type: string, description: string, isProtected = false): VariableInfo => ({ name, type, description, protected: isProtected || undefined });

export const VARIABLES: VariableInfo[] = [
  v("ctc.annual", "money", "Annual cost to company from the compensation assignment"),
  v("ctc.monthly", "money", "Monthly cost to company from the compensation assignment"),
  v("period.start", "date", "First day of the pay period"),
  v("period.end", "date", "Last day of the pay period"),
  v("period.days", "integer", "Calendar days in the period"),
  v("period.working_days", "decimal", "Scheduled working days in the whole period"),
  v("period.basis_days", "decimal", "Proration basis N"),
  v("period.number_in_tax_year", "integer", "Position of the period in the tax year"),
  v("period.is_last_in_tax_year", "boolean", "The last period of the tax year"),
  v("period.pay_date", "date", "Pay date of the period"),
  v("att.paid_days", "decimal", "Paid days from the day ledger"),
  v("att.lop_days", "decimal", "Loss-of-pay days, including penalty LOP"),
  v("att.present_days", "decimal", "Days present"),
  v("att.half_days", "decimal", "Half days"),
  v("att.leave_days_paid", "decimal", "Paid leave days"),
  v("att.leave_days_unpaid", "decimal", "Unpaid leave days"),
  v("att.holidays", "decimal", "Paid holidays in employment"),
  v("att.weekly_offs", "decimal", "Weekly offs in employment"),
  v("att.payable_hours", "decimal", "Worked plus paid leave and holiday hours"),
  v("att.worked_hours", "decimal", "Canonical net worked hours"),
  v("att.night_hours", "decimal", "Hours inside the night window"),
  v("att.late_marks", "integer", "Late marks"),
  v("ot.hours_workday", "decimal", "Approved overtime hours on working days"),
  v("ot.hours_weekly_off", "decimal", "Approved overtime hours on weekly offs"),
  v("ot.hours_holiday", "decimal", "Approved overtime hours on holidays"),
  v("ot.hours_total", "decimal", "All approved overtime hours"),
  v("ot.hourly_rate", "money", "Overtime base hourly rate"),
  v("task.amount", "money", "Approved task earnings attributed to the period"),
  v("task.units", "decimal", "Approved task units attributed to the period"),
  v("emp.grade", "text", "Grade code"),
  v("emp.employment_type", "text", "Employment type code"),
  v("emp.worker_class", "text", "Worker class"),
  v("emp.designation", "text", "Designation code"),
  v("emp.years_of_service", "decimal", "Years of service on the period end date"),
  v("emp.months_of_service", "decimal", "Months of service on the period end date"),
  v("emp.hire_date", "date", "Hire date"),
  v("emp.exit_date", "date", "Exit date; NULL while employed"),
  v("emp.is_joiner", "boolean", "Joined during the period"),
  v("emp.is_leaver", "boolean", "Leaves during the period"),
  v("emp.fte", "decimal", "Full-time equivalent (1 = full time)"),
  v("emp.standard_hours_per_day", "decimal", "Standard hours per day"),
  v("emp.country", "text", "ISO 3166 country of the legal entity"),
  v("emp.subdivision", "text", "ISO 3166-2 subdivision of the branch"),
];

export const FUNCTION_NAMES = new Set(FUNCTIONS.map((x) => x.name));
export const VARIABLE_NAMES = new Set(VARIABLES.map((x) => x.name));

export type TokenKind = "string" | "number" | "function" | "keyword" | "component" | "variable" | "operator" | "space" | "text";

export interface Token {
  kind: TokenKind;
  text: string;
  start: number;
}

/** A lexer for highlighting only (the server parser decides validity). */
export function tokenize(source: string, components: ReadonlySet<string>): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const start = i;
    if (/\s/.test(ch)) {
      while (i < source.length && /\s/.test(source[i])) i++;
      tokens.push({ kind: "space", text: source.slice(start, i), start });
    } else if (ch === '"' || ch === "'") {
      i++;
      while (i < source.length && source[i] !== ch) i++;
      i = Math.min(i + 1, source.length);
      tokens.push({ kind: "string", text: source.slice(start, i), start });
    } else if (/\d/.test(ch) || (ch === "." && /\d/.test(source[i + 1] ?? ""))) {
      while (i < source.length && /[\d.%]/.test(source[i])) i++;
      tokens.push({ kind: "number", text: source.slice(start, i), start });
    } else if (/[A-Za-z_]/.test(ch)) {
      while (i < source.length && /[A-Za-z0-9_.]/.test(source[i])) i++;
      const word = source.slice(start, i);
      let j = i;
      while (j < source.length && source[j] === " ") j++;
      const upper = word.toUpperCase();
      let kind: TokenKind = "text";
      if (source[j] === "(" && FUNCTION_NAMES.has(upper)) kind = "function";
      else if (KEYWORDS.includes(upper)) kind = "keyword";
      else if (components.has(word)) kind = "component";
      else if (word.includes(".")) kind = "variable";
      tokens.push({ kind, text: word, start });
    } else {
      i++;
      tokens.push({ kind: "operator", text: ch, start });
    }
  }
  return tokens;
}

export interface Suggestion {
  label: string;
  insert: string;
  kind: "component" | "function" | "variable" | "keyword";
  detail: string;
}

/** The identifier being typed before the caret, with where it starts. */
export function wordAt(source: string, caret: number): { word: string; start: number } {
  let start = caret;
  while (start > 0 && /[A-Za-z0-9_.]/.test(source[start - 1])) start--;
  return { word: source.slice(start, caret), start };
}

export function suggestions(prefix: string, components: { code: string; name: string }[], own?: string): Suggestion[] {
  if (!prefix) return [];
  const p = prefix.toLowerCase();
  const out: Suggestion[] = [];
  for (const c of components) {
    if (c.code === own) continue;
    if (c.code.toLowerCase().startsWith(p) || c.name.toLowerCase().includes(p)) out.push({ label: c.code, insert: c.code, kind: "component", detail: c.name });
  }
  for (const fn of FUNCTIONS) if (fn.name.toLowerCase().startsWith(p)) out.push({ label: fn.signature, insert: `${fn.name}(`, kind: "function", detail: fn.description });
  for (const variable of VARIABLES) if (!variable.protected && variable.name.toLowerCase().startsWith(p)) out.push({ label: variable.name, insert: variable.name, kind: "variable", detail: `${variable.type} · ${variable.description}` });
  for (const k of KEYWORDS) if (k.toLowerCase().startsWith(p) && k.length > p.length) out.push({ label: k, insert: k, kind: "keyword", detail: "Keyword" });
  return out.slice(0, 12);
}
