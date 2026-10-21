import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import ComponentsPage from "@/app/(app)/payroll/components/page";
import ComponentPage from "@/app/(app)/payroll/components/[code]/page";
import { ApiError } from "@/lib/api";
import { PayrollApiError } from "@/lib/payroll/api";

import { compensationApi } from "../api";
import { FormulaEditor } from "../FormulaEditor";
import type { FormulaCheck, PayComponent } from "../types";
import { EDITOR, READER, resetNav, signIn } from "./helpers";

jest.mock("next/navigation", () => require("./helpers").navigationMock());
jest.mock("@/components/shared/EmployeePicker", () => require("./helpers").employeePickerMock());
jest.mock("../api", () => {
  const actual = jest.requireActual("../api");
  const mocked = Object.fromEntries(Object.entries(actual.compensationApi).map(([k, v]) => [k, typeof v === "function" ? jest.fn() : v]));
  return { ...actual, compensationApi: mocked };
});

const api = compensationApi as unknown as Record<string, jest.Mock>;

function version(over: Partial<PayComponent["current_version"]> = {}) {
  return {
    id: 1, version: 1, name: "Basic", translations: {}, description: null, calc_method: "FORMULA", formula: "ctc.monthly * 0.5", params: {},
    tags: ["PART_OF_CTC"], proration: "BY_PAID_DAYS", proration_basis: null, frequency: { type: "EVERY_PERIOD" }, taxability: null,
    totals_flags: { in_gross: true }, cap: null, floor: null, rounding: null, eligibility: null, payslip: { order: 1 }, visibility: "EMPLOYEE_VISIBLE",
    gl: null, reporting_codes: {}, input_approval_above: null, effective_from: "2026-01-01", effective_to: null, status: "ACTIVE",
    created_by_user_id: 1, created_at: "2026-01-01T00:00:00Z", ...over,
  } as NonNullable<PayComponent["current_version"]>;
}

function component(code: string, over: Partial<PayComponent> = {}): PayComponent {
  return { id: code.charCodeAt(0) + code.length * 100, code, kind: "EARNING", category: "BASE", owner: "COMPANY", read_only: false, status: "ACTIVE", stage: 4, name: code === "BASIC" ? "Basic" : code, current_version: version({ name: code === "BASIC" ? "Basic" : code }), ...over };
}

const VALID: FormulaCheck = { type: "MONEY", components: [], rates: [], tags: [], inputs: [], history: [], variables: ["ctc.monthly"], tables: [], functions: [], dependencies: [], errors: [], warnings: [], node_count: 3, valid: true, canonical: "ctc.monthly * 0.5" };

beforeEach(() => {
  Object.values(api).forEach((fn) => typeof fn === "function" && "mockReset" in fn && fn.mockReset().mockResolvedValue(undefined));
  api.validateFormula.mockResolvedValue(VALID);
});

describe("Components list", () => {
  it("lists components, filters by search and kind, and offers New component to editors", async () => {
    resetNav("/payroll/components");
    signIn(EDITOR);
    api.listComponents.mockResolvedValue([component("BASIC"), component("PF_EE", { kind: "DEDUCTION", category: "EMPLOYEE_CONTRIBUTION", owner: "IN", read_only: true, name: "PF employee" })]);
    render(<ComponentsPage />);
    expect((await screen.findAllByText("Basic")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("IN pack").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /New component/ })[0]).toHaveAttribute("href", "/payroll/components/new");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search code or name" }), { target: { value: "pf" } });
    expect(screen.queryAllByText("Basic")).toHaveLength(0);
    expect(screen.getAllByText("PF employee").length).toBeGreaterThan(0);
    fireEvent.change(screen.getByRole("combobox", { name: "Kind" }), { target: { value: "EARNING" } });
    expect(screen.getByText("No components match")).toBeInTheDocument();
  });

  it("hides editing actions from a reader and shows an error with retry", async () => {
    resetNav("/payroll/components");
    signIn(READER);
    api.listComponents.mockRejectedValueOnce(new ApiError(503, "Server unavailable")).mockResolvedValue([]);
    render(<ComponentsPage />);
    expect(await screen.findByText("Server unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /New component/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No components yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /starter components/ })).not.toBeInTheDocument();
  });

  it("denies people without structure read access", () => {
    resetNav("/payroll/components");
    signIn({});
    render(<ComponentsPage />);
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
    expect(api.listComponents).not.toHaveBeenCalled();
  });
});

describe("Component editor", () => {
  it("saves a new version from the edited formula with an effective date", async () => {
    resetNav("/payroll/components/BASIC", "", { code: "BASIC" });
    signIn(EDITOR);
    const basic = { ...component("BASIC"), in_use: true, versions: [version()] };
    api.getComponent.mockResolvedValue(basic);
    api.listComponents.mockResolvedValue([basic, component("HRA")]);
    api.createComponentVersion.mockResolvedValue({ ...basic, versions: [version(), version({ id: 2, version: 2, formula: "ctc.monthly * 0.4" })] });
    render(<ComponentPage />);
    expect(await screen.findByRole("heading", { name: "Basic", level: 1 })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Code/)).toBeDisabled();
    const formula = screen.getByRole("combobox", { name: "Formula" });
    fireEvent.change(formula, { target: { value: "ctc.monthly * 0.4" } });
    await waitFor(() => expect(api.validateFormula).toHaveBeenCalledWith(expect.objectContaining({ formula: "ctc.monthly * 0.4", component: "BASIC" }), expect.anything()));
    fireEvent.change(screen.getByLabelText("New version effective from"), { target: { value: "2099-01-01" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Save new version/ }));
    });
    expect(api.createComponentVersion).toHaveBeenCalledWith("BASIC", expect.objectContaining({ formula: "ctc.monthly * 0.4", calc_method: "FORMULA", effective_from: "2099-01-01", tags: ["PART_OF_CTC"] }));
    expect(await screen.findByText("Version 2")).toBeInTheDocument();
  });

  it("shows a pack-owned component read-only", async () => {
    resetNav("/payroll/components/PF_EE", "", { code: "PF_EE" });
    signIn(EDITOR);
    const pf = { ...component("PF_EE", { owner: "IN", read_only: true, kind: "DEDUCTION", category: "EMPLOYEE_CONTRIBUTION", current_version: version({ calc_method: "SYSTEM", formula: null, name: "PF" }) }), versions: [] };
    api.getComponent.mockResolvedValue(pf);
    api.listComponents.mockResolvedValue([pf]);
    render(<ComponentPage />);
    expect(await screen.findByText(/belongs to the IN country pack/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save new version/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Name/)).toBeDisabled();
  });

  it("shows a 409 as a conflict banner with reload, and maps formula errors inline", async () => {
    resetNav("/payroll/components/BASIC", "", { code: "BASIC" });
    signIn(EDITOR);
    const basic = { ...component("BASIC"), versions: [version()] };
    api.getComponent.mockResolvedValue(basic);
    api.listComponents.mockResolvedValue([basic]);
    api.createComponentVersion.mockRejectedValueOnce(new PayrollApiError(400, "Unknown reference FOO", "UNKNOWN_REFERENCE", undefined, { message: "Unknown reference FOO", field: "formula", errors: [{ code: "UNKNOWN_REFERENCE", message: "FOO is not a component", position: 0, end: 3 }] }));
    render(<ComponentPage />);
    await screen.findByRole("heading", { name: "Basic", level: 1 });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Save new version/ }));
    });
    expect((await screen.findAllByText(/FOO is not a component/)).length).toBeGreaterThan(0);
    api.createComponentVersion.mockRejectedValueOnce(new PayrollApiError(409, "Archived components cannot change.", "COMPONENT_ARCHIVED", undefined, { message: "Archived components cannot change." }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Save new version/ }));
    });
    expect(await screen.findByText("Someone else changed this.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() => expect(api.getComponent).toHaveBeenCalledTimes(2));
  });

  it("treats an out-of-scope or unknown component as not found", async () => {
    resetNav("/payroll/components/NOPE", "", { code: "NOPE" });
    signIn(READER);
    api.getComponent.mockRejectedValue(new PayrollApiError(404, "Not found.", undefined, undefined, "Not found."));
    api.listComponents.mockResolvedValue([]);
    render(<ComponentPage />);
    expect(await screen.findByText("Component not found")).toBeInTheDocument();
  });
});

describe("FormulaEditor", () => {
  it("highlights, autocompletes components and functions, and shows server errors with their position", async () => {
    api.validateFormula.mockResolvedValue({ ...VALID, valid: false, errors: [{ code: "TYPE", message: "Money and boolean can't be added", position: 6, end: 10 }] });
    function Harness() {
      const [v, setV] = require("react").useState("");
      return <FormulaEditor label="Formula" value={v} onChange={setV} components={[{ code: "BASIC", name: "Basic" }, { code: "HRA", name: "House rent" }]} debounceMs={0} />;
    }
    render(<Harness />);
    const box = screen.getByRole("combobox", { name: "Formula" });
    fireEvent.change(box, { target: { value: "BA", selectionStart: 2 } });
    const list = await screen.findByRole("listbox", { name: "Suggestions" });
    expect(within(list).getByText("BASIC")).toBeInTheDocument();
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(box).toHaveValue("BASIC"));
    fireEvent.change(box, { target: { value: "BASIC + TRUE", selectionStart: 12 } });
    expect(await screen.findByText(/Money and boolean can't be added/)).toBeInTheDocument();
    expect(screen.getByText(/at character 7/)).toBeInTheDocument();
    expect(box).toHaveAttribute("aria-invalid", "true");
  });
});
