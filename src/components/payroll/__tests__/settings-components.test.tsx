import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import { InheritanceBadge } from "../InheritanceBadge";
import { KpiCard } from "../KpiCard";
import { PolicyCard } from "../PolicyCard";
import { ScopeBar, type ScopeSelection } from "../ScopeBar";
import { SwitchCard } from "../SwitchCard";

const plain = (s: string | null | undefined) => (s ?? "").replace(/[  ]/g, " ").replace(/[‎‏؜]/g, "");

beforeAll(() => {
  // Radix popper measures its anchor.
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  document.documentElement.lang = "en-US";
});

describe("KpiCard", () => {
  it("shows a count, a state label and a drill-down link", () => {
    render(<KpiCard label="Without salary" count={3} href="/payroll/compensation?filter=without" state="DRAFT" />);
    expect(screen.getByText("Draft")).toBeInTheDocument();
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/payroll/compensation?filter=without");
    expect(link).toHaveTextContent("Without salary");
  });

  it("shows money compactly per currency and never sums currencies", async () => {
    render(
      <KpiCard
        label="Net"
        state="FINAL"
        amounts={[
          { amount: "34800000.00", currency: "INR" },
          { amount: "250000.00", currency: "AED" },
        ]}
      />,
    );
    expect(screen.getByText("Final")).toBeInTheDocument();
    const text = plain(document.body.textContent);
    expect(text).toContain("INR");
    expect(text).toContain("AED");
    const trigger = screen.getByRole("button", { name: /By currency \(2\)/ });
    await act(async () => {
      fireEvent.click(trigger);
    });
    const dialog = await screen.findByRole("dialog", { name: "Net by currency" });
    expect(plain(dialog.textContent)).toContain("34,800,000.00");
    expect(plain(dialog.textContent)).toContain("never added across currencies");
  });

  it("shows a skeleton while loading and a dash without data", () => {
    const { rerender, container } = render(<KpiCard label="Paid" count={null} loading />);
    expect(container.querySelector(".animate-shimmer")).not.toBeNull();
    rerender(<KpiCard label="Paid" count={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows the KPI definition as a tooltip", () => {
    render(<KpiCard label="Processed" count={0} definition="Included in a regular run that is FINALIZED or later" />);
    expect(screen.getByRole("tooltip", { hidden: true })).toHaveTextContent("FINALIZED or later");
  });
});

describe("InheritanceBadge", () => {
  it("names where the value comes from", () => {
    const { rerender } = render(<InheritanceBadge kind="INHERITED" level="TENANT" />);
    expect(screen.getByText("Inherited from tenant")).toBeInTheDocument();
    rerender(<InheritanceBadge kind="LEGAL" legalSource="IN pack 2026-09-17" />);
    expect(screen.getByText("Required by law")).toBeInTheDocument();
    expect(screen.getByRole("tooltip", { hidden: true })).toHaveTextContent("Source: IN pack 2026-09-17");
  });
});

describe("ScopeBar", () => {
  function Harness({ onChange }: { onChange?: (v: ScopeSelection) => void }) {
    const [value, setValue] = useState<ScopeSelection>({ level: "TENANT", targetId: null });
    return (
      <ScopeBar
        value={value}
        onChange={(v) => {
          setValue(v);
          onChange?.(v);
        }}
        targets={{ LEGAL_ENTITY: [{ id: "1", label: "Acme India" }, { id: "2", label: "Acme UAE" }], PAY_GROUP: [{ id: "9", label: "Staff Monthly" }] }}
      />
    );
  }

  it("is a radio group; levels without targets are disabled", () => {
    render(<Harness />);
    expect(screen.getByRole("radiogroup", { name: "Scope" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Tenant" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Branch" })).toBeDisabled();
  });

  it("picks a level and a target, also with arrow keys", () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "Legal entity" }));
    expect(onChange).toHaveBeenLastCalledWith({ level: "LEGAL_ENTITY", targetId: "1" });
    fireEvent.change(screen.getByRole("combobox", { name: "Choose legal entity" }), { target: { value: "2" } });
    expect(onChange).toHaveBeenLastCalledWith({ level: "LEGAL_ENTITY", targetId: "2" });
    fireEvent.keyDown(screen.getByRole("radio", { name: "Legal entity" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith({ level: "PAY_GROUP", targetId: "9" });
  });
});

describe("SwitchCard", () => {
  it("shows ON/OFF consequences and toggles", () => {
    const onChange = jest.fn();
    render(<SwitchCard title="Overtime pay" checked={false} onChange={onChange} whenOn="Approved overtime is paid." whenOff="No overtime earnings." />);
    const sw = screen.getByRole("switch", { name: "Overtime pay" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("When OFF").parentElement).toHaveTextContent("(current)");
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
    const described = sw.getAttribute("aria-describedby")!.split(" ").map((id) => document.getElementById(id)?.textContent ?? "");
    expect(described.join(" ")).toContain("No overtime earnings.");
  });

  it("disables the switch for law and tenant locks, not for decisions", () => {
    const { rerender } = render(
      <SwitchCard title="EPF" checked onChange={jest.fn()} whenOn="a" whenOff="b" lock="LAW" lockReason="for factory workers in India" />,
    );
    expect(screen.getAllByText("Required by law").length).toBeGreaterThan(0);
    expect(screen.getByRole("switch")).toBeDisabled();
    rerender(<SwitchCard title="EPF" checked onChange={jest.fn()} whenOn="a" whenOff="b" lock="TENANT" />);
    expect(screen.getAllByText("Locked by tenant").length).toBeGreaterThan(0);
    expect(screen.getByRole("switch")).toBeDisabled();
    rerender(<SwitchCard title="Overtime" checked={false} onChange={jest.fn()} whenOn="a" whenOff="b" lock="DECISION" />);
    expect(screen.getAllByText("Decision required").length).toBeGreaterThan(0);
    expect(screen.getByRole("switch")).not.toBeDisabled();
  });

  it("links inline validation errors to the switch", () => {
    render(<SwitchCard title="Loans" checked onChange={jest.fn()} whenOn="a" whenOff="b" error="V-07: set a protected net percentage first." />);
    const alert = screen.getByRole("alert");
    expect(screen.getByRole("switch").getAttribute("aria-describedby")).toContain(alert.id);
  });
});

describe("PolicyCard", () => {
  it("summarises a policy on one line with its actions", async () => {
    const onOpen = jest.fn();
    render(
      <PolicyCard
        name="Factory OT"
        version={3}
        status="ACTIVE"
        effectiveFrom="2026-10-01"
        population="Warehouse Weekly · 84 people"
        summary="Daily > 9 h · weekly > 48 h"
        onOpen={onOpen}
        actions={[{ label: "Edit rules", onSelect: jest.fn() }]}
      />,
    );
    expect(screen.getByText("· v3")).toBeInTheDocument();
    expect(screen.getByText("1 Oct 2026")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Factory OT" }));
    expect(onOpen).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Policy actions" })).toBeInTheDocument();
  });
});
