/** The rules editor's zod schema mirrors the server's cross-field checks (02 §4.3) and builds policy fields. */
import { rulesSchema, toFields } from "@/components/attendance/days/RulesPolicyEditor";

const base = {
  name: "Staff rules", effective_from: "2026-11-02", day_basis: "HOURS", threshold_mode: "ABSOLUTE",
  full_day_min_minutes: "450", half_day_min_minutes: "240", full_day_min_percent: "90", half_day_min_percent: "50",
  absent_marking: "AUTO_ABSENT", grace_in_minutes: "10", grace_out_minutes: "0", late_half_day_after_minutes: "120",
  early_half_day_before_minutes: "", late_waiver: "NONE", short_hours_enabled: false, short_tolerance_minutes: "0",
  break_attestation: false,
};

describe("rules editor schema", () => {
  it("accepts a valid draft and converts empty limits to null", () => {
    const parsed = rulesSchema.parse(base);
    const fields = toFields(parsed);
    expect(fields).toMatchObject({ threshold_mode: "ABSOLUTE", full_day_min_minutes: "450", half_day_min_minutes: "240",
                                   grace_in_minutes: 10, late_half_day_after_minutes: 120,
                                   early_half_day_before_minutes: null });
  });

  it("refuses a half day above the full day and a late limit within the grace", () => {
    const result = rulesSchema.safeParse({ ...base, half_day_min_minutes: "500", late_half_day_after_minutes: "5" });
    expect(result.success).toBe(false);
    const paths = result.success ? [] : result.error.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["half_day_min_minutes", "late_half_day_after_minutes"]));
  });

  it("sends default breaks with only the fields their mode uses", () => {
    const fields = toFields(rulesSchema.parse({ ...base, break_defaults: [
      { kind: "LUNCH", mode: "AUTO_DEDUCT", minutes: "30", paid: false, start: "", end: "", after: "300" },
      { kind: "REST", mode: "FIXED_WINDOW", minutes: "15", paid: true, start: "10:30", end: "10:45", after: "" },
    ] }));
    expect(fields.break_defaults).toEqual([
      { kind: "LUNCH", mode: "AUTO_DEDUCT", minutes: 30, paid: false, auto_deduct_after_minutes: 300 },
      { kind: "REST", mode: "FIXED_WINDOW", minutes: 15, paid: true, start: "10:30", end: "10:45" },
    ]);
    expect(toFields(rulesSchema.parse(base)).break_defaults).toEqual([]);
  });

  it("refuses a deduct without its threshold and a fixed window of the wrong length", () => {
    const result = rulesSchema.safeParse({ ...base, break_defaults: [
      { kind: "LUNCH", mode: "AUTO_DEDUCT", minutes: "30", paid: false, start: "", end: "", after: "" },
      { kind: "LUNCH", mode: "FIXED_WINDOW", minutes: "60", paid: false, start: "13:00", end: "13:30", after: "" },
    ] });
    const paths = result.success ? [] : result.error.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["break_defaults.0.after", "break_defaults.1.end"]));
  });

  it("treats an empty grace as the setting (null)", () => {
    expect(toFields(rulesSchema.parse({ ...base, grace_in_minutes: "", late_half_day_after_minutes: "" })).grace_in_minutes).toBeNull();
  });
});
