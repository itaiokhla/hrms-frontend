/** Work-week editor state, preview grid and editor (LH-M1 WI-1.12; 04-holiday/03 §3.2, §5.10; 09-ui-ux/02 §19). */
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { WorkWeekEditor } from "@/components/holiday/WorkWeekEditor";
import { WorkWeekPreview } from "@/components/holiday/WorkWeekPreview";
import { workWeeksApi, type Preview, type PreviewDay, type Rules, type Template } from "@/lib/holiday/api";
import {
  codeFromName,
  defaultEditor,
  fromRules,
  localProblems,
  monthRange,
  nextMonday,
  resizeCycle,
  shiftMonth,
  toRules,
} from "@/lib/holiday/workWeekRules";

jest.mock("react-hot-toast", () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));
jest.mock("@/lib/holiday/api", () => {
  const actual = jest.requireActual("@/lib/holiday/api");
  return { ...actual, workWeeksApi: { ...actual.workWeeksApi, preview: jest.fn(), create: jest.fn(), addVersion: jest.fn() } };
});

const NTH: Rules = { weekly_off_days: [6], nth_weekday_offs: [{ weekday: 5, nth: [2, 4] }] };
const ALT: Rules = { kind: "CYCLE", cycle_length_days: 14, anchor_date: "2027-01-04", cycle_off_days: [6, 12, 13] };

/** January 2027 under MON_SAT_2ND_4TH_SAT_OFF, as the server's preview returns it. */
function january(): PreviewDay[] {
  const out: PreviewDay[] = [];
  for (let d = 1; d <= 31; d++) {
    const date = `2027-01-${String(d).padStart(2, "0")}`;
    const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
    const occurrence = Math.floor((d - 1) / 7) + 1;
    const off = weekday === 6 || (weekday === 5 && (occurrence === 2 || occurrence === 4));
    out.push({ date, weekday, portion: off ? "FULL" : null, rest_day: off, cycle_day: null, occurrence, in_effect: true, changed: false, previous_portion: null });
  }
  return out;
}

describe("work-week rules <-> form state", () => {
  it("round-trips nth, cycle and half-day rules", () => {
    expect(toRules(fromRules(NTH, "2027-01-01"))).toEqual(NTH);
    expect(toRules(fromRules(ALT, "2027-01-01"))).toEqual(ALT);
    const half: Rules = { kind: "WEEKLY", weekly_off_days: [6], nth_weekday_offs: [], half_day_offs: [{ weekday: 5, portion: "SECOND_HALF" }] };
    expect(toRules(fromRules(half, "2027-01-01"))).toEqual(half);
  });

  it("starts as Monday to Friday and serialises like the legacy two-key shape", () => {
    expect(toRules(defaultEditor("2027-01-01"))).toEqual({ weekly_off_days: [5, 6], nth_weekday_offs: [] });
  });

  it("finds local problems, anchors, codes and month ranges", () => {
    const all = defaultEditor("2027-01-01");
    all.weekdays.forEach((d) => (d.mode = "OFF"));
    expect(localProblems(all)).toEqual(["A work week needs at least one working day."]);
    expect(nextMonday("2027-01-01")).toBe("2027-01-04");
    expect(nextMonday("2027-01-04")).toBe("2027-01-04");
    expect(codeFromName("Pune Factory Schedule")).toBe("PUNE_FACTORY_SCHEDULE");
    expect(monthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthRange("2027-02")).toEqual({ from: "2027-02-01", to: "2027-02-28" });
    expect(shiftMonth("2027-12", 1)).toBe("2028-01");
    expect(resizeCycle({ length: 3, anchor: "2027-01-04", cells: ["W", "O", "W"] }, 5).cells).toEqual(["W", "O", "W", "W", "W"]);
  });
});

describe("WorkWeekPreview", () => {
  it("shades weekly offs and labels the 2nd and 4th Saturdays (LH-WWK-05)", () => {
    const onMonthChange = jest.fn();
    render(<WorkWeekPreview month="2027-01" days={january()} onMonthChange={onMonthChange} />);
    expect(screen.getByTestId("ww-day-2027-01-09")).toHaveAttribute("data-portion", "FULL");
    expect(screen.getByTestId("ww-day-2027-01-23")).toHaveAttribute("data-portion", "FULL");
    for (const d of ["02", "16", "30"]) expect(screen.getByTestId(`ww-day-2027-01-${d}`)).toHaveAttribute("data-portion", "WORKING");
    expect(within(screen.getByTestId("ww-day-2027-01-09")).getByText("2nd")).toBeInTheDocument();
    expect(screen.getByTestId("ww-day-2027-01-23")).toHaveAccessibleName(/4th Saturday.*weekly off/);
    expect(screen.getByTestId("preview-totals")).toHaveTextContent("Working days: 24");
    expect(screen.getByTestId("preview-totals")).toHaveTextContent("Offs: 7");
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(onMonthChange).toHaveBeenCalledWith("2027-02");
  });

  it("half-shades half-day offs", () => {
    const days = january().map((d) => (d.weekday === 4 ? { ...d, portion: "SECOND_HALF" as const } : d));
    render(<WorkWeekPreview month="2027-01" days={days} onMonthChange={jest.fn()} />);
    expect(screen.getByTestId("ww-day-2027-01-01")).toHaveAttribute("data-portion", "SECOND_HALF");
    expect(screen.getByTestId("preview-totals")).toHaveTextContent("Half offs: 5");
  });
});

describe("WorkWeekEditor", () => {
  const templates: Template[] = [
    { code: "MON_SAT_2ND_4TH_SAT_OFF", name: "Monday to Saturday, 2nd and 4th Saturday off", kind: "WEEKLY", typical_use: "Banks", rules: NTH, summary: "Sun off; Sat 2nd/4th off", needs_half_day_offs: false, available: true, unavailable_reason: null },
    { code: "FRI_HALF", name: "Monday to Friday, Friday afternoon off", kind: "WEEKLY", typical_use: "UAE", rules: { ...NTH }, summary: "", needs_half_day_offs: true, available: false, unavailable_reason: "Available after half-day weekly offs are enabled" },
  ];
  const preview = (warnings = false): Preview => ({
    mode: "create", pattern_id: null, rules: NTH, summary: "Sun off; Sat 2nd/4th off", kind: "WEEKLY", effective_from: "2027-01-01",
    local_today: "2027-01-01", backdated: false, from: "2027-01-01", to: "2027-01-31", days: january(),
    totals: { days: 31, full_offs: 7, half_offs: 0, working_days: 24 },
    rest_check: { warnings: warnings ? [{ code: "WEEKLY_REST_EXCEEDED", rule: "R-2", start: "2027-03-29", end: "2027-04-08", count: 11, limit: 10, message: "Employees would work 11 days in a row" }] : [], violations: [] },
    half_day_offs_enabled: false, issues: [], no_change: false, impact: null,
  });

  beforeEach(() => {
    jest.useFakeTimers();
    (workWeeksApi.preview as jest.Mock).mockReset().mockResolvedValue(preview());
    (workWeeksApi.create as jest.Mock).mockReset();
  });
  afterEach(() => jest.useRealTimers());

  it("fills the rules from a template, previews and saves with code from the name", async () => {
    (workWeeksApi.create as jest.Mock).mockResolvedValue({ id: 9, name: "Pune Factory Schedule" });
    const onSaved = jest.fn();
    render(<WorkWeekEditor mode="create" templates={templates} entities={[]} today="2027-01-01" onSaved={onSaved} onCancel={jest.fn()} />);
    fireEvent.change(screen.getByTestId("template-select"), { target: { value: "MON_SAT_2ND_4TH_SAT_OFF" } });
    expect(screen.getByRole("option", { name: /Friday afternoon off/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Pune Factory Schedule" } });
    expect(screen.getByLabelText(/^Code/)).toHaveValue("PUNE_FACTORY_SCHEDULE");
    expect(within(screen.getByTestId("weekday-5")).getByLabelText("2nd Saturday off")).toBeChecked();
    expect(within(screen.getByTestId("weekday-5")).getByLabelText("4th Saturday off")).toBeChecked();
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    await waitFor(() => expect(workWeeksApi.preview).toHaveBeenCalled());
    expect((workWeeksApi.preview as jest.Mock).mock.calls.at(-1)[0]).toMatchObject({ rules: NTH, from: "2027-01-01", to: "2027-01-31" });
    await act(async () => {
      fireEvent.click(screen.getByTestId("work-week-save"));
    });
    expect(workWeeksApi.create).toHaveBeenCalledWith(expect.objectContaining({
      name: "Pune Factory Schedule", code: "PUNE_FACTORY_SCHEDULE", template_code: "MON_SAT_2ND_4TH_SAT_OFF", rules: NTH,
    }));
    expect(onSaved).toHaveBeenCalled();
  });

  it("asks to review weekly-rest warnings before saving", async () => {
    (workWeeksApi.preview as jest.Mock).mockResolvedValue(preview(true));
    render(<WorkWeekEditor mode="create" templates={templates} entities={[]} today="2027-01-01" onSaved={jest.fn()} onCancel={jest.fn()} />);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Plant" } });
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    await screen.findByTestId("rest-warnings");
    fireEvent.click(screen.getByTestId("work-week-save"));
    expect(await screen.findByText("Review the weekly-rest warnings and tick the box.")).toBeInTheDocument();
    expect(workWeeksApi.create).not.toHaveBeenCalled();
  });

  it("keeps half-day options disabled until half-day offs are enabled", () => {
    render(<WorkWeekEditor mode="create" templates={templates} entities={[]} today="2027-01-01" onSaved={jest.fn()} onCancel={jest.fn()} />);
    const monday = within(screen.getByTestId("weekday-0"));
    expect(monday.getByRole("radio", { name: "Half day off" })).toBeDisabled();
    expect(screen.getByText(/Half-day offs: available after/)).toBeInTheDocument();
  });
});
