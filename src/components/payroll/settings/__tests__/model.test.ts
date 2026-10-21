import { payrollError } from "@/lib/payroll/api";

import {
  checklistItems,
  definitionOf,
  describeSaveError,
  formatValue,
  fromDraft,
  grainNotice,
  groupDefinitions,
  humanize,
  isVisible,
  sameValue,
  sectionDefinitions,
  sectionLevels,
  splitHelp,
  toDraft,
} from "../model";
import type { SettingValueItem, ValuesResponse } from "../types";

const def = (key: string) => {
  const found = definitionOf(key);
  if (!found) throw new Error(`missing ${key}`);
  return found;
};

describe("registry lookups", () => {
  it("returns a section's settings in display order and its editable levels", () => {
    const general = sectionDefinitions("general");
    expect(general[0].key).toBe("payroll.enabled");
    const orders = general.map((d) => (typeof d.ui.order === "number" ? d.ui.order : 1000));
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    expect(sectionLevels(general)).toEqual(expect.arrayContaining(["TENANT", "PAY_GROUP"]));
    expect(sectionDefinitions("tables")).toEqual([]);
  });

  it("groups consecutive settings by ui.group", () => {
    const groups = groupDefinitions(sectionDefinitions("general"));
    expect(groups.some((g) => g.group === "Pay calendar")).toBe(true);
    expect(groups.flatMap((g) => g.defs)).toHaveLength(sectionDefinitions("general").length);
  });
});

describe("copy helpers", () => {
  it("splits ON/OFF help into its consequences", () => {
    expect(splitHelp("ON: The workspace is available. OFF: Menus are hidden.")).toEqual({
      on: "The workspace is available.",
      off: "Menus are hidden.",
      text: null,
    });
    expect(splitHelp("Just help.")).toEqual({ on: null, off: null, text: "Just help." });
  });

  it("humanizes enum codes", () => {
    expect(humanize("SEMI_MONTHLY")).toBe("Semi monthly");
    expect(humanize("MON")).toBe("Monday");
    expect(humanize(null)).toBe("Not set");
  });

  it("explains the PERIOD vs DAY grain of an effective date", () => {
    expect(grainNotice("PERIOD", "2026-11-12")).toBe("Applies to the whole November 2026 period");
    expect(grainNotice("DAY", "2026-11-12")).toBe("Applies from 12 Nov 2026");
  });

  it("formats values without turning money into numbers", () => {
    expect(formatValue(def("payroll.enabled"), true)).toBe("On");
    expect(formatValue(def("payroll.wage_inputs.require_approval_above"), { amount: "12345678901234567.89", currency: "INR" })).toBe(
      "12345678901234567.89 INR",
    );
    expect(formatValue(def("payroll.pay_frequency"), "BI_WEEKLY")).toBe("Bi weekly");
    expect(formatValue(undefined, null)).toBe("Not set");
  });
});

describe("drafts → API values", () => {
  it("booleans", () => {
    expect(toDraft(def("payroll.enabled"), true)).toBe(true);
    expect(fromDraft(def("payroll.enabled"), false)).toEqual({ ok: true, value: false });
  });

  it("integers are checked against min/max and sent as JSON integers", () => {
    const d = def("payroll.calendar.monthly_start_day");
    expect(fromDraft(d, "15")).toEqual({ ok: true, value: 15 });
    expect(fromDraft(d, "32")).toEqual({ ok: false, error: expect.stringContaining("at most 31") });
    expect(fromDraft(d, "1.5")).toEqual({ ok: false, error: expect.stringContaining("whole number") });
  });

  it("decimals stay strings, with place and bound checks", () => {
    const d = def("payroll.deductions.min_net_pay_percent");
    expect(fromDraft(d, "33.5")).toEqual({ ok: true, value: "33.5" });
    expect(fromDraft(d, "101")).toEqual({ ok: false, error: expect.stringContaining("at most 100") });
    expect(fromDraft(d, "1e3")).toEqual({ ok: false, error: expect.stringContaining("number") });
    expect(fromDraft(d, "")).toEqual({ ok: true, value: null }); // nullable
  });

  it("money uses the ISO minor unit of its currency and is never a JSON number", () => {
    const d = def("payroll.wage_inputs.require_approval_above");
    expect(toDraft(d, { amount: "500.00", currency: "INR" })).toEqual({ amount: "500.00", currency: "INR" });
    expect(fromDraft(d, { amount: "1,500.5", currency: "INR" })).toEqual({ ok: true, value: { amount: "1500.50", currency: "INR" } });
    expect(fromDraft(d, { amount: "1.2345", currency: "KWD" })).toEqual({ ok: false, error: expect.stringContaining("3 decimals") });
    expect(fromDraft(d, { amount: "10.5", currency: "JPY" })).toEqual({ ok: false, error: expect.stringContaining("no decimals") });
    expect(fromDraft(d, { amount: "0", currency: "" })).toEqual({ ok: true, value: { amount: "0", currency: null } });
    expect(fromDraft(d, { amount: "10", currency: "" })).toEqual({ ok: false, error: expect.stringContaining("currency") });
  });

  it("enums must be one of the choices; sets need their minimum", () => {
    expect(fromDraft(def("payroll.pay_frequency"), "WEEKLY")).toEqual({ ok: true, value: "WEEKLY" });
    expect(fromDraft(def("payroll.pay_frequency"), "YEARLY")).toEqual({ ok: false, error: expect.any(String) });
    expect(fromDraft(def("payroll.bank.verification_methods"), [])).toEqual({ ok: false, error: "Choose at least 1." });
    expect(fromDraft(def("payroll.bank.verification_methods"), ["FORMAT"])).toEqual({ ok: true, value: ["FORMAT"] });
  });

  it("locale lists and currency codes", () => {
    expect(fromDraft(def("payslip.languages"), "en-IN, ar-AE")).toEqual({ ok: true, value: ["en-IN", "ar-AE"] });
    expect(fromDraft(def("payslip.languages"), "en-IN, ar-AE, hi-IN")).toEqual({ ok: false, error: "Enter at most 2." });
    expect(fromDraft(def("payroll.currency"), "aed")).toEqual({ ok: true, value: "AED" });
  });

  it("compares values structurally", () => {
    expect(sameValue({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(sameValue(["EMAIL", "IN_APP"], ["IN_APP", "EMAIL"])).toBe(true);
    expect(sameValue("1", 1)).toBe(false);
  });
});

describe("visible_when", () => {
  const valueOf = (map: Record<string, unknown>) => (key: string) => map[key];
  it("equals, in and profile conditions", () => {
    const monthly = def("payroll.calendar.monthly_start_day");
    expect(isVisible(monthly, valueOf({ "payroll.pay_frequency": "MONTHLY" }), null)).toBe(true);
    expect(isVisible(monthly, valueOf({ "payroll.pay_frequency": "WEEKLY" }), null)).toBe(false);
    const payDay = def("payroll.calendar.pay_day_value");
    expect(isVisible(payDay, valueOf({ "payroll.calendar.pay_day_rule": "DAY_OF_MONTH" }), null)).toBe(true);
    const legacy = def("payroll.migration.legacy_review_acknowledged");
    expect(isVisible(legacy, valueOf({}), "LEGACY_V1")).toBe(true);
    expect(isVisible(legacy, valueOf({}), "STARTER_V1")).toBe(false);
  });
});

describe("save errors", () => {
  it("409 conflicts keep the server's current value", () => {
    const error = payrollError(409, {
      code: "STALE_ROW_VERSION",
      detail: { message: "Overtime pay was changed by someone else.", key: "payroll.overtime.enabled", current: { value: true, row_version: 4 } },
    });
    expect(describeSaveError(error)).toEqual({
      kind: "conflict",
      code: "STALE_ROW_VERSION",
      key: "payroll.overtime.enabled",
      message: "Overtime pay was changed by someone else.",
      current: { value: true, row_version: 4 },
    });
  });

  it("V-xx cross-validation issues, field errors and reasons", () => {
    const invalid = payrollError(400, {
      code: "SETTINGS_INVALID",
      detail: { message: "Loans need a protected net pay", issues: [{ rule: "V-07", severity: "ERROR", keys: ["payroll.loans.enabled"], message: "Loans need a protected net pay" }] },
    });
    expect(describeSaveError(invalid)).toMatchObject({ kind: "invalid", issues: [{ rule: "V-07" }] });
    const field = payrollError(400, { code: "OUT_OF_RANGE", detail: { message: "Too big", key: "payroll.lop.custom_days", details: {} } });
    expect(describeSaveError(field)).toEqual({ kind: "field", key: "payroll.lop.custom_days", message: "Too big" });
    const reason = payrollError(400, { code: "REASON_REQUIRED", detail: "A reason is required." });
    expect(describeSaveError(reason, ["a", "b"])).toEqual({ kind: "reason", message: "A reason is required." });
    const single = payrollError(400, { code: "INVALID_CHOICE", detail: "Pick one" });
    expect(describeSaveError(single, ["payroll.pay_frequency"])).toEqual({ kind: "field", key: "payroll.pay_frequency", message: "Pick one" });
  });
});

describe("setup checklist", () => {
  const item = (key: string, here: SettingValueItem["here"], value: unknown): SettingValueItem => ({
    key, value, level: "TENANT", badge: { code: "SET_HERE", label: "Set here" }, locked_by: null, legal_limit: [], effective_from: null,
    effective_to: null, editable: true, row_version: 1, here, shadowed: [], valid: true, issues: [], pending: null,
  });
  const here = (source: string) => ({
    row_id: 1, value: false, locked: false, effective_from: "2026-10-01", effective_to: null, source, profile_version: "STARTER_V1", reason: null,
  });

  it("lists STARTER_V1 decisions; only an administrator's save counts as decided", () => {
    const values: ValuesResponse = {
      scope: { scope_type: "TENANT", scope_id: null, name: "Company" }, as_of: "2026-10-21", registry_version: "x", profile_version: "STARTER_V1",
      items: [item("payroll.overtime.enabled", here("STARTER_PROFILE"), false), item("payroll.attendance.enabled", here("ADMIN"), true)],
      issues: [],
    };
    const items = checklistItems(values);
    expect(items.length).toBeGreaterThanOrEqual(10);
    expect(items.find((i) => i.key === "payroll.overtime.enabled")).toMatchObject({ state: "required", sectionSlug: "overtime" });
    expect(items.find((i) => i.key === "payroll.attendance.enabled")).toMatchObject({ state: "decided", value: true });
    expect(items.find((i) => i.key === "payroll.loans.enabled")?.state).toBe("required");
  });
});
