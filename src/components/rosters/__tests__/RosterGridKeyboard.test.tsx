/** FU-AS-54: the Roster Grid's keyboard model (09-ui-ux/02 §8.4, WAI-ARIA APG grid) and axe. One tab stop that follows
 * focus; arrows (mirrored right to left), Home / End, Ctrl+Home / Ctrl+End and Page Up / Down (10 rows) move focus;
 * Enter, Space or F2 open the cell editor, Escape closes it and focus returns to the cell; with a palette chip selected
 * Enter paints the cell; a read-only grid navigates but never edits. */
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { useState } from "react";

import type { RosterEmployee, RosterShift } from "@/components/rosters/api";
import { RosterGrid } from "@/components/rosters/RosterGrid";
import { buildCells, periodDates, toDraftCells, type PaletteValue } from "@/components/rosters/rosterModel";

expect.extend(toHaveNoViolations);

// Twelve people so Page Down (10 rows) both moves and stops at the last row.
const NAMES = ["Asha Rao", "Vikram Iyer", "Meera Nair", "Kabir Shah", "Divya Menon", "Arjun Das", "Leela Pillai",
  "Rohan Gupta", "Sana Khan", "Tara Bose", "Imran Ali", "Zoya Mehta"];
const employees: RosterEmployee[] = NAMES.map((name, i) => ({ id: 101 + i, name, employee_code: `E${101 + i}` }));
const shifts: RosterShift[] = [
  { id: 5, code: "M1", name: "Morning", color_token: "shift-2", start_time: "06:00", end_time: "14:00", status: "ACTIVE" },
  { id: 6, code: "N1", name: "Night", color_token: "shift-5", start_time: "22:00", end_time: "06:00", status: "ACTIVE" },
];
// Sat 31 Oct – Tue 3 Nov 2026.
const dates = periodDates("2026-10-31", "2026-11-03");
const cells = buildCells([{
  id: 1, employee_id: 101, shift_date: "2026-11-02", entry_seq: 1, kind: "WORK", shift_id: 5, shift_version_id: 50,
  custom_start_time: null, custom_end_time: null, site_id: null, planned_work_mode: null, version: 1, source: "MANUAL",
  roster_period_id: 3, publication_id: 9, published_at: "2026-10-20T10:00:00+00:00", acknowledged_at: null, note: null,
}], []);

function Harness({ onChange, readOnly }: { onChange: jest.Mock; readOnly?: boolean }) {
  const [pending, setPending] = useState<Map<string, PaletteValue>>(new Map());
  return (
    <main>
      <RosterGrid employees={employees} dates={dates} cells={cells} shifts={shifts} pending={pending} readOnly={readOnly}
        onPendingChange={(next) => { onChange(next); setPending(next); }} />
    </main>
  );
}

const at = (row: number, col: number) => screen.getByTestId(`cell-${employees[row].id}-${dates[col]}`);
const focusAt = (row: number, col: number) => act(() => { at(row, col).focus(); });
const key = (k: string, extra: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(document.activeElement as Element, { key: k, ...extra });
const tabStops = () => within(screen.getByTestId("roster-grid")).getAllByRole("button").filter((b) => b.tabIndex === 0);
const lastCells = (onChange: jest.Mock) => toDraftCells(onChange.mock.calls[onChange.mock.calls.length - 1][0]);

describe("RosterGrid keyboard", () => {
  it("is one tab stop: the first cell until another cell takes focus, then that cell", () => {
    render(<Harness onChange={jest.fn()} />);
    const grid = screen.getByRole("grid", { name: "Roster grid: employees by date" });
    expect(grid).toHaveAttribute("aria-rowcount", "13");
    expect(grid).toHaveAttribute("aria-colcount", "5");
    expect(screen.getByRole("region", { name: "Roster grid" })).not.toHaveAttribute("tabindex");
    expect(tabStops()).toEqual([at(0, 0)]);
    focusAt(4, 2);
    expect(tabStops()).toEqual([at(4, 2)]);
    expect(at(0, 0)).toHaveAttribute("tabindex", "-1");
  });

  it("moves focus with the arrows, Home / End, Ctrl+Home / Ctrl+End and Page Up / Page Down, clamped at the edges", () => {
    render(<Harness onChange={jest.fn()} />);
    focusAt(0, 0);
    key("ArrowRight");
    expect(at(0, 1)).toHaveFocus();
    key("ArrowDown");
    expect(at(1, 1)).toHaveFocus();
    key("ArrowLeft");
    key("ArrowLeft");  // already in the first column: stays
    expect(at(1, 0)).toHaveFocus();
    key("ArrowUp");
    key("ArrowUp");
    expect(at(0, 0)).toHaveFocus();
    key("End");
    expect(at(0, 3)).toHaveFocus();
    key("Home");
    expect(at(0, 0)).toHaveFocus();
    key("End", { ctrlKey: true });
    expect(at(11, 3)).toHaveFocus();
    key("Home", { ctrlKey: true });
    expect(at(0, 0)).toHaveFocus();
    key("PageDown");
    expect(at(10, 0)).toHaveFocus();
    key("PageDown");
    expect(at(11, 0)).toHaveFocus();
    key("PageUp");
    expect(at(1, 0)).toHaveFocus();
    expect(tabStops()).toEqual([at(1, 0)]);
  });

  it("mirrors left and right in a right-to-left layout", () => {
    render(<div dir="rtl"><Harness onChange={jest.fn()} /></div>);
    focusAt(0, 1);
    key("ArrowLeft");
    expect(at(0, 2)).toHaveFocus();
    key("ArrowRight");
    key("ArrowRight");
    expect(at(0, 0)).toHaveFocus();
  });

  it("Enter, Space and F2 open the cell editor; Escape and Cancel close it and focus returns to the cell", () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);
    focusAt(0, 0);
    key("Enter");
    const editor = screen.getByRole("dialog", { name: "Edit Asha Rao, Sat 31 Oct 2026" });
    expect(within(editor).getByRole("button", { name: "M1 – Morning" })).toHaveFocus();
    key("Escape");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(at(0, 0)).toHaveFocus();

    key(" ");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(at(0, 0)).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();

    key("ArrowDown");
    key("F2");
    fireEvent.click(within(screen.getByRole("dialog", { name: "Edit Vikram Iyer, Sat 31 Oct 2026" })).getByRole("button", { name: "Off" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(at(1, 0)).toHaveFocus();
    expect(at(1, 0)).toHaveAccessibleName("Vikram Iyer, Sat 31 Oct 2026: Off (unsaved)");
    expect(lastCells(onChange)).toEqual([{ employee_id: 102, shift_date: "2026-10-31", entry_seq: 1, action: "UPSERT", kind: "OFF" }]);
  });

  it("with a palette chip selected, Enter paints the focused cell, F2 still opens the editor and Escape drops the chip", () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);
    const chip = within(screen.getByRole("toolbar", { name: "Shift palette" })).getByRole("button", { name: "N1 – Night" });
    fireEvent.click(chip);
    focusAt(0, 2);
    key("Enter");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(lastCells(onChange)).toEqual([{ employee_id: 101, shift_date: "2026-11-02", entry_seq: 1, action: "UPSERT", kind: "WORK", shift_id: 6 }]);
    key("F2");
    key("Escape");  // closes the editor only; the chip stays selected
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(chip).toHaveAttribute("aria-pressed", "true");
    key("Escape");
    expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(at(0, 2)).toHaveFocus();
  });

  it("a read-only grid navigates by keyboard but opens no editor and changes nothing", () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} readOnly />);
    expect(screen.getByRole("grid")).toHaveAttribute("aria-readonly", "true");
    focusAt(0, 0);
    key("ArrowRight");
    expect(at(0, 1)).toHaveFocus();
    for (const k of ["Enter", " ", "F2"]) key(k);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("has no axe violations: editable, with the cell editor open, and read-only", async () => {
    const editable = render(<Harness onChange={jest.fn()} />);
    expect(await axe(editable.container)).toHaveNoViolations();
    focusAt(3, 1);
    key("Enter");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(await axe(editable.container)).toHaveNoViolations();
    editable.unmount();
    const readOnly = render(<Harness onChange={jest.fn()} readOnly />);
    expect(await axe(readOnly.container)).toHaveNoViolations();
  });
});
