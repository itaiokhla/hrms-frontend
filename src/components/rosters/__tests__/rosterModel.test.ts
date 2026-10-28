/** AS-M5 WI-AS-5.5: the pure Roster Grid helpers (03-shifts/02 §4-§6, §13). */
import type { RosterDraft, RosterEntry } from "@/components/rosters/api";
import {
  applyPending, blockingCode, buildCells, cellKey, cellLabel, dateLabel, dayHeader, isWeekend, keysOf, measuredText,
  paletteKey, parsePaletteKey, periodDates, resultsByCell, ruleLabel, scheduleText, scheduleTimes, toDraftCells,
  validatePeriod, withPending, type PaletteValue,
} from "@/components/rosters/rosterModel";

const entry = (over: Partial<RosterEntry>): RosterEntry => ({
  id: 1, employee_id: 7, shift_date: "2026-11-02", entry_seq: 1, kind: "WORK", shift_id: 5, shift_version_id: 50,
  custom_start_time: null, custom_end_time: null, site_id: null, planned_work_mode: null, version: 1, source: "MANUAL",
  roster_period_id: 3, publication_id: 9, published_at: "2026-10-20T10:00:00+00:00", acknowledged_at: null, note: null, ...over,
});

const draft = (over: Partial<RosterDraft>): RosterDraft => ({
  id: 1, employee_id: 7, shift_date: "2026-11-02", entry_seq: 1, action: "UPSERT", kind: "WORK", shift_id: 6,
  custom_start_time: null, custom_end_time: null, site_id: null, planned_work_mode: null, source: "MANUAL",
  base_entry_id: null, base_entry_version: null, note: null, ...over,
});

const codes: Record<number, string> = { 5: "M1", 6: "N1" };
const codeOf = (id: number) => codes[id];

describe("period dates", () => {
  it("lists every date of the period, both ends included, across a month end", () => {
    expect(periodDates("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(periodDates("2026-11-02", "2026-11-02")).toEqual(["2026-11-02"]);
    expect(periodDates("2026-11-03", "2026-11-02")).toEqual([]);
  });

  it("shades Saturdays and Sundays and labels dates without the device zone", () => {
    expect(isWeekend("2026-10-31")).toBe(true);
    expect(isWeekend("2026-11-01")).toBe(true);
    expect(isWeekend("2026-11-02")).toBe(false);
    expect(dateLabel("2026-11-02")).toBe("Mon 2 Nov 2026");
    expect(dayHeader("2026-11-01")).toEqual({ weekday: "Sun", day: "1 Nov" });
  });
});

describe("cell map", () => {
  it("puts drafts on top of published entries and keeps further entries as a count", () => {
    const cells = buildCells(
      [entry({}), entry({ id: 2, shift_date: "2026-11-03" }), entry({ id: 3, shift_date: "2026-11-03", entry_seq: 2, shift_id: 6 }),
        entry({ id: 4, shift_date: "2026-11-04", kind: "OFF", shift_id: null })],
      [draft({}), draft({ id: 2, shift_date: "2026-11-05", kind: "OFF", shift_id: null }),
        draft({ id: 3, shift_date: "2026-11-04", action: "DELETE", kind: null, shift_id: null })],
    );
    expect(cells.get(cellKey(7, "2026-11-02"))).toEqual({ kind: "WORK", shiftId: 6, status: "DRAFT", extra: 0 });
    expect(cells.get(cellKey(7, "2026-11-03"))).toEqual({ kind: "WORK", shiftId: 5, status: "PUBLISHED", extra: 1 });
    expect(cells.get(cellKey(7, "2026-11-04"))).toEqual({ kind: null, shiftId: null, status: "DRAFT", extra: 0 });
    expect(cells.get(cellKey(7, "2026-11-05"))).toEqual({ kind: "OFF", shiftId: null, status: "DRAFT", extra: 0 });
    expect(cells.get(cellKey(7, "2026-11-06"))).toBeUndefined();
  });

  it("applies unsaved edits as PENDING cells without touching the saved map", () => {
    const cells = buildCells([entry({})], []);
    let pending = new Map<string, PaletteValue>();
    pending = withPending(pending, 7, "2026-11-02", { kind: "OFF" });
    pending = withPending(pending, 8, "2026-11-03", { kind: "WORK", shiftId: 6 });
    const shown = applyPending(cells, pending);
    expect(shown.get(cellKey(7, "2026-11-02"))).toEqual({ kind: "OFF", shiftId: null, status: "PENDING", extra: 0 });
    expect(shown.get(cellKey(8, "2026-11-03"))).toEqual({ kind: "WORK", shiftId: 6, status: "PENDING", extra: 0 });
    expect(cells.get(cellKey(7, "2026-11-02"))?.status).toBe("PUBLISHED");
    expect(applyPending(cells, new Map())).toBe(cells);
  });

  it("turns edits into PUT /drafts cells: UPSERT WORK with shift_id, UPSERT OFF, DELETE for Clear, sorted", () => {
    let pending = new Map<string, PaletteValue>();
    pending = withPending(pending, 9, "2026-11-02", { kind: "CLEAR" });
    pending = withPending(pending, 7, "2026-11-03", { kind: "OFF" });
    pending = withPending(pending, 7, "2026-11-02", { kind: "WORK", shiftId: 5 });
    expect(toDraftCells(pending)).toEqual([
      { employee_id: 7, shift_date: "2026-11-02", entry_seq: 1, action: "UPSERT", kind: "WORK", shift_id: 5 },
      { employee_id: 7, shift_date: "2026-11-03", entry_seq: 1, action: "UPSERT", kind: "OFF" },
      { employee_id: 9, shift_date: "2026-11-02", entry_seq: 1, action: "DELETE" },
    ]);
  });

  it("round-trips the palette drag payload", () => {
    for (const value of [{ kind: "WORK", shiftId: 12 }, { kind: "OFF" }, { kind: "CLEAR" }] as PaletteValue[]) {
      expect(parsePaletteKey(paletteKey(value))).toEqual(value);
    }
    expect(parsePaletteKey("shift:x")).toBeNull();
    expect(parsePaletteKey(null)).toBeNull();
  });
});

describe("cell labels", () => {
  it("names a cell 'Employee, date: CODE' with the draft / unsaved state and issue count", () => {
    expect(cellLabel("Asha Rao", "2026-11-02", { kind: "WORK", shiftId: 5, status: "PUBLISHED", extra: 0 }, codeOf))
      .toBe("Asha Rao, Mon 2 Nov 2026: M1");
    expect(cellLabel("Asha Rao", "2026-11-02", { kind: "WORK", shiftId: 6, status: "DRAFT", extra: 0 }, codeOf))
      .toBe("Asha Rao, Mon 2 Nov 2026: N1 (draft)");
    expect(cellLabel("Asha Rao", "2026-11-02", { kind: "OFF", shiftId: null, status: "PENDING", extra: 0 }, codeOf, 2))
      .toBe("Asha Rao, Mon 2 Nov 2026: Off (unsaved), 2 issues");
    expect(cellLabel("Asha Rao", "2026-11-02", { kind: null, shiftId: null, status: "EMPTY", extra: 0 }, codeOf, 1))
      .toBe("Asha Rao, Mon 2 Nov 2026: No shift, 1 issue");
  });
});

describe("rule results", () => {
  const results = [
    { rule_key: "MIN_REST_VIOLATION", severity: "BLOCK", employee_id: 7, dates: ["2026-11-02", "2026-11-03"], measured: "8", limit: "11", unit: "HOURS" },
    { rule_key: "COVERAGE_BELOW_MINIMUM", severity: "WARN", employee_id: null, dates: ["2026-11-02"] },
    { rule_key: "HOLIDAY_WORK", severity: "REQUIRE_REASON", employee_id: 8, dates: ["2026-11-02"] },
    { rule_key: "HOLIDAY_WORK", severity: "REQUIRE_REASON", employee_id: 9, dates: ["2026-11-02"] },
    { rule_key: "UNAVAILABLE", severity: "WARN", employee_id: 7, dates: ["2026-11-03"] },
  ];

  it("maps results to the cells of their employee and dates", () => {
    const byCell = resultsByCell(results);
    expect(byCell.get(cellKey(7, "2026-11-02"))?.map((r) => r.rule_key)).toEqual(["MIN_REST_VIOLATION"]);
    expect(byCell.get(cellKey(7, "2026-11-03"))?.map((r) => r.rule_key)).toEqual(["MIN_REST_VIOLATION", "UNAVAILABLE"]);
    expect(byCell.size).toBe(4);
  });

  it("collects one key per WARN / REQUIRE_REASON rule and mirrors the publish refusal code", () => {
    expect(keysOf(results, "WARN")).toEqual(["COVERAGE_BELOW_MINIMUM", "UNAVAILABLE"]);
    expect(keysOf(results, "REQUIRE_REASON")).toEqual(["HOLIDAY_WORK"]);
    expect(blockingCode(results.filter((r) => r.severity === "BLOCK"))).toBe("INSUFFICIENT_REST_HOURS");
    expect(blockingCode([{ rule_key: "SHIFT_OVERLAP", severity: "BLOCK" }])).toBe("ROSTER_RULE_VIOLATION");
    expect(blockingCode([])).toBeNull();
  });

  it("words the rule and its measured value against the limit", () => {
    expect(ruleLabel("MIN_REST_VIOLATION")).toBe("Too little rest between shifts");
    expect(ruleLabel("SOMETHING_NEW")).toBe("Something new");
    expect(measuredText(results[0])).toBe("Measured 8 hours vs limit 11 hours");
    expect(measuredText({ measured: null, limit: 3, unit: null })).toBe("Limit 3");
    expect(measuredText({ measured: undefined, limit: undefined })).toBeNull();
  });
});

describe("new period", () => {
  const ok = { code: "BLR-NOV", name: "Bengaluru November", branch_id: "2", start_date: "2026-11-01", end_date: "2027-01-01" };

  it("accepts up to 62 days and refuses a longer or inverted range", () => {
    expect(validatePeriod(ok)).toEqual({});
    expect(validatePeriod({ ...ok, end_date: "2027-01-02" }).end_date).toBe("A period covers at most 62 days.");
    expect(validatePeriod({ ...ok, end_date: "2026-10-31" }).end_date).toBe("The last day can't be before the first day.");
  });

  it("needs a code, a name and a branch", () => {
    expect(Object.keys(validatePeriod({ ...ok, code: " ", name: "", branch_id: "" })).sort()).toEqual(["branch_id", "code", "name"]);
  });
});

describe("my schedule", () => {
  it("shows the code, Off or No shift", () => {
    expect(scheduleText({ kind: "WORK", shift_code: "M1", shift_id: 5 })).toBe("M1");
    expect(scheduleText({ kind: "OFF", shift_code: "M1", shift_id: 5 })).toBe("Off");
    expect(scheduleText({ kind: null, shift_code: null, shift_id: null })).toBe("No shift");
  });

  it("converts an anchored shift to the work zone and marks a next-day end", () => {
    // US-E1 09:00–18:00 New York on an EST date reads 19:30–04:30 (+1) in Asia/Kolkata (D-AS-38).
    expect(scheduleTimes({ date: "2026-11-16", start_time: "09:00", end_time: "18:00", anchor_timezone: "America/New_York",
      work_timezone: "Asia/Kolkata" }, "UTC")).toBe("19:30–04:30 (+1)");
    expect(scheduleTimes({ date: "2026-11-16", start_time: "22:00", end_time: "06:00", anchor_timezone: null,
      work_timezone: null }, "Asia/Kolkata")).toBe("22:00–06:00 (+1)");
    expect(scheduleTimes({ date: "2026-11-16", start_time: null, end_time: null, anchor_timezone: null, work_timezone: null }, "UTC")).toBeNull();
  });
});
