/** Holiday rules editor, preview list and publish panel (LH-M1 Goal 3; 04-holiday/02 §3.8, 04-holiday/01 §6.2-§6.3, §9.4). */
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { signIn } from "@/components/payroll/compensation/__tests__/helpers";
import { missingAcknowledgements, primaryAction, PublishYearPanel } from "@/components/holiday/PublishYearPanel";
import { defaultRuleForm, fromRule, RuleEditor, toRuleWrite } from "@/components/holiday/RuleEditor";
import { longDate, RulePreviewList } from "@/components/holiday/RulePreviewList";
import { HolidayApiError, yearsApi, type HolidayRule, type RulePreview, type YearImpact, type YearView } from "@/lib/holiday/api";
import { P } from "@/lib/permissions.generated";

jest.mock("react-hot-toast", () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));
jest.mock("@/lib/holiday/api", () => {
  const actual = jest.requireActual("@/lib/holiday/api");
  return {
    ...actual,
    yearsApi: { ...actual.yearsApi, previewRule: jest.fn(), createRule: jest.fn(), updateRule: jest.fn(), publish: jest.fn(), amend: jest.fn(), decline: jest.fn() },
  };
});

const api = yearsApi as jest.Mocked<typeof yearsApi>;
const CAL = { id: 7, code: "INDIA_NATIONAL_2026", name: "India National 2026", effective_weekend: [6] };
const TODAY = "2026-11-02";

const REPUBLIC_PREVIEW: RulePreview = {
  calendar_id: 7,
  weekend: [6],
  info: [],
  years: [2026, 2027, 2028, 2029, 2030].map((y, i) => ({
    year: y,
    rows: [{ date: `${y}-01-26`, weekday: [0, 1, 2, 4, 5][i], name: "Republic Day", status: "CONFIRMED", observance: "ORIGINAL", observed_from_date: null, sequence_index: 1 }],
    notes: [],
  })),
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe("rule form <-> request body", () => {
  it("sends only the keys of the chosen kind", () => {
    const f = { ...defaultRuleForm(TODAY, [6]), name: " Republic Day ", month: 1, day: 26, holidayType: "PUBLIC" as const, category: "NATIONAL" as const };
    expect(toRuleWrite(f, [6])).toMatchObject({
      name: "Republic Day",
      kind: "FIXED_DATE",
      params: { month: 1, day: 26 },
      holiday_type: "PUBLIC",
      duration_days: 1,
      duration_range: null,
      observed_rule: "NONE",
      applies_on: null,
      valid_from_year: 2026,
      valid_to_year: null,
    });
    const nth = toRuleWrite({ ...f, kind: "NTH_WEEKDAY", month: 11, weekday: 3, nth: 4, offset: 1 }, [6]);
    expect(nth.params).toEqual({ month: 11, weekday: 3, nth: 4, offset_days: 1 });
    const easter = toRuleWrite({ ...f, kind: "EASTER_OFFSET", offset: -2, tradition: "WESTERN" }, [6]);
    expect(easter.params).toEqual({ offset_days: -2, tradition: "WESTERN" });
  });

  it("handles leap days, announced holidays, one-offs and trigger days", () => {
    const base = { ...defaultRuleForm(TODAY, [5, 6]), name: "X" };
    expect(toRuleWrite({ ...base, month: 2, day: 29, missing: "NEXT_DAY" }, [5, 6]).params).toEqual({ month: 2, day: 29, missing_date: "NEXT_DAY" });
    expect(toRuleWrite({ ...base, month: 3, day: 29, missing: "NEXT_DAY" }, [5, 6]).params).toEqual({ month: 3, day: 29 });
    const eid = toRuleWrite({ ...base, kind: "ANNUAL_CONFIRM", rangeMin: 3, rangeMax: 4, expectedMonth: 3 }, [5, 6]);
    expect([eid.duration_days, eid.duration_range, eid.params]).toEqual([3, [3, 4], { expected_month: 3 }]);
    const once = toRuleWrite({ ...base, kind: "ONE_OFF", date: "2027-12-27", lasts: 5 }, [5, 6]);
    expect([once.valid_from_year, once.valid_to_year, once.duration_days]).toEqual([2027, 2027, 5]);
    expect(toRuleWrite({ ...base, observed: "NEAREST_WORKDAY", trigger: [6] }, [5, 6]).applies_on).toEqual([6]);
    expect(toRuleWrite({ ...base, observed: "NEAREST_WORKDAY", trigger: [6, 5] }, [5, 6]).applies_on).toBeNull();
  });

  it("round-trips a stored rule", () => {
    const rule = {
      id: 3,
      calendar_id: 7,
      name: "Thanksgiving",
      kind: "NTH_WEEKDAY",
      params: { month: 11, weekday: 3, nth: 4 },
      holiday_type: "PUBLIC",
      category: "NATIONAL",
      duration_days: 1,
      duration_range: null,
      observed_rule: "NONE",
      applies_on: null,
      valid_from_year: 2026,
      valid_to_year: null,
    } as unknown as HolidayRule;
    expect(toRuleWrite(fromRule(rule, TODAY, [5, 6]), [5, 6])).toMatchObject({ kind: "NTH_WEEKDAY", params: { month: 11, weekday: 3, nth: 4 } });
  });
});

describe("rule preview list", () => {
  it("shows one block per year, observed partners and notes", () => {
    const preview: RulePreview = {
      calendar_id: 7,
      weekend: [5, 6],
      info: [],
      years: [
        {
          year: 2027,
          rows: [
            { date: "2027-06-18", weekday: 4, name: "Juneteenth", status: "CONFIRMED", observance: "OBSERVED", observed_from_date: "2027-06-19", sequence_index: 1 },
            { date: "2027-06-19", weekday: 5, name: "Juneteenth", status: "CONFIRMED", observance: "ORIGINAL", observed_from_date: null, sequence_index: 1 },
          ],
          notes: [],
        },
        { year: 2028, rows: [], notes: [{ code: "DATE_SKIPPED", message: "No 5th Monday in Mar 2028", severity: "info" }] },
      ],
    };
    render(<RulePreviewList preview={preview} />);
    expect(screen.getByTestId("preview-row-2027-06-18")).toHaveTextContent("Fri 18 Jun 2027observed for Sat 19 Jun 2027");
    expect(screen.getByTestId("preview-year-2028")).toHaveTextContent("No date this year");
    expect(screen.getByText("No 5th Monday in Mar 2028")).toBeInTheDocument();
    expect(longDate("2027-01-26")).toBe("Tue 26 Jan 2027");
  });
});

describe("rule editor", () => {
  it("previews five years 400 ms after the last change and saves the rule", async () => {
    jest.useFakeTimers();
    api.previewRule.mockResolvedValue(REPUBLIC_PREVIEW);
    api.createRule.mockResolvedValue({ rule: {} as HolidayRule, draft_changes: [{ year: 2027, counts: { inserted: 1 } }], published_years_affected: [] });
    const onSaved = jest.fn();
    render(<RuleEditor calendar={CAL} today={TODAY} onSaved={onSaved} onCancel={jest.fn()} />);
    fireEvent.change(screen.getByTestId("rule-name"), { target: { value: "Republic Day" } });
    fireEvent.change(screen.getByRole("combobox", { name: /^Day/ }), { target: { value: "26" } });
    expect(api.previewRule).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    await waitFor(() => expect(api.previewRule).toHaveBeenCalledTimes(1));
    expect(api.previewRule.mock.calls[0][0]).toMatchObject({ calendar_id: 7, years: 5, from_year: 2026, rule: { params: { month: 1, day: 26 } } });
    expect(await screen.findByTestId("preview-year-2030")).toHaveTextContent("Sat 26 Jan 2030");
    fireEvent.click(screen.getByTestId("rule-save"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(api.createRule).toHaveBeenCalledWith(7, expect.objectContaining({ name: "Republic Day", kind: "FIXED_DATE" }));
  });

  it("puts RULE_INVALID details next to their fields", async () => {
    api.previewRule.mockResolvedValue(REPUBLIC_PREVIEW);
    api.createRule.mockRejectedValue(
      new HolidayApiError(422, "30 Feb does not exist", "RULE_INVALID", [], [{ field: "params.day", message: "30 Feb does not exist" }] as never),
    );
    render(<RuleEditor calendar={CAL} today={TODAY} onSaved={jest.fn()} onCancel={jest.fn()} />);
    fireEvent.click(screen.getByTestId("rule-save"));
    expect(await screen.findByText("Enter a name.")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("rule-name"), { target: { value: "Bad" } });
    fireEvent.click(screen.getByTestId("rule-save"));
    expect(await screen.findByText("30 Feb does not exist")).toBeInTheDocument();
  });

  it("switches the kind fields", () => {
    api.previewRule.mockResolvedValue(REPUBLIC_PREVIEW);
    render(<RuleEditor calendar={CAL} today={TODAY} onSaved={jest.fn()} onCancel={jest.fn()} />);
    fireEvent.click(screen.getByLabelText("Days from Easter"));
    expect(screen.getByTestId("kind-EASTER_OFFSET")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Tradition/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Announced every year"));
    expect(screen.getByLabelText(/^Lasts at most/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Lasts \(days\)/)).not.toBeInTheDocument();
  });
});

const IMPACT: YearImpact = {
  content_hash: "a".repeat(64),
  diff: [{ calendar_code: "INDIA_NATIONAL_2026", date: "2027-01-26", change: "added", name: "Republic Day" }],
  changed_dates: ["2027-01-26"],
  people: { employees: 3, by_branch: { "Bengaluru Office": 3 } },
  leave: { approved_requests: 1, dates: 1, units: "1.00", pending_requests: 0 },
  payroll: { locked_periods: [] },
  errors: [],
  warnings: [
    { code: "HOLIDAYS_COVER_ALL_WORKING_DAYS", confirm: true, severity: "warning", message: "Weekly period 1 Mar – 7 Mar has no working days left." },
    { code: "PROVISIONAL_DATES", confirm: false, severity: "info", message: "1 expected date" },
  ],
  holidays: { own: 1, expected: 0 },
};

function yearView(extra: Partial<YearView> = {}): YearView {
  return {
    calendar_id: 7,
    year: 2027,
    status: "DRAFT",
    version: 0,
    content_hash: null,
    published_at: null,
    published_by: null,
    approved_by: null,
    generated_at: null,
    row_version: 1,
    pending_request: null,
    calendar_code: "INDIA_NATIONAL_2026",
    calendar_name: "India National 2026",
    local_today: TODAY,
    backdate_days: 7,
    window_start: "2026-10-26",
    items: [],
    working_days: [],
    notes: [],
    summary: { own: 1, inherited: 0, expected: 0, cancelled: 0, rules: 1 },
    can_manage: true,
    can_publish: true,
    requires_second_person: false,
    current_content_hash: "a".repeat(64),
    ...extra,
  };
}

describe("publish panel", () => {
  it("labels the primary action for one and two publishers", () => {
    const pending = { requested_by_user_id: 1, requested_by: "Ananya", requested_at: null, content_hash: "x", kind: "PUBLISH" as const, operations: [], reason: null };
    expect(primaryAction(yearView(), "publish", 1)).toEqual({ label: "Publish 2027", allowed: true });
    expect(primaryAction(yearView({ requires_second_person: true }), "publish", 1)).toEqual({ label: "Request publication", allowed: true });
    expect(primaryAction(yearView({ requires_second_person: true, pending_request: pending }), "publish", 1).allowed).toBe(false);
    expect(primaryAction(yearView({ requires_second_person: true, pending_request: pending }), "publish", 2)).toEqual({ label: "Approve publication", allowed: true });
    expect(primaryAction(yearView({ pending_request: { ...pending, kind: "AMEND" } }), "approve-amendment", 2).label).toBe("Approve change");
    expect(missingAcknowledgements(IMPACT, new Set())).toEqual(["HOLIDAYS_COVER_ALL_WORKING_DAYS"]);
    expect(missingAcknowledgements(IMPACT, new Set(["HOLIDAYS_COVER_ALL_WORKING_DAYS"]))).toEqual([]);
  });

  it("runs the dry run, waits for the confirm-warning and publishes with the reviewed hash", async () => {
    signIn({ [P.HOLIDAY_PUBLISH]: ["COMPANY"] }, 1);
    api.publish.mockImplementation((_c, _y, body) =>
      Promise.resolve(
        body.dry_run
          ? { dry_run: true, impact: IMPACT, year: yearView(), requires_second_person: false }
          : { dry_run: false, status: "PUBLISHED", impact: IMPACT, year: yearView({ status: "PUBLISHED", version: 1 }), requires_second_person: false },
      ),
    );
    const onDone = jest.fn();
    render(<PublishYearPanel calendarId={7} year={yearView()} onDone={onDone} onCancel={jest.fn()} />);
    expect(await screen.findByTestId("impact-people")).toHaveTextContent("3");
    expect(screen.getByTestId("impact-diff")).toHaveTextContent("Tue 26 Jan 2027Republic Day");
    const publish = screen.getByTestId("publish-confirm");
    expect(publish).toBeDisabled();
    fireEvent.click(screen.getByTestId("ack-HOLIDAYS_COVER_ALL_WORKING_DAYS"));
    expect(publish).toBeEnabled();
    fireEvent.change(screen.getByTestId("publish-reason"), { target: { value: "Annual list approved" } });
    fireEvent.click(publish);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.publish).toHaveBeenLastCalledWith(7, 2027, {
      acknowledged_warnings: ["HOLIDAYS_COVER_ALL_WORKING_DAYS"],
      note: undefined,
      reason: "Annual list approved",
      content_hash: "a".repeat(64),
    });
  });

  it("re-runs the review when the year changed in between (409)", async () => {
    signIn({ [P.HOLIDAY_PUBLISH]: ["COMPANY"] }, 1);
    const calm = { ...IMPACT, warnings: [] };
    api.publish
      .mockResolvedValueOnce({ dry_run: true, impact: calm, year: yearView(), requires_second_person: false })
      .mockRejectedValueOnce(new HolidayApiError(409, "changed", "ROW_VERSION_CONFLICT"))
      .mockResolvedValueOnce({ dry_run: true, impact: calm, year: yearView(), requires_second_person: false });
    render(<PublishYearPanel calendarId={7} year={yearView()} onDone={jest.fn()} onCancel={jest.fn()} />);
    fireEvent.click(await screen.findByTestId("publish-confirm"));
    await waitFor(() => expect(api.publish).toHaveBeenCalledTimes(3));
    expect(api.publish.mock.calls[2][2]).toEqual({ dry_run: true });
  });

  it("does not let the requester approve their own request", async () => {
    signIn({ [P.HOLIDAY_PUBLISH]: ["COMPANY"] }, 1);
    api.publish.mockResolvedValue({ dry_run: true, impact: { ...IMPACT, warnings: [] }, year: yearView(), requires_second_person: true });
    const pending = { requested_by_user_id: 1, requested_by: "HR", requested_at: null, content_hash: "x", kind: "PUBLISH" as const, operations: [], reason: null };
    render(<PublishYearPanel calendarId={7} year={yearView({ requires_second_person: true, pending_request: pending })} onDone={jest.fn()} onCancel={jest.fn()} />);
    const button = await screen.findByTestId("publish-confirm");
    await waitFor(() => expect(button).toHaveTextContent("Awaiting approval by another publisher"));
    expect(button).toBeDisabled();
    expect(screen.getByText("Withdraw request")).toBeInTheDocument();
  });
});
