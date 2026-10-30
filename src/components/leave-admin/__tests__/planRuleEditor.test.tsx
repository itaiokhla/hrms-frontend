/**
 * Plan rule editor (03-leave/01 §5, §11.5): the editor and its model must produce a `fields` document the strict
 * server model (`LeavePlan` in app/payroll/policy_types.py) accepts — decimals as strings, whole numbers as numbers,
 * conditional fields cleared, defaults valid for every kind of leave type.
 */
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import {
  addTypeRule,
  defaultRule,
  emptyPlan,
  hydratePlan,
  issuesUnder,
  normalizeRule,
  preparePlan,
  ruleForType,
  ruleIndexOf,
  rulePath,
  setIn,
  validatePlan,
} from "@/components/leave-admin/planModel";
import { TypeRuleEditor } from "@/components/leave-admin/RuleEditor";
import type { LeavePlanFields, LeaveTypeRule, LeaveTypeV2 } from "@/lib/leave/adminTypes";

jest.mock("react-hot-toast", () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));

function type(code: string, patch: Partial<LeaveTypeV2> = {}): LeaveTypeV2 {
  return {
    id: code.length, code, name: code[0].toUpperCase() + code.slice(1), display_name: code, description: null, kind: null,
    category: "ANNUAL", unit: "DAY", sensitivity: "STANDARD", absence_class: "PLANNED", counts_toward_absence_score: false,
    is_paid: true, is_unlimited: false, is_active: true, counts_non_working_days: false, allow_half_day: true,
    color_token: "leave-1", icon: "sun", display_order: 100, name_i18n: {}, annual_quota: 18, row_version: 1, ...patch,
  };
}

const EARNED = type("earned");
const SICK = type("sick", { category: "SICK", sensitivity: "SENSITIVE", absence_class: "PROTECTED", annual_quota: 12 });
const COMP = type("comp_off", { kind: "COMP_OFF", category: "COMP_OFF" });
const MATERNITY = type("maternity", { kind: "EVENT", category: "PARENTAL", absence_class: "STATUTORY", counts_non_working_days: true });
const UNPAID = type("unpaid", { category: "UNPAID", is_paid: false, is_unlimited: true, absence_class: "UNPLANNED" });
const TYPES = [EARNED, SICK, COMP, MATERNITY, UNPAID];

/** Paths of every decimal field of a rule (they must be strings or null, never numbers). */
const DECIMAL_PATHS = [
  "entitlement.amount", "accrual_cap", "max_balance", "carry_forward.cap", "encashment.max_units_per_cycle",
  "encashment.min_balance_after", "encashment.step", "negative_allowance", "request.min_units", "request.max_units",
  "request.max_consecutive_units", "eligibility.min_fte",
];
const INT_PATHS = ["request.backdate_limit_days", "request.future_limit_days", "request.clubbing.gap_days"];

function get(rule: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => (acc == null ? acc : (acc as Record<string, unknown>)[k]), rule);
}

describe("plan model: starting rules", () => {
  it("gives every kind of leave type a rule the server accepts", () => {
    let plan = emptyPlan();
    TYPES.forEach((t) => (plan = addTypeRule(plan, t)));
    const { fields, issues } = preparePlan(plan, TYPES);
    expect(issues).toEqual([]);
    expect(fields.types.map((r) => r.leave_type_code)).toEqual(["earned", "sick", "comp_off", "maternity", "unpaid"]);
    // Comp-off: expiring credits and the plan's claim rules.
    expect(fields.types[2].balance_scope.kind).toBe("LOTS");
    expect(fields.comp_off).not.toBeNull();
    expect(fields.comp_off?.credit_slabs[0]).toEqual({ min_worked_minutes: 240, units: "0.5" });
    // Event leave: per-event balance and event rules; statutory leave is exempt from blackouts and coverage.
    expect(fields.types[3].balance_scope.kind).toBe("EVENT");
    expect(fields.types[3].event?.entitlement_units).toBe("1");
    expect(fields.types[3].counting_basis.basis).toBe("CALENDAR_DAYS");
    expect(fields.types[3].request.blackouts).toBe("EXEMPT");
    // Unlimited: no entitlement; unpaid leave asks for a reason.
    expect(fields.types[4].entitlement.method).toBe("NONE");
    expect(fields.types[4].request.reason).toBe("REQUIRED");
    // Ordinary: front-loaded with the legacy quota as a decimal string.
    expect(fields.types[0].entitlement).toMatchObject({ method: "FRONT_LOADED", amount: "18", frequency: null, post_at: null });
  });

  it("keeps decimals as strings and whole numbers as numbers", () => {
    const rule = normalizeRule(ruleForType(EARNED));
    DECIMAL_PATHS.forEach((path) => {
      const value = get(rule, path);
      expect(value === null || typeof value === "string").toBe(true);
    });
    INT_PATHS.forEach((path) => expect(typeof get(rule, path)).toBe("number"));
    expect(JSON.stringify(rule)).not.toMatch(/"amount":\d/);
  });

  it("has every key of the server model so nothing is left to guess", () => {
    const keys = Object.keys(defaultRule("x")).sort();
    expect(keys).toEqual([
      "accrual_cap", "approval", "balance_check", "balance_scope", "carry_forward", "change", "counting_basis", "cycle",
      "documents", "during_notice", "during_probation", "eligibility", "encashment", "entitlement", "event", "frozen",
      "insufficient_balance_action", "keep_on_plan_exit", "leave_type_code", "max_balance", "negative_allowance",
      "negative_at_cycle_end", "proration", "request", "rounding", "sandwich",
    ]);
  });

  it("completes a partial server or template document with the defaults", () => {
    const plan = hydratePlan({ types: [{ leave_type_code: "casual", entitlement: { method: "FRONT_LOADED", amount: "12" } } as unknown as LeaveTypeRule] });
    expect(plan.defaults.cycle).toEqual({ kind: "CALENDAR_YEAR", custom_start: null });
    expect(plan.types[0].request.future_limit_days).toBe(365);
    expect(plan.types[0].entitlement.amount).toBe("12");
    expect(validatePlan(plan)).toEqual([]);
  });
});

describe("plan model: normalization before save", () => {
  it("clears fields the chosen options do not use", () => {
    const rule: LeaveTypeRule = {
      ...ruleForType(EARNED),
      entitlement: { method: "FRONT_LOADED", amount: " 20 ", frequency: "MONTHLY", post_at: "END", per_days_worked: 20, tenure_slabs: [{ from_months: 0, amount: "1" }], credit_expiry_months: null },
      eligibility: { ...defaultRule("x").eligibility, genders: [], worker_classes: [], countries: ["in", "IN"], employment_types: [" FT "] },
      documents: { allowed: true, required: [{ when: "ALWAYS", min_units: "3", category: "SUPPORTING_DOCUMENT" }], due: "AT_SUBMIT", due_days: 5, verification: "NONE" },
      insufficient_balance_action: "BLOCK",
      negative_allowance: "2",
      encashment: { eligible: false, triggers: ["EXIT"], max_units_per_cycle: "", min_balance_after: null, step: "0.5" },
      cycle: { kind: "CALENDAR_YEAR", custom_start: "04-01" },
    };
    const out = normalizeRule(rule);
    expect(out.entitlement).toMatchObject({ amount: "20", frequency: null, post_at: null, per_days_worked: null, tenure_slabs: null });
    expect(out.eligibility.genders).toBeNull();
    expect(out.eligibility.worker_classes).toBeNull();
    expect(out.eligibility.countries).toEqual(["IN"]);
    expect(out.eligibility.employment_types).toEqual(["FT"]);
    expect(out.documents.required[0].min_units).toBeNull();
    expect(out.documents.due_days).toBeNull();
    expect(out.negative_allowance).toBe("0");
    expect(out.encashment.triggers).toEqual([]);
    expect(out.encashment.max_units_per_cycle).toBeNull();
    expect(out.cycle).toEqual({ kind: "CALENDAR_YEAR", custom_start: null });
  });
});

describe("plan model: client checks mirror the server validators", () => {
  const withRule = (patch: (r: LeaveTypeRule) => LeaveTypeRule): LeavePlanFields => ({ ...emptyPlan(), types: [patch(ruleForType(EARNED))] });
  const fields = (plan: LeavePlanFields, types?: LeaveTypeV2[]) => preparePlan(plan, types).issues.map((i) => i.field);

  it("rejects bad decimals, ranges and cross-field rules with server-style paths", () => {
    expect(fields(withRule((r) => ({ ...r, entitlement: { ...r.entitlement, amount: "1.234" } })))).toEqual(["types[0].entitlement.amount"]);
    expect(fields(withRule((r) => ({ ...r, request: { ...r.request, min_units: "5", max_units: "2" } })))).toEqual(["types[0].request.max_units"]);
    expect(fields(withRule((r) => ({ ...r, request: { ...r.request, backdate_limit_days: 91 } })))).toEqual(["types[0].request.backdate_limit_days"]);
    expect(fields(withRule((r) => ({ ...r, insufficient_balance_action: "ALLOW_NEGATIVE", negative_allowance: "0" })))).toEqual(["types[0].negative_allowance"]);
    expect(fields(withRule((r) => ({ ...r, cycle: { kind: "CUSTOM", custom_start: "02-29" } })))).toEqual(["types[0].cycle.custom_start"]);
    expect(fields(withRule((r) => ({ ...r, documents: { ...r.documents, allowed: false, required: [{ when: "ALWAYS", min_units: null, category: "SUPPORTING_DOCUMENT" }] } }))))
      .toEqual(["types[0].documents.required"]);
    expect(fields(withRule((r) => ({ ...r, entitlement: { ...r.entitlement, method: "TENURE_SLABS", tenure_slabs: [{ from_months: 12, amount: "10" }] } }))))
      .toEqual(["types[0].entitlement.tenure_slabs"]);
  });

  it("checks the plan against the catalogue: unknown codes, comp-off shape, one comp-off type", () => {
    const plan = { ...emptyPlan(), types: [ruleForType(COMP), { ...ruleForType(type("comp2", { kind: "COMP_OFF", category: "COMP_OFF" })) }, defaultRule("ghost")] };
    const issues = preparePlan(plan, [...TYPES, type("comp2", { kind: "COMP_OFF", category: "COMP_OFF" })]).issues;
    expect(issues.map((i) => i.field)).toEqual(expect.arrayContaining(["types[2].leave_type_code", "types", "comp_off"]));
    expect(preparePlan({ ...emptyPlan(), types: [ruleForType(EARNED), ruleForType(EARNED)] }).issues.map((i) => i.message))
      .toContain("Each leave type appears once in a plan.");
  });

  it("maps server paths onto rules and sections", () => {
    expect(ruleIndexOf("types[12].request.min_notice.value")).toBe(12);
    expect(ruleIndexOf("comp_off.validity_days")).toBeNull();
    expect(rulePath("types[3].entitlement")).toBe("entitlement");
    const issues = [{ field: "entitlement", message: "a" }, { field: "entitlement.amount", message: "b" }, { field: "request.caps[0].max_units", message: "c" }];
    expect(issuesUnder(issues, "entitlement")).toHaveLength(2);
    expect(issuesUnder(issues, "request.caps")).toHaveLength(1);
    const before = emptyPlan();
    const after = setIn(before, "defaults.cycle.kind", "FISCAL_YEAR");
    expect(before.defaults.cycle.kind).toBe("CALENDAR_YEAR");
    expect(after.defaults.cycle.kind).toBe("FISCAL_YEAR");
  });
});

/** The real editor wired to state, as the plan builder does it. */
function Harness({ onPlan }: { onPlan: (plan: LeavePlanFields) => void }) {
  const [plan, setPlan] = useState<LeavePlanFields>(() => addTypeRule(emptyPlan(), EARNED));
  onPlan(plan);
  return (
    <TypeRuleEditor
      rule={plan.types[0]}
      type={EARNED}
      types={TYPES}
      branches={[]}
      issues={validatePlan(plan, TYPES).map((i) => ({ ...i, field: rulePath(i.field) }))}
      readOnly={false}
      onChange={(path, value) => setPlan((p) => setIn(p, `types[0].${path}`, value))}
    />
  );
}

describe("TypeRuleEditor", () => {
  it("edits entitlement, notice and documents into a valid fields document", () => {
    let latest = emptyPlan();
    render(<Harness onPlan={(p) => (latest = p)} />);

    fireEvent.change(screen.getByTestId("rule-earned-entitlement-method"), { target: { value: "PERIODIC" } });
    fireEvent.change(screen.getByTestId("rule-earned-entitlement-amount"), { target: { value: "18" } });

    fireEvent.click(screen.getByRole("button", { name: /Request rules/ }));
    fireEvent.click(screen.getByRole("switch", { name: "Advance notice" }));
    fireEvent.change(screen.getByTestId("rule-earned-request-min_notice-value"), { target: { value: "7" } });
    fireEvent.change(screen.getByTestId("rule-earned-request-max_units"), { target: { value: "10" } });

    fireEvent.click(screen.getByRole("button", { name: /Documents/ }));
    fireEvent.click(screen.getByTestId("rule-earned-documents-required-add"));

    const { fields, issues } = preparePlan(latest, TYPES);
    expect(issues).toEqual([]);
    const rule = fields.types[0];
    expect(rule.entitlement).toEqual({ method: "PERIODIC", amount: "18", frequency: "MONTHLY", post_at: "END", per_days_worked: null, tenure_slabs: null, credit_expiry_months: null });
    expect(rule.request.min_notice).toEqual({ value: 7, unit: "CALENDAR_DAYS", scale: [] });
    expect(rule.request.max_units).toBe("10");
    expect(rule.documents.required).toEqual([{ when: "MIN_UNITS", min_units: "3", category: "SUPPORTING_DOCUMENT" }]);
  });

  it("shows a problem inline and keeps it out of the saved document until fixed", () => {
    let latest = emptyPlan();
    render(<Harness onPlan={(p) => (latest = p)} />);
    fireEvent.change(screen.getByTestId("rule-earned-entitlement-amount"), { target: { value: "abc" } });
    expect(screen.getByText("Enter a number such as 1.5.")).toBeInTheDocument();
    expect(preparePlan(latest, TYPES).issues.map((i) => i.field)).toEqual(["types[0].entitlement.amount"]);
    fireEvent.change(screen.getByTestId("rule-earned-entitlement-amount"), { target: { value: "12.5" } });
    expect(preparePlan(latest, TYPES).issues).toEqual([]);
  });

  it("switching the balance action fills and clears the negative allowance", () => {
    let latest = emptyPlan();
    render(<Harness onPlan={(p) => (latest = p)} />);
    fireEvent.click(screen.getByRole("button", { name: /When the balance is short/ }));
    fireEvent.change(screen.getByTestId("rule-earned-insufficient_balance_action"), { target: { value: "ALLOW_NEGATIVE" } });
    expect(latest.types[0].negative_allowance).toBe("1");
    expect(preparePlan(latest, TYPES).issues).toEqual([]);
    fireEvent.change(screen.getByTestId("rule-earned-insufficient_balance_action"), { target: { value: "BLOCK" } });
    expect(preparePlan(latest, TYPES).fields.types[0].negative_allowance).toBe("0");
  });

  it("is read-only for active versions", () => {
    render(<TypeRuleEditor rule={ruleForType(EARNED)} type={EARNED} types={TYPES} branches={[]} issues={[]} readOnly onChange={jest.fn()} />);
    expect(screen.getByTestId("rule-earned-entitlement-amount")).toBeDisabled();
  });
});
