import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";

import { Field, Input, Switch } from "@/components/ui/field";
import { DataTable, StatCard, type Column } from "@/components/ui/layout";
import { Sheet } from "@/components/ui/overlay";

type Row = { id: number; name: string; net: string };
const rows: Row[] = [
  { id: 1, name: "Priya Shah", net: "96,775.65" },
  { id: 2, name: "Arjun Rao", net: "88,400.00" },
];
const columns: Column<Row>[] = [
  { key: "name", header: "Employee", cell: (r) => r.name },
  { key: "net", header: "Net", cell: (r) => r.net },
  { key: "x", header: "Internal", cell: () => "hidden", hideInCard: true },
];

describe("DataTable additions", () => {
  it("renders cards below md when opted in, with label/value pairs", () => {
    const onRowClick = jest.fn();
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={onRowClick} cardBelowMd caption="Employees in run" />);
    const table = screen.getByRole("table");
    expect(table.parentElement).toHaveClass("hidden", "md:block");
    const cards = screen.getAllByTestId("datatable-card");
    expect(cards).toHaveLength(2);
    expect(cards[0].parentElement).toHaveClass("md:hidden");
    expect(cards[0]).toHaveTextContent("Priya Shah");
    expect(cards[0].querySelector("dt")).toHaveTextContent("Net");
    expect(cards[0]).not.toHaveTextContent("Internal");
    fireEvent.keyDown(cards[1], { key: " " });
    expect(onRowClick).toHaveBeenCalledWith(rows[1]);
    expect(screen.getByText("Employees in run")).toHaveClass("sr-only");
  });

  it("keeps the plain table by default and supports a sticky header", () => {
    const { container } = render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} stickyHeader />);
    expect(screen.queryAllByTestId("datatable-card")).toHaveLength(0);
    expect(container.querySelector("thead")).toHaveClass("sticky", "top-0");
    expect(screen.getAllByRole("columnheader")[0]).toHaveAttribute("scope", "col");
  });

  it("does not fire the row when a key is pressed on a control inside it", () => {
    const onRowClick = jest.fn();
    const withButton: Column<Row>[] = [{ key: "a", header: "A", cell: () => <button type="button">Act</button> }];
    render(<DataTable columns={withButton} rows={rows.slice(0, 1)} rowKey={(r) => r.id} onRowClick={onRowClick} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Act" }), { key: "Enter" });
    expect(onRowClick).not.toHaveBeenCalled();
  });
});

describe("Field", () => {
  it("links its error to the control with aria-describedby and aria-invalid", () => {
    render(
      <Field label="Amount" error="Enter an amount.">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText("Amount");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Enter an amount.");
  });

  it("links a hint too, keeping an explicit id and existing descriptions", () => {
    render(
      <Field label="Code" htmlFor="code" hint="6 digits">
        <Input id="code" aria-describedby="extra" />
      </Field>,
    );
    const input = screen.getByLabelText("Code");
    expect(input.getAttribute("aria-describedby")).toMatch(/^extra .+-msg$/);
    expect(input).not.toHaveAttribute("aria-invalid");
  });
});

describe("Switch", () => {
  it("accepts an id and mirrors its knob in RTL", () => {
    const { container } = render(
      <Field label="Overtime">
        <Switch checked onChange={jest.fn()} />
      </Field>,
    );
    expect(screen.getByRole("switch", { name: "Overtime" })).toHaveAttribute("id");
    expect(container.querySelector("[role=switch] span")).toHaveClass("translate-x-[22px]", "rtl:-translate-x-[22px]");
  });
});

describe("Sheet", () => {
  afterEach(() => document.documentElement.removeAttribute("dir"));

  it("uses logical edges so it slides from the inline end", () => {
    document.documentElement.dir = "rtl";
    render(
      <Sheet open onOpenChange={jest.fn()} title="Priya Shah">
        body
      </Sheet>,
    );
    const aside = screen.getByRole("dialog");
    expect(aside).toHaveClass("end-0", "border-s");
    expect(aside).not.toHaveClass("right-0");
  });
});

describe("StatCard", () => {
  it("still renders its value", () => {
    render(<StatCard label="Employees" value={0} />);
    expect(screen.getByText("Employees")).toBeInTheDocument();
  });
});
