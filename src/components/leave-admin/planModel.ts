/**
 * The leave plan document (LEAVE_PLAN, `app/payroll/policy_types.py`) on the client: complete defaults (the same the
 * server fills in), sensible starting rules per leave type, normalization before save (conditional fields cleared,
 * empty lists turned into "not set") and a client-side mirror of the server's model validators so most problems show
 * inline before the round trip. Field paths use the server's format: `types[2].request.min_notice.value`.
 */

import type {
  Dec,
  LeaveCompOffRules,
  LeaveCycle,
  LeaveDocumentNeed,
  LeavePlanFields,
  LeaveTypeRule,
  LeaveTypeV2,
  PlanIssue,
} from "@/lib/leave/adminTypes";

/* ------------------------------------------------------------------ path helpers */

type Key = string | number;

export function splitPath(path: string): Key[] {
  return path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean)
    .map((p) => (/^\d+$/.test(p) ? Number(p) : p));
}

export function getIn(value: unknown, path: string): unknown {
  return splitPath(path).reduce<unknown>((acc, key) => (acc == null ? undefined : (acc as Record<Key, unknown>)[key]), value);
}

/** An immutable copy of `value` with `path` set (missing objects are created). */
export function setIn<T>(value: T, path: string, next: unknown): T {
  const keys = splitPath(path);
  const write = (node: unknown, index: number): unknown => {
    const key = keys[index];
    const copy: Record<Key, unknown> | unknown[] = Array.isArray(node) ? [...node] : { ...((node as object) ?? {}) };
    (copy as Record<Key, unknown>)[key] = index === keys.length - 1 ? next : write((node as Record<Key, unknown> | null)?.[key], index + 1);
    return copy;
  };
  return write(value, 0) as T;
}

/** `types[3].request.max_units` → 3 (null when the path is not inside a type rule). */
export function ruleIndexOf(field: string | null | undefined): number | null {
  const match = /^types\[(\d+)\]/.exec(field ?? "");
  return match ? Number(match[1]) : null;
}

/** The part of a path inside its type rule: `types[3].request.max_units` → `request.max_units`. */
export function rulePath(field: string | null | undefined): string {
  return (field ?? "").replace(/^types\[\d+\]\.?/, "");
}

/** Issues whose field is `path` or lies under it (`entitlement` matches `entitlement.amount`). */
export function issuesUnder(issues: PlanIssue[], path: string): PlanIssue[] {
  return issues.filter((i) => {
    const f = i.field ?? "";
    return f === path || f.startsWith(`${path}.`) || f.startsWith(`${path}[`);
  });
}

/** Issues exactly on `path`. */
export function issueAt(issues: PlanIssue[], path: string): string | undefined {
  return issues.find((i) => (i.field ?? "") === path)?.message;
}

/* ------------------------------------------------------------------ defaults (server defaults, policy_types.py) */

export function defaultCycle(): LeaveCycle {
  return { kind: "CALENDAR_YEAR", custom_start: null };
}

export function defaultCompOff(): LeaveCompOffRules {
  return {
    earn_on: ["HOLIDAY", "WEEKLY_OFF"],
    claim_window_days: 30,
    credit_slabs: [
      { min_worked_minutes: 240, units: "0.5" },
      { min_worked_minutes: 480, units: "1" },
    ],
    validity_days: 60,
    min_usable_days: 14,
    max_units_per_month: null,
  };
}

/** Every key of a type rule with the server's defaults. */
export function defaultRule(code: string): LeaveTypeRule {
  return {
    leave_type_code: code,
    frozen: false,
    keep_on_plan_exit: false,
    cycle: null,
    balance_scope: { kind: "CYCLE" },
    counting_basis: { basis: "WORKING_DAYS", weekdays: null },
    eligibility: {
      genders: null,
      unknown_gender: "ELIGIBLE_VERIFY",
      worker_classes: null,
      employment_types: null,
      countries: null,
      branch_ids: null,
      min_fte: null,
      min_tenure: null,
    },
    during_probation: "ALLOW",
    during_notice: "ALLOW",
    entitlement: {
      method: "FRONT_LOADED",
      amount: "0",
      frequency: null,
      post_at: null,
      per_days_worked: null,
      tenure_slabs: null,
      credit_expiry_months: null,
    },
    accrual_cap: null,
    max_balance: null,
    proration: { joiner: "PRORATE", leaver: "PRORATE" },
    rounding: { mode: "NONE_2DP" },
    carry_forward: { cap: "0", expiry_months: null },
    encashment: { eligible: false, triggers: [], max_units_per_cycle: null, min_balance_after: null, step: "0.5" },
    balance_check: "CURRENT",
    insufficient_balance_action: "BLOCK",
    negative_allowance: "0",
    negative_at_cycle_end: "CARRY_NEGATIVE",
    sandwich: { mode: "OFF", half_day_edges: "IGNORE" },
    request: {
      self_service: true,
      on_behalf: true,
      portions: "INHERIT",
      min_units: null,
      max_units: null,
      max_consecutive_units: null,
      caps: [],
      max_instances: [],
      min_notice: null,
      emergency_exception: null,
      backdate_limit_days: 0,
      future_limit_days: 365,
      clubbing: { not_with: [], gap_days: 0 },
      adjacent_non_working: "ALLOW",
      blackouts: "APPLY",
      coverage: "APPLY",
      reason: "OPTIONAL",
    },
    documents: { allowed: true, required: [], due: "AT_SUBMIT", due_days: null, verification: "NONE" },
    approval: { auto_approve_eligible: false },
    change: { cancellation_requires_approval: "INHERIT", recall_allowed: true },
    event: null,
  };
}

/**
 * A valid starting rule for a leave type: comp-off keeps expiring credits (LOTS) without a yearly grant, event leave
 * is granted per event, unlimited leave has no entitlement, and ordinary leave is front-loaded with the type's legacy
 * yearly quota. Statutory / protected / event leave ignores blackouts and coverage.
 */
export function ruleForType(type: Pick<LeaveTypeV2, "code" | "kind" | "is_unlimited" | "counts_non_working_days" | "annual_quota" | "absence_class" | "category">): LeaveTypeRule {
  const rule = defaultRule(type.code);
  if (type.counts_non_working_days) rule.counting_basis = { basis: "CALENDAR_DAYS", weekdays: null };
  if (type.kind === "COMP_OFF") {
    rule.balance_scope = { kind: "LOTS" };
    rule.entitlement = { ...rule.entitlement, method: "NONE" };
    rule.carry_forward = { cap: null, expiry_months: null };
  } else if (type.kind === "EVENT") {
    rule.balance_scope = { kind: "EVENT" };
    rule.entitlement = { ...rule.entitlement, method: "EVENT_GRANT" };
    rule.event = {
      event_types: ["OTHER"],
      entitlement_units: "1",
      duration_unit: "CALENDAR_DAYS",
      earliest_start_offset_days: 0,
      take_within_days: null,
      max_occurrences: null,
    };
    rule.request = { ...rule.request, blackouts: "EXEMPT", coverage: "EXEMPT" };
  } else if (type.is_unlimited) {
    rule.entitlement = { ...rule.entitlement, method: "NONE" };
  } else {
    rule.entitlement = { ...rule.entitlement, amount: String(Math.max(0, type.annual_quota || 0)) };
  }
  if (type.absence_class === "STATUTORY" || type.absence_class === "PROTECTED") {
    rule.request = { ...rule.request, blackouts: "EXEMPT", coverage: "EXEMPT" };
  }
  if (type.category === "UNPAID") rule.request = { ...rule.request, reason: "REQUIRED" };
  return rule;
}

export function emptyPlan(): LeavePlanFields {
  return { schema_version: 1, defaults: { cycle: defaultCycle() }, comp_off: null, types: [] };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Deep merge for documents: objects merge, arrays and scalars of `patch` win, `undefined` keeps the base. */
function merge<T>(base: T, patch: unknown): T {
  if (!isObject(base) || !isObject(patch)) return (patch === undefined ? base : (patch as T));
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = isObject(out[key]) && isObject(value) ? merge(out[key], value) : value === undefined ? out[key] : value;
  }
  return out as T;
}

/** A complete document from whatever the server (or a template) gave: missing keys get their defaults. */
export function hydratePlan(fields: Partial<LeavePlanFields> | null | undefined): LeavePlanFields {
  const source = fields ?? {};
  const types = Array.isArray(source.types) ? source.types : [];
  return {
    schema_version: 1,
    defaults: { cycle: merge(defaultCycle(), source.defaults?.cycle) },
    comp_off: source.comp_off ? merge(defaultCompOff(), source.comp_off) : null,
    types: types.map((rule) => merge(defaultRule(rule.leave_type_code), rule)),
  };
}

/** Add a type rule (comp-off types also get the plan's comp-off claim rules). */
export function addTypeRule(plan: LeavePlanFields, type: LeaveTypeV2): LeavePlanFields {
  if (plan.types.some((r) => r.leave_type_code === type.code)) return plan;
  return {
    ...plan,
    comp_off: type.kind === "COMP_OFF" && !plan.comp_off ? defaultCompOff() : plan.comp_off,
    types: [...plan.types, ruleForType(type)],
  };
}

export function removeTypeRule(plan: LeavePlanFields, code: string): LeavePlanFields {
  return { ...plan, types: plan.types.filter((r) => r.leave_type_code !== code) };
}

/* ------------------------------------------------------------------ normalization */

const trimDec = (value: Dec | null | undefined): Dec | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
};

const listOrNull = <T>(items: T[] | null | undefined): T[] | null => (items && items.length ? items : null);

const codeList = (items: string[] | null | undefined, upper = false): string[] | null =>
  listOrNull(
    Array.from(new Set((items ?? []).map((c) => (upper ? c.trim().toUpperCase() : c.trim())).filter(Boolean))),
  );

function normalizeCycle(cycle: LeaveCycle | null): LeaveCycle | null {
  if (!cycle) return null;
  return { kind: cycle.kind, custom_start: cycle.kind === "CUSTOM" ? (cycle.custom_start ?? "").trim() || null : null };
}

function normalizeNeed(need: LeaveDocumentNeed): LeaveDocumentNeed {
  const takesUnits = need.when === "MIN_UNITS" || need.when === "MIN_CALENDAR_DAYS";
  return { ...need, min_units: takesUnits ? trimDec(need.min_units) : null };
}

/** Clear what the chosen options do not use, so the strict server model accepts the rule. */
export function normalizeRule(rule: LeaveTypeRule): LeaveTypeRule {
  const ent = rule.entitlement;
  const method = ent.method;
  const elig = rule.eligibility;
  const req = rule.request;
  const docs = rule.documents;
  return {
    ...rule,
    cycle: normalizeCycle(rule.cycle),
    counting_basis: {
      basis: rule.counting_basis.basis,
      weekdays:
        rule.counting_basis.basis === "FIXED_WEEKDAYS"
          ? Array.from(new Set(rule.counting_basis.weekdays ?? [])).sort((a, b) => a - b)
          : null,
    },
    eligibility: {
      ...elig,
      genders: listOrNull(elig.genders),
      worker_classes: listOrNull(elig.worker_classes),
      employment_types: codeList(elig.employment_types),
      countries: codeList(elig.countries, true),
      branch_ids: listOrNull(elig.branch_ids),
      min_fte: trimDec(elig.min_fte),
      min_tenure: elig.min_tenure,
    },
    entitlement: {
      ...ent,
      amount: (ent.amount ?? "").toString().trim(),
      frequency: method === "PERIODIC" ? ent.frequency ?? "MONTHLY" : null,
      post_at: method === "PERIODIC" ? ent.post_at ?? "END" : null,
      per_days_worked: method === "PER_DAYS_WORKED" ? ent.per_days_worked : null,
      tenure_slabs:
        method === "TENURE_SLABS"
          ? [...(ent.tenure_slabs ?? [])].map((s) => ({ ...s, amount: s.amount.trim() })).sort((a, b) => a.from_months - b.from_months)
          : null,
      credit_expiry_months: ent.credit_expiry_months,
    },
    accrual_cap: trimDec(rule.accrual_cap),
    max_balance: trimDec(rule.max_balance),
    carry_forward: { cap: trimDec(rule.carry_forward.cap), expiry_months: rule.carry_forward.expiry_months },
    encashment: {
      ...rule.encashment,
      triggers: rule.encashment.eligible ? rule.encashment.triggers : [],
      max_units_per_cycle: trimDec(rule.encashment.max_units_per_cycle),
      min_balance_after: trimDec(rule.encashment.min_balance_after),
      step: (rule.encashment.step ?? "").toString().trim(),
    },
    negative_allowance:
      rule.insufficient_balance_action === "ALLOW_NEGATIVE" ? (rule.negative_allowance ?? "").toString().trim() : "0",
    request: {
      ...req,
      min_units: trimDec(req.min_units),
      max_units: trimDec(req.max_units),
      max_consecutive_units: trimDec(req.max_consecutive_units),
      caps: req.caps.map((c) => ({ ...c, max_units: c.max_units.trim() })),
      min_notice: req.min_notice
        ? { ...req.min_notice, scale: req.min_notice.scale.map((s) => ({ ...s, min_units: s.min_units.trim() })) }
        : null,
      emergency_exception: req.emergency_exception
        ? { ...req.emergency_exception, max_units: req.emergency_exception.max_units.trim() }
        : null,
      clubbing: { not_with: Array.from(new Set(req.clubbing.not_with)), gap_days: req.clubbing.gap_days },
    },
    documents: {
      ...docs,
      required: docs.required.map(normalizeNeed),
      due_days: docs.due.startsWith("WITHIN_DAYS") ? docs.due_days : null,
    },
    event: rule.event ? { ...rule.event, entitlement_units: rule.event.entitlement_units.trim() } : null,
  };
}

export function normalizePlan(plan: LeavePlanFields): LeavePlanFields {
  return {
    schema_version: 1,
    defaults: { cycle: normalizeCycle(plan.defaults.cycle) ?? defaultCycle() },
    comp_off: plan.comp_off
      ? {
          ...plan.comp_off,
          credit_slabs: plan.comp_off.credit_slabs.map((s) => ({ ...s, units: s.units.trim() })),
          max_units_per_month: trimDec(plan.comp_off.max_units_per_month),
        }
      : null,
    types: plan.types.map(normalizeRule),
  };
}

/* ------------------------------------------------------------------ validation (mirror of the server models) */

const DECIMAL_RE = /^\d+(\.\d+)?$/;
const MONTH_DAY_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;

function places(text: string): number {
  const dot = text.indexOf(".");
  return dot < 0 ? 0 : text.length - dot - 1;
}

interface DecRule {
  min?: number;
  max: number;
  exclusiveMin?: boolean;
  places: number;
}
const UNITS: DecRule = { min: 0, max: 8784, places: 2 };
const POSITIVE: DecRule = { min: 0, max: 8784, exclusiveMin: true, places: 2 };
const STEP: DecRule = { min: 0.01, max: 1, places: 2 };
const FTE: DecRule = { min: 0, max: 1, exclusiveMin: true, places: 4 };

/** The message for a bad decimal string, or undefined when it is fine. */
export function decimalProblem(value: unknown, rule: DecRule): string | undefined {
  if (typeof value !== "string" || !DECIMAL_RE.test(value.trim())) return "Enter a number such as 1.5.";
  const text = value.trim();
  const n = Number(text);
  if (places(text) > rule.places) return `Use at most ${rule.places} decimal places.`;
  if (rule.min !== undefined && (rule.exclusiveMin ? n <= rule.min : n < rule.min))
    return rule.exclusiveMin ? `Must be greater than ${rule.min}.` : `Must be at least ${rule.min}.`;
  if (n > rule.max) return `Must be at most ${rule.max}.`;
  return undefined;
}

function intProblem(value: unknown, min: number, max: number): string | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) return "Enter a whole number.";
  if (value < min || value > max) return `Must be between ${min} and ${max}.`;
  return undefined;
}

/**
 * Problems of a (normalized) plan, with server-style paths. `types` (the tenant's catalogue) adds the reference
 * checks of `leave_plans.reference_problems` that the client can see: unknown codes, comp-off / event shapes.
 */
export function validatePlan(plan: LeavePlanFields, types?: LeaveTypeV2[]): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const add = (field: string, message: string) => issues.push({ field, message, severity: "ERROR", code: "INVALID_FIELDS" });
  const dec = (field: string, value: unknown, rule: DecRule, nullable = false) => {
    if (nullable && (value === null || value === undefined)) return;
    const problem = decimalProblem(value, rule);
    if (problem) add(field, problem);
  };
  const int = (field: string, value: unknown, min: number, max: number, nullable = false) => {
    if (nullable && (value === null || value === undefined)) return;
    const problem = intProblem(value, min, max);
    if (problem) add(field, problem);
  };
  const cycle = (field: string, value: LeaveCycle | null) => {
    if (!value) return;
    if (value.kind === "CUSTOM") {
      if (!value.custom_start || !MONTH_DAY_RE.test(value.custom_start)) add(`${field}.custom_start`, "Enter the first day as MM-DD, e.g. 04-01.");
      else if (value.custom_start === "02-29") add(`${field}.custom_start`, "A leave year cannot start on 29 February.");
    }
  };

  cycle("defaults.cycle", plan.defaults.cycle);
  if (plan.types.length > 60) add("types", "A plan has at most 60 leave types.");
  const codes = plan.types.map((t) => t.leave_type_code);
  if (new Set(codes).size !== codes.length) add("types", "Each leave type appears once in a plan.");

  const byCode = new Map((types ?? []).map((t) => [t.code, t]));
  let compOffs = 0;

  plan.types.forEach((rule, i) => {
    const p = `types[${i}]`;
    cycle(`${p}.cycle`, rule.cycle);
    if (rule.counting_basis.basis === "FIXED_WEEKDAYS" && !(rule.counting_basis.weekdays ?? []).length)
      add(`${p}.counting_basis.weekdays`, "Choose the weekdays that are charged.");

    const e = rule.eligibility;
    if (e.min_fte !== null) dec(`${p}.eligibility.min_fte`, e.min_fte, FTE);
    if (e.min_tenure) int(`${p}.eligibility.min_tenure.value`, e.min_tenure.value, 1, 600);

    const ent = rule.entitlement;
    dec(`${p}.entitlement.amount`, ent.amount, UNITS);
    if (ent.method === "PERIODIC" && (!ent.frequency || !ent.post_at)) add(`${p}.entitlement.frequency`, "Choose how often and when units are credited.");
    if (ent.method === "PER_DAYS_WORKED") int(`${p}.entitlement.per_days_worked`, ent.per_days_worked, 1, 365);
    if (ent.method === "TENURE_SLABS") {
      const slabs = ent.tenure_slabs ?? [];
      if (!slabs.length) add(`${p}.entitlement.tenure_slabs`, "Add at least one slab, starting at 0 months.");
      slabs.forEach((s, j) => {
        int(`${p}.entitlement.tenure_slabs[${j}].from_months`, s.from_months, 0, 600);
        dec(`${p}.entitlement.tenure_slabs[${j}].amount`, s.amount, UNITS);
      });
      const months = slabs.map((s) => s.from_months);
      if (months.length && (months[0] !== 0 || months.some((m, k) => k > 0 && m <= months[k - 1])))
        add(`${p}.entitlement.tenure_slabs`, "Slabs start at 0 months and increase.");
    }
    int(`${p}.entitlement.credit_expiry_months`, ent.credit_expiry_months, 1, 60, true);
    dec(`${p}.accrual_cap`, rule.accrual_cap, POSITIVE, true);
    dec(`${p}.max_balance`, rule.max_balance, POSITIVE, true);
    dec(`${p}.carry_forward.cap`, rule.carry_forward.cap, UNITS, true);
    int(`${p}.carry_forward.expiry_months`, rule.carry_forward.expiry_months, 1, 60, true);

    const enc = rule.encashment;
    if (enc.triggers.length && !enc.eligible) add(`${p}.encashment.triggers`, "Turn on encashment to choose when it happens.");
    dec(`${p}.encashment.max_units_per_cycle`, enc.max_units_per_cycle, POSITIVE, true);
    dec(`${p}.encashment.min_balance_after`, enc.min_balance_after, UNITS, true);
    dec(`${p}.encashment.step`, enc.step, STEP);

    dec(`${p}.negative_allowance`, rule.negative_allowance, UNITS);
    const negative = Number(rule.negative_allowance) > 0;
    if (rule.insufficient_balance_action === "ALLOW_NEGATIVE" && !negative)
      add(`${p}.negative_allowance`, "Say how far below zero the balance may go.");
    if (rule.insufficient_balance_action !== "ALLOW_NEGATIVE" && negative)
      add(`${p}.negative_allowance`, "A negative allowance goes with “Allow a negative balance” only.");

    const r = rule.request;
    dec(`${p}.request.min_units`, r.min_units, POSITIVE, true);
    dec(`${p}.request.max_units`, r.max_units, POSITIVE, true);
    dec(`${p}.request.max_consecutive_units`, r.max_consecutive_units, POSITIVE, true);
    if (r.min_units && r.max_units && DECIMAL_RE.test(r.min_units) && DECIMAL_RE.test(r.max_units) && Number(r.min_units) > Number(r.max_units))
      add(`${p}.request.max_units`, "The largest request must be at least the smallest.");
    r.caps.forEach((c, j) => dec(`${p}.request.caps[${j}].max_units`, c.max_units, POSITIVE));
    r.max_instances.forEach((c, j) => int(`${p}.request.max_instances[${j}].max_requests`, c.max_requests, 1, 1000));
    if (r.min_notice) {
      int(`${p}.request.min_notice.value`, r.min_notice.value, 0, 365);
      r.min_notice.scale.forEach((s, j) => {
        dec(`${p}.request.min_notice.scale[${j}].min_units`, s.min_units, POSITIVE);
        int(`${p}.request.min_notice.scale[${j}].value`, s.value, 0, 365);
      });
    }
    if (r.emergency_exception) dec(`${p}.request.emergency_exception.max_units`, r.emergency_exception.max_units, POSITIVE);
    int(`${p}.request.backdate_limit_days`, r.backdate_limit_days, 0, 90);
    int(`${p}.request.future_limit_days`, r.future_limit_days, 1, 730);
    int(`${p}.request.clubbing.gap_days`, r.clubbing.gap_days, 0, 5);
    if (r.clubbing.not_with.includes(rule.leave_type_code)) add(`${p}.request.clubbing.not_with`, "A type cannot exclude itself.");

    const d = rule.documents;
    if (!d.allowed && d.required.length) add(`${p}.documents.required`, "Documents cannot be required when uploads are not allowed.");
    d.required.forEach((need, j) => {
      const takesUnits = need.when === "MIN_UNITS" || need.when === "MIN_CALENDAR_DAYS";
      if (takesUnits) dec(`${p}.documents.required[${j}].min_units`, need.min_units, POSITIVE);
    });
    if (d.due.startsWith("WITHIN_DAYS")) int(`${p}.documents.due_days`, d.due_days, 0, 90);

    if (rule.balance_scope.kind === "EVENT" && !rule.event) add(`${p}.event`, "Event leave needs the event rules.");
    if (rule.event) {
      if (!rule.event.event_types.length) add(`${p}.event.event_types`, "Choose at least one event.");
      dec(`${p}.event.entitlement_units`, rule.event.entitlement_units, POSITIVE);
      int(`${p}.event.earliest_start_offset_days`, rule.event.earliest_start_offset_days, -365, 0);
      int(`${p}.event.take_within_days`, rule.event.take_within_days, 1, 1095, true);
      int(`${p}.event.max_occurrences`, rule.event.max_occurrences, 1, 1000, true);
    }

    if (types) {
      const lt = byCode.get(rule.leave_type_code);
      if (!lt) {
        add(`${p}.leave_type_code`, `There is no leave type “${rule.leave_type_code}”.`);
        return;
      }
      if (lt.kind === "COMP_OFF") {
        compOffs += 1;
        if (rule.balance_scope.kind !== "LOTS") add(`${p}.balance_scope.kind`, "A comp-off type keeps its balance as expiring credits.");
      } else if (rule.balance_scope.kind === "LOTS") {
        add(`${p}.balance_scope.kind`, "Only comp-off types keep expiring credits.");
      }
      if (lt.kind === "EVENT" && !rule.event) add(`${p}.event`, `${lt.name} is an event leave: describe the event.`);
      if (lt.kind !== "EVENT" && rule.event) add(`${p}.event`, `${lt.name} is not an event leave.`);
      if (rule.during_notice === "BLOCK" && (lt.kind === "EVENT" || lt.absence_class === "STATUTORY" || lt.absence_class === "PROTECTED"))
        add(`${p}.during_notice`, "Notice never blocks statutory, protected or event leave.");
    }
  });

  if (compOffs > 1) add("types", "A plan has at most one comp-off type.");
  if (compOffs && !plan.comp_off) add("comp_off", "Describe the comp-off claim rules.");
  if (plan.comp_off) {
    const c = plan.comp_off;
    if (!c.earn_on.length) add("comp_off.earn_on", "Choose the days that can be claimed.");
    int("comp_off.claim_window_days", c.claim_window_days, 1, 90);
    int("comp_off.validity_days", c.validity_days, 1, 365);
    int("comp_off.min_usable_days", c.min_usable_days, 0, 90);
    dec("comp_off.max_units_per_month", c.max_units_per_month, POSITIVE, true);
    c.credit_slabs.forEach((s, j) => {
      int(`comp_off.credit_slabs[${j}].min_worked_minutes`, s.min_worked_minutes, 1, 1440);
      dec(`comp_off.credit_slabs[${j}].units`, s.units, POSITIVE);
    });
    const minutes = c.credit_slabs.map((s) => s.min_worked_minutes);
    if (!minutes.length || minutes.some((m, k) => k > 0 && m <= minutes[k - 1]))
      add("comp_off.credit_slabs", "List the slabs with increasing worked minutes.");
  }
  return issues;
}

/** Normalize, then validate: the document to send and what still blocks saving. */
export function preparePlan(plan: LeavePlanFields, types?: LeaveTypeV2[]): { fields: LeavePlanFields; issues: PlanIssue[] } {
  const fields = normalizePlan(plan);
  return { fields, issues: validatePlan(fields, types) };
}

/* ------------------------------------------------------------------ plain-language summaries */

const unitWord = (unit: "DAY" | "HOUR" | undefined) => (unit === "HOUR" ? "hours" : "days");

export function entitlementSummary(rule: LeaveTypeRule, unit?: "DAY" | "HOUR"): string {
  const e = rule.entitlement;
  const u = unitWord(unit);
  switch (e.method) {
    case "FRONT_LOADED":
      return `${e.amount || 0} ${u} at the start of the year`;
    case "PERIODIC":
      return `${e.amount || 0} ${u} a year, credited ${String(e.frequency ?? "MONTHLY").toLowerCase().replace("_", "-")} (${e.post_at === "START" ? "start" : "end"} of period)`;
    case "TENURE_SLABS":
      return `${(e.tenure_slabs ?? []).length} tenure slab(s)`;
    case "PER_DAYS_WORKED":
      return `1 ${u.slice(0, -1)} per ${e.per_days_worked ?? "?"} days worked`;
    case "EVENT_GRANT":
      return rule.event ? `${rule.event.entitlement_units} ${rule.event.duration_unit.toLowerCase().replace("_", " ")} per event` : "Per event";
    default:
      return "No yearly entitlement";
  }
}

export function yearEndSummary(rule: LeaveTypeRule): string {
  const cap = rule.carry_forward.cap;
  const carry = cap === null ? "carry everything" : cap === "0" ? "nothing carried" : `carry up to ${cap}`;
  return `${carry}${rule.encashment.eligible ? " · encashable" : ""}`;
}

export function requestSummary(rule: LeaveTypeRule): string {
  const r = rule.request;
  const parts = [r.min_notice ? `notice ${r.min_notice.value} ${r.min_notice.unit === "WORKING_DAYS" ? "working days" : "days"}` : "no notice"];
  if (r.max_units) parts.push(`max ${r.max_units}`);
  if (r.backdate_limit_days) parts.push(`back-date ${r.backdate_limit_days} days`);
  if (r.reason === "REQUIRED") parts.push("reason required");
  return parts.join(" · ");
}
