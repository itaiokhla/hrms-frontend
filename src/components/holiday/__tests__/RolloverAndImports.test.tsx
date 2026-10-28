/** Next year review, emergency closure and import wizard (LH-M1 Goal 5; 04-holiday/02 §8-§10, 01 §5.8). */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { BackdatedClosureModal } from "@/components/holiday/BackdatedClosureModal";
import { HolidayImportWizard } from "@/components/holiday/HolidayImportWizard";
import { importsApi, rolloverApi, type ClosureResult, type HolidayImport } from "@/lib/holiday/api";

jest.mock("react-hot-toast", () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));
jest.mock("@/lib/holiday/api", () => {
  const actual = jest.requireActual("@/lib/holiday/api");
  return {
    ...actual,
    rolloverApi: { overview: jest.fn(), generate: jest.fn(), diff: jest.fn(), closure: jest.fn() },
    importsApi: { ...actual.importsApi, check: jest.fn(), commit: jest.fn(), get: jest.fn(), list: jest.fn() },
  };
});
const rollover = rolloverApi as jest.Mocked<typeof rolloverApi>;
const imports = importsApi as jest.Mocked<typeof importsApi>;

beforeEach(() => jest.clearAllMocks());

const impact = (locked = false): ClosureResult => ({
  dry_run: true,
  hint: "Not paid? Record unpaid leave for the affected employees instead.",
  impact: { warnings: [{ code: "HOLIDAY_ON_WEEKEND", confirm: true, severity: "warning", message: "w" }] } as never,
  closure: {
    date: "2026-11-04",
    totals: { employees: 2, scheduled: 2, on_shift: 1, attendance_sessions: 1, approved_leave: 1, pending_leave: 0, input_locked: 0, finalized: locked ? 2 : 0 },
    employees: [
      { employee_id: 3, name: "Asha Pillai", scheduled: true, working_portion: "FULL", shift: "General", scheduled_minutes: 480, attendance_session: true, approved_leave_ids: [], pending_leave: false, period_state: locked ? "FINALIZED" : "OPEN" },
      { employee_id: 4, name: "Vikram Rao", scheduled: true, working_portion: "FULL", shift: null, scheduled_minutes: 480, attendance_session: false, approved_leave_ids: [9], pending_leave: false, period_state: "OPEN" },
    ],
    requires_typed_confirm: locked,
  },
});

function closureModal(onRecorded = jest.fn()) {
  render(
    <BackdatedClosureModal open onOpenChange={jest.fn()} calendars={[{ calendar_id: 7, code: "BLR", name: "Bengaluru" }]} defaultCalendarId={7} today="2026-11-05" onRecorded={onRecorded} />,
  );
  return onRecorded;
}

describe("BackdatedClosureModal", () => {
  it("needs a reason, previews the impact and records the closure", async () => {
    const onRecorded = closureModal();
    const check = screen.getByTestId("closure-check");
    fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: "2026-11-04" } });
    expect(check).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^Emergency reason/), { target: { value: "Flooding" } });
    expect(check).toBeEnabled();
    expect(screen.getByLabelText(/^Date/)).toHaveAttribute("min", "2026-10-29");
    expect(screen.getByLabelText(/^Date/)).toHaveAttribute("max", "2026-11-05");
    rollover.closure.mockResolvedValueOnce(impact());
    fireEvent.click(check);
    const totals = await screen.findByTestId("closure-totals");
    expect(rollover.closure).toHaveBeenCalledWith(7, expect.objectContaining({ date: "2026-11-04", reason: "Flooding", dry_run: true, category: "EMERGENCY" }));
    expect(totals).toHaveTextContent("2 were scheduled to work (1 on a shift)");
    expect(totals).toHaveTextContent("1 approved leave request(s) credited back");
    expect(within(screen.getByTestId("closure-employee-3")).getByText("General")).toBeInTheDocument();
    rollover.closure.mockResolvedValueOnce({ ...impact(), dry_run: false, status: "AMENDED" });
    fireEvent.click(screen.getByTestId("closure-confirm"));
    await waitFor(() => expect(onRecorded).toHaveBeenCalledWith(7, "2026-11-04", expect.anything()));
    expect(rollover.closure).toHaveBeenLastCalledWith(7, expect.objectContaining({ acknowledged_warnings: ["HOLIDAY_ON_WEEKEND"] }));
  });

  it("asks for the typed date when a locked or finalized pay period is affected", async () => {
    closureModal();
    fireEvent.change(screen.getByLabelText(/^Emergency reason/), { target: { value: "Power cut" } });
    rollover.closure.mockResolvedValueOnce(impact(true));
    fireEvent.click(screen.getByTestId("closure-check"));
    const typed = await screen.findByTestId("closure-typed");
    expect(screen.getByTestId("closure-confirm")).toBeDisabled();
    fireEvent.change(typed, { target: { value: "2026-11-05" } });
    expect(screen.getByTestId("closure-confirm")).toBeEnabled();
    expect(screen.getAllByText("Finalized").length).toBeGreaterThan(0);
  });
});

const report = (overrides: Partial<HolidayImport> = {}): HolidayImport => ({
  id: 11, calendar_id: 7, kind: "CSV_DATED", target_year: 2027, status: "DRY_RUN", file_name: "h.csv", target_hash: "abc", row_version: 1,
  created_at: null, committed_at: null, summary: { NEW: 2, ERROR: 1, lines: 3 }, year_status: "DRAFT", source_label: null,
  ignored_properties: [], ignored_columns: [], result: null,
  lines: [
    { line: 2, kind: "DATED", values: { name: "Republic Day", date: "2027-01-26" }, errors: [], warnings: [], classification: "NEW", action: "ACCEPT" },
    { line: 3, kind: "DATED", values: { name: "Independence Day", date: "2027-08-15" }, errors: [], warnings: [], classification: "NEW", action: "ACCEPT" },
    { line: 4, kind: "DATED", values: { name: "Bad", date: null }, errors: [{ field: "date", message: "'15/09/2027' is not a YYYY-MM-DD date." }], warnings: [], classification: "ERROR", action: "SKIP" },
  ],
  ...overrides,
});

describe("HolidayImportWizard", () => {
  it("checks the file, shows line errors, lets lines be skipped and commits the accepted ones", async () => {
    const onDone = jest.fn();
    render(<HolidayImportWizard calendarId={7} calendarCode="BLR" defaultYear={2027} localYear={2026} onDone={onDone} onCancel={jest.fn()} />);
    const file = new File(["date,name\n"], "h.csv", { type: "text/csv" });
    fireEvent.change(screen.getByTestId("import-file"), { target: { files: [file] } });
    imports.check.mockResolvedValueOnce(report());
    fireEvent.click(screen.getByTestId("import-check"));
    expect(await screen.findByTestId("import-summary")).toHaveTextContent("New · 2");
    expect(imports.check).toHaveBeenCalledWith(7, "CSV_DATED", 2027, file);
    expect(screen.getByTestId("import-line-4")).toHaveTextContent("is not a YYYY-MM-DD date");
    expect(within(screen.getByTestId("import-line-4")).getByRole("checkbox")).toBeDisabled();
    expect(screen.getByTestId("import-commit")).toHaveTextContent("Import 2 lines");
    fireEvent.click(within(screen.getByTestId("import-line-3")).getByRole("checkbox"));
    expect(screen.getByTestId("import-commit")).toHaveTextContent("Import 1 line");
    imports.commit.mockResolvedValueOnce({ ...report({ status: "COMMITTED", result: { accepted: 1, rules_created: 0, rows_created: 1, operations: 1, amendment_status: null } }), amendment: null });
    fireEvent.click(screen.getByTestId("import-commit"));
    expect(await screen.findByTestId("import-done")).toHaveTextContent("1 holiday(s) and 0 repeating rule(s) imported into 2027");
    expect(imports.commit).toHaveBeenCalledWith(7, 11, expect.objectContaining({
      decisions: [{ line: 2, action: "ACCEPT" }, { line: 3, action: "SKIP" }, { line: 4, action: "SKIP" }], target_hash: "abc",
    }));
    expect(onDone).toHaveBeenCalled();
  });

  it("asks for a reason when the year is published", async () => {
    render(<HolidayImportWizard calendarId={7} calendarCode="BLR" defaultYear={2027} localYear={2026} onDone={jest.fn()} onCancel={jest.fn()} />);
    fireEvent.change(screen.getByTestId("import-file"), { target: { files: [new File(["x"], "h.csv")] } });
    imports.check.mockResolvedValueOnce(report({ year_status: "PUBLISHED" }));
    fireEvent.click(screen.getByTestId("import-check"));
    await screen.findByTestId("import-summary");
    expect(screen.getByTestId("import-commit")).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Reason for changing the published year/), { target: { value: "State notice" } });
    expect(screen.getByTestId("import-commit")).toBeEnabled();
  });
});
