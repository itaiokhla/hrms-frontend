/** AS-M5 WI-AS-5.5: the Roster Grid's palette, click-to-assign and drag-and-drop produce the right draft cells (§13). */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";

import type { RosterEmployee, RosterShift, RuleResult } from "@/components/rosters/api";
import { RosterGrid } from "@/components/rosters/RosterGrid";
import { buildCells, periodDates, resultsByCell, toDraftCells, type PaletteValue } from "@/components/rosters/rosterModel";

const employees: RosterEmployee[] = [
  { id: 7, name: "Asha Rao", employee_code: "E7" },
  { id: 8, name: "Vikram Iyer", employee_code: "E8" },
];
const shifts: RosterShift[] = [
  { id: 5, code: "M1", name: "Morning", color_token: "shift-2", start_time: "06:00", end_time: "14:00", status: "ACTIVE" },
  { id: 6, code: "N1", name: "Night", color_token: "shift-5", start_time: "22:00", end_time: "06:00", status: "ACTIVE" },
  { id: 4, code: "OLD", name: "Retired", color_token: "shift-12", start_time: "09:00", end_time: "17:00", status: "ARCHIVED" },
];
// Sat 31 Oct – Tue 3 Nov 2026.
const dates = periodDates("2026-10-31", "2026-11-03");
const published = {
  id: 1, employee_id: 7, shift_date: "2026-11-02", entry_seq: 1, kind: "WORK" as const, shift_id: 5, shift_version_id: 50,
  custom_start_time: null, custom_end_time: null, site_id: null, planned_work_mode: null, version: 1, source: "MANUAL",
  roster_period_id: 3, publication_id: 9, published_at: "2026-10-20T10:00:00+00:00", acknowledged_at: null, note: null,
};
const drafted = {
  id: 2, employee_id: 8, shift_date: "2026-11-02", entry_seq: 1, action: "UPSERT" as const, kind: "WORK" as const, shift_id: 6,
  custom_start_time: null, custom_end_time: null, site_id: null, planned_work_mode: null, source: "MANUAL",
  base_entry_id: null, base_entry_version: null, note: null,
};
const cells = buildCells([published, { ...published, id: 3, shift_date: "2026-11-03", kind: "OFF", shift_id: null }], [drafted]);

function Harness({ onChange, readOnly, results }: { onChange: jest.Mock; readOnly?: boolean; results?: RuleResult[] }) {
  const [pending, setPending] = useState<Map<string, PaletteValue>>(new Map());
  return (
    <RosterGrid employees={employees} dates={dates} cells={cells} shifts={shifts} pending={pending} readOnly={readOnly}
      results={resultsByCell(results)}
      onPendingChange={(next) => { onChange(next); setPending(next); }} />
  );
}

const cell = (name: string) => screen.getByRole("button", { name });
const lastCells = (onChange: jest.Mock) => toDraftCells(onChange.mock.calls[onChange.mock.calls.length - 1][0]);

/** A shared stand-in for the browser's DataTransfer (jsdom has none). */
function transfer() {
  const store: Record<string, string> = {};
  return { setData: (type: string, value: string) => { store[type] = value; }, getData: (type: string) => store[type] ?? "",
    effectAllowed: "", dropEffect: "" };
}

describe("RosterGrid", () => {
  it("lays out employees by date with weekend shading, solid published cells, Draft and Off cells", () => {
    render(<Harness onChange={jest.fn()} />);
    const grid = screen.getByTestId("roster-grid");
    expect(within(grid).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Employee", "Sat31 Oct", "Sun1 Nov", "Mon2 Nov", "Tue3 Nov"]);
    expect(within(grid).getAllByRole("columnheader")[1]).toHaveAttribute("data-weekend", "true");
    expect(within(grid).getAllByRole("columnheader")[3]).not.toHaveAttribute("data-weekend");
    expect(within(grid).getByRole("rowheader", { name: /Asha Rao/ })).toBeInTheDocument();
    expect(cell("Asha Rao, Mon 2 Nov 2026: M1")).toHaveAttribute("data-state", "published");
    expect(cell("Asha Rao, Tue 3 Nov 2026: Off")).toHaveTextContent("Off");
    const draft = cell("Vikram Iyer, Mon 2 Nov 2026: N1 (draft)");
    expect(draft).toHaveAttribute("data-state", "draft");
    expect(draft).toHaveTextContent("Draft");
    expect(cell("Asha Rao, Sat 31 Oct 2026: No shift")).toHaveAttribute("data-state", "empty");
  });

  it("offers one palette chip per active shift plus Off and Clear", () => {
    render(<Harness onChange={jest.fn()} />);
    const palette = screen.getByRole("toolbar", { name: "Shift palette" });
    expect(within(palette).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["M1 – Morning", "N1 – Night", "Off", "Clear"]);
    expect(screen.getByTestId("palette-shift-M1")).toHaveAttribute("draggable", "true");
  });

  it("click-to-assign: select a chip, then click cells; the edits become UPSERT / DELETE draft cells", () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(cell("Asha Rao, Sat 31 Oct 2026: No shift"));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("grid-announcer")).toHaveTextContent("Pick a shift, Off or Clear in the palette first");

    fireEvent.click(screen.getByRole("button", { name: "N1 – Night" }));
    expect(screen.getByRole("button", { name: "N1 – Night" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(cell("Asha Rao, Sat 31 Oct 2026: No shift"));
    fireEvent.click(cell("Vikram Iyer, Sun 1 Nov 2026: No shift"));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    fireEvent.click(cell("Asha Rao, Mon 2 Nov 2026: M1"));

    expect(lastCells(onChange)).toEqual([
      { employee_id: 7, shift_date: "2026-10-31", entry_seq: 1, action: "UPSERT", kind: "WORK", shift_id: 6 },
      { employee_id: 7, shift_date: "2026-11-02", entry_seq: 1, action: "DELETE" },
      { employee_id: 8, shift_date: "2026-11-01", entry_seq: 1, action: "UPSERT", kind: "WORK", shift_id: 6 },
    ]);
    const edited = cell("Asha Rao, Sat 31 Oct 2026: N1 (unsaved)");
    expect(edited).toHaveAttribute("data-state", "pending");
    expect(edited).toHaveTextContent("Unsaved");
    expect(cell("Asha Rao, Mon 2 Nov 2026: No shift (unsaved)")).toBeInTheDocument();
  });

  it("drag-and-drop: dropping a palette chip on a cell assigns it", () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);
    const data = transfer();
    fireEvent.dragStart(screen.getByTestId("palette-off"), { dataTransfer: data });
    const target = cell("Vikram Iyer, Mon 2 Nov 2026: N1 (draft)");
    fireEvent.dragOver(target, { dataTransfer: data });
    fireEvent.drop(target, { dataTransfer: data });
    expect(lastCells(onChange)).toEqual([{ employee_id: 8, shift_date: "2026-11-02", entry_seq: 1, action: "UPSERT", kind: "OFF" }]);

    const again = transfer();
    fireEvent.dragStart(screen.getByTestId("palette-shift-M1"), { dataTransfer: again });
    fireEvent.drop(cell("Vikram Iyer, Tue 3 Nov 2026: No shift"), { dataTransfer: again });
    expect(lastCells(onChange)).toEqual([
      { employee_id: 8, shift_date: "2026-11-02", entry_seq: 1, action: "UPSERT", kind: "OFF" },
      { employee_id: 8, shift_date: "2026-11-03", entry_seq: 1, action: "UPSERT", kind: "WORK", shift_id: 5 },
    ]);
    expect(cell("Vikram Iyer, Mon 2 Nov 2026: Off (unsaved)")).toBeInTheDocument();
  });

  it("read-only: no palette, and cells ignore clicks and drops", () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} readOnly />);
    expect(screen.queryByRole("toolbar", { name: "Shift palette" })).toBeNull();
    const target = cell("Asha Rao, Sat 31 Oct 2026: No shift");
    fireEvent.click(target);
    fireEvent.drop(target, { dataTransfer: { getData: () => "off" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(target).toHaveAttribute("aria-disabled", "true");
  });

  it("badges the cells a validation result names", () => {
    render(<Harness onChange={jest.fn()} results={[
      { rule_key: "MIN_REST_VIOLATION", severity: "BLOCK", employee_id: 7, dates: ["2026-11-02"], measured: "8", limit: "11", unit: "HOURS" },
      { rule_key: "UNAVAILABLE", severity: "WARN", employee_id: 7, dates: ["2026-11-02"] },
    ]} />);
    const flagged = cell("Asha Rao, Mon 2 Nov 2026: M1, 2 issues");
    const badge = within(flagged).getByTestId("cell-issue-7-2026-11-02");
    expect(badge).toHaveTextContent("2");
    expect(badge).toHaveAttribute("data-severity", "BLOCK");
  });
});
