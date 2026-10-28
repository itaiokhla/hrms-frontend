/** Employee holiday calendar of /holidays (LH-M1 Goal 4; 09-ui-ux/02 §16, LH 05 §3.6, LH-TZ-04). */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { HolidayLegend } from "@/components/holiday/HolidayLegend";
import { HolidayYearGrid, describeDay } from "@/components/holiday/HolidayYearGrid";
import { MyHolidayCalendar } from "@/components/holiday/MyHolidayCalendar";
import { dayMarksApi, markKind, type DayHoliday, type DayMark, type MyCalendar } from "@/lib/holiday/api";

jest.mock("@/lib/holiday/api", () => {
  const actual = jest.requireActual("@/lib/holiday/api");
  return { ...actual, dayMarksApi: { me: jest.fn(), employee: jest.fn() } };
});
const api = dayMarksApi as jest.Mocked<typeof dayMarksApi>;

const pad = (n: number) => String(n).padStart(2, "0");

function yearOf(year: number, weekend: number[], marks: Record<string, Partial<DayMark>> = {}): DayMark[] {
  const out: DayMark[] = [];
  for (let t = Date.UTC(year, 0, 1); t <= Date.UTC(year, 11, 31); t += 86400000) {
    const d = new Date(t);
    const date = `${year}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const weekday = (d.getUTCDay() + 6) % 7;
    const off = weekend.includes(weekday);
    out.push({
      date, weekday, employed: true, timezone: "Asia/Kolkata", calendar_id: 1, calendar_source: "BRANCH_LINK", work_week_id: 1,
      weekly_off: off, weekly_off_portion: off ? "FULL" : "NONE", declared_working_day: false,
      working_portion: off ? "NONE" : "FULL", working: !off, scheduled_minutes: off ? 0 : 480, observed_elsewhere: null,
      holiday: null, leave: [], ...marks[date],
    });
  }
  return out;
}

const holiday = (name: string, extra: Partial<DayHoliday> = {}): DayHoliday => ({
  id: 1, name, type: "PUBLIC", category: "NATIONAL", portion: "FULL", status: "CONFIRMED", observance: "ORIGINAL",
  observed_from_date: null, non_working: true, ...extra,
});

describe("markKind", () => {
  const base = yearOf(2027, [5, 6])[0];
  it("ranks holiday kinds over leave, declared working days and weekly offs", () => {
    expect(markKind({ ...base, holiday: holiday("Republic Day") })).toBe("public");
    expect(markKind({ ...base, holiday: holiday("Founders", { type: "COMPANY" }) })).toBe("company");
    expect(markKind({ ...base, holiday: holiday("Onam", { type: "OPTIONAL_NOT_AVAILED", non_working: false }) })).toBe("optional");
    expect(markKind({ ...base, holiday: holiday("Onam", { type: "OPTIONAL_AVAILED" }) })).toBe("optional-chosen");
    expect(markKind({ ...base, holiday: holiday("Eve", { type: "COMPANY", portion: "SECOND_HALF" }) })).toBe("half");
    expect(markKind({ ...base, holiday: holiday("Eid al-Fitr", { status: "PROVISIONAL" }) })).toBe("provisional");
    expect(markKind({ ...base, leave: [{ leave_id: 1, portion: "FULL", status: "APPROVED", charged_units: "1.00", label: "Casual" }] })).toBe("leave");
    expect(markKind({ ...base, leave: [{ leave_id: 1, portion: "FULL", status: "PENDING", charged_units: null, label: "Casual" }] })).toBe("work");
    expect(markKind({ ...base, weekly_off: true, declared_working_day: true })).toBe("working-day");
    expect(markKind({ ...base, weekly_off: true })).toBe("weekly-off");
    expect(markKind({ ...base, employed: false, holiday: holiday("x") })).toBe("none");
  });
  it("describes a day with its holiday, observance and leave", () => {
    const d = { ...base, date: "2027-07-05", weekday: 0, holiday: holiday("Independence Day", { observance: "OBSERVED", observed_from_date: "2027-07-04" }) };
    expect(describeDay(d)).toBe("5 July 2027, Monday · Public holiday · Independence Day · observed for 2027-07-04");
  });
});

describe("HolidayYearGrid", () => {
  it("renders twelve months starting on Monday for a Saturday-Sunday weekend with Republic Day as public", () => {
    const days = yearOf(2027, [5, 6], { "2027-01-26": { holiday: holiday("Republic Day") } });
    render(<HolidayYearGrid year={2027} days={days} weekStart={0} weekend={[5, 6]} localToday="2027-01-10" />);
    const grid = screen.getByTestId("holiday-year-grid");
    expect(within(grid).getAllByRole("grid")).toHaveLength(12);
    const january = screen.getByTestId("month-2027-01");
    const headers = within(january).getAllByTestId("weekday-header");
    expect(headers.map((h) => h.textContent)).toEqual(["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]);
    expect(headers.filter((h) => h.dataset.weekend === "true").map((h) => h.textContent)).toEqual(["Sa", "Su"]);
    // 1 January 2027 is a Friday: column 4 of a Monday-first week.
    expect(screen.getByTestId("day-2027-01-01")).toHaveAttribute("data-col", "4");
    const republic = screen.getByTestId("day-2027-01-26");
    expect(republic).toHaveAttribute("data-kind", "public");
    expect(republic).toHaveAccessibleName(/Public holiday · Republic Day/);
    expect(screen.getByTestId("day-2027-01-10")).toHaveAttribute("data-today", "true");
    expect(screen.getByTestId("day-2027-01-02")).toHaveAttribute("data-kind", "weekly-off");
    expect(within(screen.getByTestId("month-holidays-2027-01")).getByText("Republic Day")).toBeInTheDocument();
    expect(screen.getAllByText("Republic Day")).toHaveLength(1);
  });

  it("starts the week on Sunday and highlights Friday and Saturday for a Gulf weekend", () => {
    render(<HolidayYearGrid year={2027} days={yearOf(2027, [4, 5])} weekStart={6} weekend={[4, 5]} localToday="2027-03-01" />);
    const march = screen.getByTestId("month-2027-03");
    const headers = within(march).getAllByTestId("weekday-header");
    expect(headers.map((h) => h.textContent)).toEqual(["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]);
    expect(headers.filter((h) => h.dataset.weekend === "true").map((h) => h.getAttribute("aria-label"))).toEqual(["Friday", "Saturday"]);
    // 5 March 2027 is a Friday: column 5 of a Sunday-first week, inside the weekend columns.
    expect(screen.getByTestId("day-2027-03-05")).toHaveAttribute("data-col", "5");
    expect(screen.getByTestId("day-2027-03-05")).toHaveAttribute("data-weekend", "true");
    expect(screen.getByTestId("day-2027-03-07")).toHaveAttribute("data-weekend", "false");
  });

  it("reports the selected date", () => {
    const onSelect = jest.fn();
    render(<HolidayYearGrid year={2027} days={yearOf(2027, [5, 6])} weekStart={0} weekend={[5, 6]} localToday="2027-01-01" onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("day-2027-08-15"));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ date: "2027-08-15" }));
  });
});

describe("HolidayLegend", () => {
  it("names every badge kind with a text code", () => {
    render(<HolidayLegend />);
    for (const label of ["Public holiday", "Company holiday", "Optional holiday", "Half-day holiday", "Weekly off", "Declared working day", "On leave"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByTestId("holiday-legend").querySelector('[data-legend="half"]')).toHaveTextContent("◐H");
  });
});

describe("MyHolidayCalendar", () => {
  const year = new Date().getFullYear();
  const calendar = (overrides: Partial<MyCalendar> = {}): MyCalendar => ({
    employee_id: 4, local_today: `${year}-03-01`, timezone: "Asia/Dubai", weekend: [4, 5], week_start: 6,
    from: `${year}-01-01`, to: `${year}-12-31`,
    calendars: [{ id: 3, from: `${year}-01-01`, to: `${year}-12-31`, code: "BETA_AE", name: "Beta UAE", years: { [year]: { status: "PUBLISHED", version: 2 } } }],
    work_weeks: [{ id: 2, from: `${year}-01-01`, to: `${year}-12-31` }],
    days: yearOf(year, [4, 5], {
      [`${year}-01-01`]: { holiday: holiday("New Year's Day", { type: "COMPANY" }) },
      [`${year}-12-02`]: { holiday: holiday("UAE National Day") },
    }),
    ...overrides,
  });

  beforeEach(() => jest.clearAllMocks());

  it("loads the viewer's year and shows calendar, weekly off and local today", async () => {
    api.me.mockResolvedValue(calendar());
    render(<MyHolidayCalendar />);
    expect(await screen.findByTestId("holiday-year-grid")).toHaveAttribute("data-week-start", "6");
    expect(api.me).toHaveBeenCalledWith(`${year}-01-01`, `${year}-12-31`);
    expect(screen.getByText("Beta UAE")).toBeInTheDocument();
    expect(screen.getByText("Published · v2")).toBeInTheDocument();
    expect(screen.getByTestId("weekly-off-line")).toHaveTextContent("Weekly off: Friday & Saturday");
    expect(screen.getByText(/Asia\/Dubai/)).toBeInTheDocument();
  });

  it("opens a day panel and switches to the upcoming list with a Next badge", async () => {
    api.me.mockResolvedValue(calendar());
    render(<MyHolidayCalendar />);
    fireEvent.click(await screen.findByTestId(`day-${year}-12-02`));
    expect(within(screen.getByTestId("day-panel")).getByText("UAE National Day")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Upcoming" }));
    const list = await screen.findByTestId("holiday-list");
    expect(within(list).queryByText("New Year's Day")).toBeNull();
    const item = within(list).getByTestId(`list-${year}-12-02`);
    expect(item).toHaveTextContent("Next");
    fireEvent.click(within(list).getByRole("checkbox"));
    expect(within(list).getByText("New Year's Day")).toBeInTheDocument();
  });

  it("LH-UX-28: a holiday on a weekly off shows the employee's substitute day in the list and the grid", async () => {
    api.me.mockResolvedValue(calendar({
      local_today: `${year}-08-01`,
      days: yearOf(year, [4, 5], {
        [`${year}-08-14`]: { holiday: holiday("National Day") },
        [`${year}-08-16`]: { holiday: holiday("National Day", { observance: "EMPLOYEE_SUBSTITUTE", observed_from_date: `${year}-08-14` }) },
      }),
    }));
    render(<MyHolidayCalendar />);
    expect(await screen.findByTestId(`day-${year}-08-16`)).toHaveAccessibleName(new RegExp(`substitute for ${year}-08-14`));
    fireEvent.click(screen.getByRole("radio", { name: "Upcoming" }));
    const list = await screen.findByTestId("holiday-list");
    expect(within(list).getByTestId(`list-${year}-08-16`)).toHaveTextContent("Your substitute day");
    expect(within(list).getByTestId(`list-${year}-08-14`)).toHaveTextContent("On a weekly off");
  });

  it("explains a missing calendar and moves between years", async () => {
    api.me.mockResolvedValue(calendar({ calendars: [{ id: null, from: "", to: "", code: null, name: null, years: {} }] }));
    render(<MyHolidayCalendar />);
    expect(await screen.findByText("No holiday calendar applies to you yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next year" }));
    await waitFor(() => expect(api.me).toHaveBeenLastCalledWith(`${year + 1}-01-01`, `${year + 1}-12-31`));
  });
});
