import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { DayLedgerCalendar, type LedgerDay } from "../DayLedgerCalendar";
import { ExceptionList, type PayrollExceptionItem } from "../ExceptionList";
import { ExplainPanel } from "../ExplainPanel";

describe("ExplainPanel", () => {
  it("shows the explanation first and expands formula, inputs, rounding and sources", () => {
    render(
      <ExplainPanel
        explanation="Basic for 28 of 30 days (2 LOP days)."
        formula="50,000 × 28 ÷ 30"
        inputs={[{ label: "Paid days", value: "28", source: { label: "Attendance 26 Oct – 25 Nov", href: "/attendance?employee=1" } }]}
        rounding="Rounded half up to 0.01: 46,666.666… → 46,666.67"
        sources={[{ label: "Leave request #42", href: "/leaves/42", kind: "Leave" }, { label: "Manual LOP entry" }]}
      />,
    );
    expect(screen.getByText("Basic for 28 of 30 days (2 LOP days).")).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "Formula · Inputs · Sources" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("50,000 × 28 ÷ 30")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("50,000 × 28 ÷ 30")).toBeInTheDocument();
    expect(screen.getByText(/Rounded half up/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Leave request #42" })).toHaveAttribute("href", "/leaves/42");
    expect(screen.getByRole("link", { name: "Attendance 26 Oct – 25 Nov" })).toBeInTheDocument();
    expect(screen.getByText("Manual LOP entry")).toBeInTheDocument();
  });

  it("has no toggle when there are no details", () => {
    render(<ExplainPanel explanation="Fixed monthly amount." />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("DayLedgerCalendar", () => {
  const days: LedgerDay[] = [
    { date: "2026-11-02", am: "PRESENT", pm: "PRESENT" },
    { date: "2026-11-03", am: "PRESENT", pm: "LEAVE", paid: { am: true, pm: true }, sources: [{ label: "Leave request #42", href: "/leaves/42", kind: "Leave" }] },
    { date: "2026-11-04", am: "MANUAL_LOP", pm: "MANUAL_LOP", note: "Marked by HR" },
    { date: "2026-11-08", am: "WEEKLY_OFF", pm: "WEEKLY_OFF" },
  ];
  const renderCal = (onSelectDay = jest.fn()) => {
    render(<DayLedgerCalendar start="2026-11-02" end="2026-11-15" days={days} locale="en-GB" onSelectDay={onSelectDay} />);
    return onSelectDay;
  };

  it("lays out weeks from Monday with accessible day names", () => {
    renderCal();
    const grid = screen.getByRole("grid", { name: "Attendance by day" });
    expect(within(grid).getAllByRole("columnheader")).toHaveLength(7);
    expect(within(grid).getAllByRole("row")).toHaveLength(3); // header + 2 weeks (2 Nov 2026 is a Monday)
    expect(screen.getByRole("gridcell", { name: "Tue, 3 Nov: morning Present, afternoon Leave" })).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: "Wed, 4 Nov: Loss of pay" })).toBeInTheDocument();
  });

  it("has a legend in words, not colour alone", () => {
    renderCal();
    const legend = screen.getByRole("list", { name: "Legend" });
    expect(legend).toHaveTextContent("Present");
    expect(legend).toHaveTextContent("Loss of pay");
    expect(legend).toHaveTextContent("Weekly off");
  });

  it("moves with the keyboard and opens a day's slots and sources", () => {
    const onSelectDay = renderCal();
    const first = screen.getByRole("gridcell", { name: /Mon, 2 Nov/ });
    expect(first).toHaveAttribute("tabindex", "0");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    const second = screen.getByRole("gridcell", { name: /Tue, 3 Nov/ });
    expect(second).toHaveFocus();
    expect(second).toHaveAttribute("tabindex", "0");
    expect(first).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(second, { key: "Enter" });
    expect(second).toHaveAttribute("aria-selected", "true");
    expect(onSelectDay).toHaveBeenCalledWith(expect.objectContaining({ date: "2026-11-03" }), "2026-11-03");
    expect(screen.getByRole("link", { name: "Leave request #42" })).toBeInTheDocument();
    expect(screen.getAllByText(/paid/).length).toBeGreaterThan(0);
    fireEvent.keyDown(second, { key: "ArrowDown" });
    expect(screen.getByRole("gridcell", { name: /Tue, 10 Nov/ })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("gridcell", { name: /Tue, 10 Nov/ }), { key: "End" });
    expect(screen.getByRole("gridcell", { name: /Sun, 15 Nov/ })).toHaveFocus();
  });

  it("explains days without a ledger entry", () => {
    renderCal();
    fireEvent.click(screen.getByRole("gridcell", { name: "Thu, 5 Nov: no data" }));
    expect(screen.getByText("No ledger entry for this day.")).toBeInTheDocument();
  });
});

describe("ExceptionList", () => {
  const items: PayrollExceptionItem[] = [
    { id: 1, code: "UNMARKED_DAY", severity: "WARNING", message: "2 unmarked days", employee: { id: 1, name: "Priya Shah" }, waivable: true, deferrable: true },
    { id: 2, code: "UNMARKED_DAY", severity: "WARNING", message: "1 unmarked day", employee: { id: 2, name: "Arjun Rao" } },
    { id: 3, code: "NO_BANK_ACCOUNT", severity: "BLOCKING", message: "Add one, or payment will be held.", employee: { id: 3, name: "Esha" }, fixHref: "/payroll/bank-details?employee=3" },
  ];

  it("groups by code with the most severe group first", () => {
    render(<ExceptionList items={items} groupLabels={{ UNMARKED_DAY: "Unmarked days" }} />);
    const groups = screen.getAllByRole("region");
    expect(groups[0]).toHaveTextContent("Blocking");
    expect(groups[0]).toHaveTextContent("No bank account (1)");
    expect(groups[1]).toHaveTextContent("Unmarked days (2)");
  });

  it("offers Fix / Waive / Defer only where allowed and calls back", () => {
    const onFix = jest.fn();
    const onWaive = jest.fn();
    const onDefer = jest.fn();
    render(<ExceptionList items={items} onFix={onFix} onWaive={onWaive} onDefer={onDefer} />);
    expect(screen.getByRole("link", { name: "Fix Esha" })).toHaveAttribute("href", "/payroll/bank-details?employee=3");
    fireEvent.click(screen.getByRole("button", { name: "Fix Priya Shah" }));
    expect(onFix).toHaveBeenCalledWith(items[0]);
    fireEvent.click(screen.getByRole("button", { name: "Waive Priya Shah" }));
    expect(onWaive).toHaveBeenCalledWith(items[0]);
    fireEvent.click(screen.getByRole("button", { name: "Defer Priya Shah" }));
    expect(onDefer).toHaveBeenCalledWith(items[0]);
    expect(screen.queryByRole("button", { name: "Waive Arjun Rao" })).not.toBeInTheDocument();
  });

  it("collapses a group and shows an empty state", () => {
    const { rerender } = render(<ExceptionList items={items} />);
    const toggle = screen.getAllByRole("button", { expanded: true })[0];
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    rerender(<ExceptionList items={[]} />);
    expect(screen.getByText("No exceptions")).toBeInTheDocument();
  });
});
