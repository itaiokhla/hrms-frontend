/** Form model of the component editor and its mapping to the API payload (ComponentIn / ComponentVersionIn). */

import { PayrollApiError } from "@/lib/payroll/api";

import type { FormulaIssue, PayComponent } from "./types";

export interface ComponentDraft {
  code: string;
  kind: string;
  category: string;
  name: string;
  description: string;
  calc_method: string;
  formula: string;
  /** FIXED */
  basis: "MONTHLY" | "ANNUAL";
  /** PERCENT_OF */
  percent: string;
  bases: string[];
  tag: string;
  /** RATE_X_UNITS */
  rate: string;
  units: string;
  /** SLAB */
  table: string;
  slab_base: string;
  progressive: boolean;
  /** INPUT */
  input_code: string;
  allow_negative_input: boolean;
  /** BALANCING */
  others: string[];
  total: string;
  eligibility: string;
  proration: string;
  /** "" = use the payroll setting (payroll.lop.proration_basis). */
  proration_basis: string;
  frequency: string;
  months: number[];
  rounding: string;
  tags: string[];
  visibility: string;
  payslip_group: string;
  payslip_order: string;
  show_if_zero: boolean;
  show_rate_column: boolean;
  label_override: string;
  debit_account: string;
  credit_account: string;
  allocate_by_cost_center: boolean;
  effective_from: string;
  reason: string;
}

export function emptyDraft(): ComponentDraft {
  return {
    code: "", kind: "EARNING", category: "FIXED_ALLOWANCE", name: "", description: "", calc_method: "FIXED", formula: "",
    basis: "MONTHLY", percent: "", bases: [], tag: "", rate: "", units: "", table: "", slab_base: "", progressive: true,
    input_code: "", allow_negative_input: false, others: [], total: "", eligibility: "", proration: "BY_PAID_DAYS",
    proration_basis: "", frequency: "EVERY_PERIOD", months: [], rounding: "", tags: [], visibility: "EMPLOYEE_VISIBLE",
    payslip_group: "", payslip_order: "", show_if_zero: false, show_rate_column: false, label_override: "",
    debit_account: "", credit_account: "", allocate_by_cost_center: false, effective_from: "", reason: "",
  };
}

const str = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function draftFrom(component: PayComponent): ComponentDraft {
  const v = component.current_version;
  const p = (v?.params ?? {}) as Record<string, unknown>;
  const base = emptyDraft();
  if (!v) return { ...base, code: component.code, kind: component.kind, category: component.category, name: component.name };
  return {
    ...base,
    code: component.code,
    kind: component.kind,
    category: component.category,
    name: v.name,
    description: v.description ?? "",
    calc_method: v.calc_method,
    formula: v.formula ?? "",
    basis: p.basis === "ANNUAL" ? "ANNUAL" : "MONTHLY",
    percent: str(p.percent),
    bases: list(p.bases),
    tag: str(p.tag),
    rate: str(p.rate),
    units: str(p.units),
    table: str(p.table),
    slab_base: str(p.base),
    progressive: p.progressive !== false,
    input_code: str(p.code),
    allow_negative_input: p.allow_negative_input === true,
    others: list(p.others),
    total: str(p.total),
    eligibility: v.eligibility ?? "",
    proration: v.proration ?? "NONE",
    proration_basis: v.proration_basis ?? "",
    frequency: v.frequency?.type ?? "EVERY_PERIOD",
    months: v.frequency?.months ?? [],
    rounding: v.rounding ?? "",
    tags: [...(v.tags ?? [])],
    visibility: v.visibility ?? "EMPLOYEE_VISIBLE",
    payslip_group: str(v.payslip?.group),
    payslip_order: v.payslip?.order === undefined || v.payslip?.order === null ? "" : String(v.payslip.order),
    show_if_zero: !!v.payslip?.show_if_zero,
    show_rate_column: !!v.payslip?.show_rate_column,
    label_override: str(v.payslip?.label_override),
    debit_account: str(v.gl?.debit_account),
    credit_account: str(v.gl?.credit_account),
    allocate_by_cost_center: !!v.gl?.allocate_by_cost_center,
  };
}

/** The formula text the method evaluates, for the editor and the tester. */
export function formulaOf(d: ComponentDraft): string {
  return d.calc_method === "FORMULA" ? d.formula : "";
}

function params(d: ComponentDraft): Record<string, unknown> {
  const opt = (v: string) => (v.trim() ? v.trim() : undefined);
  switch (d.calc_method) {
    case "FIXED":
      return { basis: d.basis };
    case "PERCENT_OF":
      return { percent: opt(d.percent), bases: d.bases.length ? d.bases : undefined, tag: opt(d.tag) };
    case "RATE_X_UNITS":
      return { rate: opt(d.rate), units: opt(d.units) };
    case "SLAB":
      return { table: opt(d.table), base: opt(d.slab_base), progressive: d.progressive };
    case "INPUT":
      return { code: opt(d.input_code), allow_negative_input: d.allow_negative_input };
    case "BALANCING":
      return { others: d.others.length ? d.others : undefined, total: opt(d.total) };
    default:
      return {};
  }
}

const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** Client checks before the server's (the server stays the authority). */
export function validateDraft(d: ComponentDraft, isNew: boolean): Record<string, string> {
  const e: Record<string, string> = {};
  if (isNew && !/^[A-Z][A-Z0-9_]{0,39}$/.test(d.code)) e.code = "Use UPPER_SNAKE: a capital letter, then capitals, digits or _ (max 40).";
  if (!d.name.trim()) e.name = "Enter a name.";
  if (d.calc_method === "FORMULA" && !d.formula.trim()) e.formula = "Enter a formula.";
  if (d.calc_method === "PERCENT_OF") {
    if (!d.percent.trim()) e.percent = "Enter a percentage.";
    else if (!/^\d+(\.\d+)?$/.test(d.percent.trim())) e.percent = "Enter a number such as 40 or 12.5.";
    if (!d.bases.length && !d.tag.trim()) e.bases = "Choose the components it is a percentage of, or a tag.";
  }
  if (d.calc_method === "RATE_X_UNITS" && (!d.rate.trim() || !d.units.trim())) e.rate = "Enter both the rate and the units.";
  if (d.calc_method === "SLAB" && (!d.table.trim() || !d.slab_base.trim())) e.table = "Enter the table code and the base.";
  if (d.frequency === "SPECIFIC_MONTHS" && !d.months.length) e.months = "Choose at least one month.";
  if (d.payslip_order.trim() && !/^\d+$/.test(d.payslip_order.trim())) e.payslip_order = "A whole number.";
  for (const t of d.tags) if (!/^[A-Z][A-Z0-9_]{0,39}$/.test(t)) e.tags = `Tag ${t} must be UPPER_SNAKE.`;
  if (!isNew && d.effective_from && d.effective_from < new Date().toISOString().slice(0, 10) && !d.reason.trim()) e.reason = "A version effective in the past needs a reason.";
  return e;
}

/** Body of POST /components (new) or POST /components/{code}/versions (existing). Tax fields stay with the pack. */
export function payloadOf(d: ComponentDraft, isNew: boolean): Record<string, unknown> {
  const payslip = clean({
    group: d.payslip_group.trim() || undefined,
    order: d.payslip_order.trim() ? Number.parseInt(d.payslip_order, 10) : undefined,
    show_if_zero: d.show_if_zero,
    show_rate_column: d.show_rate_column,
    label_override: d.label_override.trim() || undefined,
  });
  const gl = clean({ debit_account: d.debit_account.trim() || undefined, credit_account: d.credit_account.trim() || undefined, allocate_by_cost_center: d.allocate_by_cost_center });
  const body: Record<string, unknown> = {
    name: d.name.trim(),
    description: d.description.trim() || null,
    calc_method: d.calc_method,
    formula: d.calc_method === "FORMULA" ? d.formula : null,
    params: clean(params(d)),
    tags: d.tags,
    proration: d.proration,
    proration_basis: d.proration_basis || null,
    frequency: d.frequency === "SPECIFIC_MONTHS" ? { type: d.frequency, months: d.months } : { type: d.frequency },
    rounding: d.rounding || null,
    eligibility: d.eligibility.trim() || null,
    payslip,
    visibility: d.visibility,
    gl: Object.keys(gl).length ? gl : null,
  };
  if (isNew) return { code: d.code, kind: d.kind, category: d.category, ...body, effective_from: d.effective_from || undefined };
  return { ...body, effective_from: d.effective_from || undefined, reason: d.reason.trim() || undefined };
}

export interface SaveErrors {
  fields: Record<string, string>;
  formula: FormulaIssue[];
  message: string | null;
}

/** Map a 400/422 body from the component services onto fields (3.8 §8: server errors mapped to fields). */
export function saveErrorsOf(error: unknown): SaveErrors {
  const out: SaveErrors = { fields: {}, formula: [], message: null };
  if (!(error instanceof PayrollApiError)) {
    out.message = error instanceof Error ? error.message : "Could not save.";
    return out;
  }
  out.message = error.message;
  if (error.fields?.length) for (const f of error.fields) out.fields[f.field.split(".").pop() ?? f.field] = f.msg;
  const detail = error.detail && typeof error.detail === "object" && !Array.isArray(error.detail) ? (error.detail as Record<string, unknown>) : null;
  if (detail) {
    const field = typeof detail.field === "string" ? detail.field : null;
    const issues = Array.isArray(detail.errors) ? (detail.errors as FormulaIssue[]) : [];
    if (field === "formula" || field === "params" || field === "eligibility" || issues.length) out.formula = issues.length ? issues : [{ code: error.code ?? "INVALID", message: error.message }];
    else if (field) out.fields[field.split(".")[0]] = error.message;
  }
  return out;
}
