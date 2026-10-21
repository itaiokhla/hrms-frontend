import { payrollError } from "@/lib/payroll/api";

import { policyTypeOf } from "../model";
import { buildFields, draftFields, errorField, parseField, summarizeFields } from "../policyFields";
import { draftsToRules } from "../PolicyModals";

const type = (code: string) => {
  const found = policyTypeOf(code);
  if (!found) throw new Error(`missing ${code}`);
  return found;
};
const field = (code: string, name: string) => {
  const found = type(code).fields.find((f) => f.name === name);
  if (!found) throw new Error(`missing ${code}.${name}`);
  return found;
};

describe("policy fields", () => {
  it("starts from the type defaults and round-trips them", () => {
    const attendance = type("ATTENDANCE_PAY_POLICY");
    const drafts = draftFields(attendance.fields, null);
    expect(drafts.unmarked_day).toBe("EXCEPTION");
    expect(drafts.derive_status_from_hours).toBe(false);
    const built = buildFields(attendance.fields, drafts);
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.value.unmarked_day).toBe("EXCEPTION");
      expect(built.value.full_day_min_hours).toBe("8");
      expect(built.value.break_type_pay_map).toEqual({});
      expect(built.value.lop_component_tag).toBe("LOP_APPLICABLE");
    }
  });

  it("leaves an emptied optional field to the server default", () => {
    const tag = field("ATTENDANCE_PAY_POLICY", "lop_component_tag");
    expect(parseField(tag, "")).toEqual({ ok: true, value: undefined, omit: true });
  });

  it("validates numbers, JSON and money per field", () => {
    expect(parseField(field("ATTENDANCE_PAY_POLICY", "full_day_min_hours"), "eight")).toEqual({ ok: false, error: expect.stringContaining("number") });
    expect(parseField(field("ATTENDANCE_PAY_POLICY", "break_type_pay_map"), "{bad")).toEqual({ ok: false, error: expect.stringContaining("JSON") });
    const cap = field("TASK_PAY_POLICY", "cap_per_period");
    expect(parseField(cap, { amount: "", currency: "" })).toEqual({ ok: true, value: null });
    expect(parseField(cap, { amount: "2500.5", currency: "AED" })).toEqual({ ok: true, value: { amount: "2500.50", currency: "AED" } });
    expect(parseField(cap, { amount: "2500", currency: "" })).toEqual({ ok: false, error: expect.stringContaining("currency") });
    const threshold = field("OVERTIME_POLICY", "daily_threshold");
    expect(parseField(threshold, "SHIFT_DURATION")).toEqual({ ok: true, value: "SHIFT_DURATION" });
    expect(parseField(threshold, "9.5")).toEqual({ ok: true, value: "9.5" });
  });

  it("collects every field error at once", () => {
    const attendance = type("ATTENDANCE_PAY_POLICY");
    const drafts = { ...draftFields(attendance.fields, null), full_day_min_hours: "x", half_day_min_hours: "y" };
    const built = buildFields(attendance.fields, drafts);
    expect(built.ok).toBe(false);
    if (!built.ok) expect(Object.keys(built.errors).sort()).toEqual(["full_day_min_hours", "half_day_min_hours"]);
  });

  it("summarizes a version in one line without structured fields", () => {
    const attendance = type("ATTENDANCE_PAY_POLICY");
    const text = summarizeFields(attendance.fields, { unmarked_day: "EXCEPTION", missing_punch_out: "HALF_DAY", derive_status_from_hours: true, break_type_pay_map: {} });
    expect(text).toBe("Unmarked day: Exception · Missing punch out: Half day · Derive status from hours: yes");
  });

  it("points server errors at their field", () => {
    expect(errorField(payrollError(400, { code: "INVALID", detail: { message: "Bad", field: "buckets.0.multiplier" } }))).toBe("buckets");
    expect(errorField(payrollError(400, { code: "INVALID", detail: "Bad" }))).toBeNull();
  });
});

describe("assignment rules", () => {
  const base = {
    everyone: false, legal_entity_ids: [] as number[], branch_ids: [] as number[], pay_group_ids: [] as number[],
    ids: {} as Record<string, string>, employment_types: "", priority: "10", effective_from: "2026-11-01", effective_to: "",
  };

  it("builds criteria from the chosen dimensions", () => {
    const result = draftsToRules([
      { ...base, legal_entity_ids: [3], ids: { employee_ids: "4, 7" }, employment_types: "PERMANENT" },
      { ...base, everyone: true, priority: "0" },
    ]);
    expect(result).toEqual({
      ok: true,
      rules: [
        { criteria: { legal_entity_ids: [3], employee_ids: [4, 7], employment_types: ["PERMANENT"] }, priority: 10, effective_from: "2026-11-01", effective_to: null },
        { criteria: { everyone: true }, priority: 0, effective_from: "2026-11-01", effective_to: null },
      ],
    });
  });

  it("rejects empty criteria, bad ids and reversed dates", () => {
    expect(draftsToRules([base])).toEqual({ ok: false, error: expect.stringContaining("choose who it covers") });
    expect(draftsToRules([{ ...base, ids: { grade_ids: "a" } }])).toEqual({ ok: false, error: expect.stringContaining("numbers") });
    expect(draftsToRules([{ ...base, everyone: true, effective_to: "2026-10-01" }])).toEqual({ ok: false, error: expect.stringContaining("end date") });
  });
});
