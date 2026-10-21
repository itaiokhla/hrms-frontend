import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import WageInputsPage from "@/app/(app)/payroll/inputs/page";
import WageInputPage from "@/app/(app)/payroll/inputs/[id]/page";
import { P } from "@/lib/permissions.generated";

import { conflict, me, notFound, plain, signIn, wageInput } from "./fixtures";

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockSearch = new URLSearchParams();
let mockParams: Record<string, string> = {};
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn() }),
  usePathname: () => "/payroll/inputs",
  useSearchParams: () => mockSearch,
  useParams: () => mockParams,
}));
jest.mock("react-hot-toast", () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();
jest.mock("@/lib/payroll/api", () => {
  const actual = jest.requireActual("@/lib/payroll/api");
  return {
    ...actual,
    payrollApi: {
      get: (...a: unknown[]) => mockGet(...a),
      post: (...a: unknown[]) => mockPost(...a),
      patch: (...a: unknown[]) => mockPatch(...a),
      delete: jest.fn(),
    },
  };
});

const EDITOR = me({ [P.EMPLOYEE_READ]: ["COMPANY"], [P.PAYROLL_INPUTS_READ]: ["COMPANY"], [P.PAYROLL_INPUTS_EDIT]: ["COMPANY"], [P.PAYROLL_INPUTS_IMPORT]: ["COMPANY"], [P.PAYROLL_INPUTS_APPROVE]: ["COMPANY"] });
const READER = me({ [P.PAYROLL_INPUTS_READ]: ["LEGAL_ENTITY"] });

function routes(list: unknown = { total: 1, items: [wageInput()] }) {
  mockGet.mockImplementation((url: string) => {
    if (url === "/payroll/wage-inputs") return list instanceof Error ? Promise.reject(list) : Promise.resolve(list);
    if (url.startsWith("/payroll/wage-inputs/")) return Promise.resolve(wageInput());
    if (url === "/employees") return Promise.resolve({ total: 1, items: [{ id: 142, employee_code: "E0142", full_name: "Asha Rao" }] });
    return Promise.resolve([]);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = new URLSearchParams();
  mockParams = {};
  window.localStorage.clear();
});

describe("Wage Inputs page", () => {
  it("denies access without payroll:inputs:read beyond self", () => {
    signIn(me({ [P.PAYROLL_INPUTS_READ]: ["SELF"] }));
    render(<WageInputsPage />);
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
  });

  it("lists inputs with exact string amounts, the five tabs and the hide-amounts toggle", async () => {
    signIn(EDITOR);
    routes();
    render(<WageInputsPage />);
    for (const tab of ["One-time", "Overtime", "Tasks", "Arrears proposals", "Imports"]) expect(screen.getByRole("tab", { name: tab })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide amounts" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("BONUS").length).toBeGreaterThan(0));
    expect(plain(document.body.textContent)).toMatch(/12,500\.50/);
    expect(mockGet).toHaveBeenCalledWith("/payroll/wage-inputs", { params: { skip: 0, limit: 50 } });
  });

  it("shows actions only for the permissions held", async () => {
    signIn(READER);
    routes();
    render(<WageInputsPage />);
    await waitFor(() => expect(screen.getAllByText("BONUS").length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: /Add wage input/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Import CSV/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("shows the empty state with the next action", async () => {
    signIn(EDITOR);
    routes({ total: 0, items: [] });
    render(<WageInputsPage />);
    expect(await screen.findByText("No wage inputs yet")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Add wage input/ }).length).toBeGreaterThan(1);
  });

  it("shows an error with Retry", async () => {
    signIn(EDITOR);
    routes(new Error("boom"));
    render(<WageInputsPage />);
    const retry = await screen.findByRole("button", { name: "Try again" });
    routes();
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getAllByText("BONUS").length).toBeGreaterThan(0));
  });

  it("requires a reason to reject and sends it", async () => {
    signIn(EDITOR);
    routes();
    mockPost.mockResolvedValue({ id: 11, status: "REJECTED" });
    render(<WageInputsPage />);
    const reject = (await screen.findAllByRole("button", { name: "Reject" }))[0];
    fireEvent.click(reject);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
    expect(await within(dialog).findByText(/Give a reason for the rejection/)).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Duplicate of #10" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/wage-inputs/11/reject", { remarks: "Duplicate of #10" }));
  });

  it("makes the approver acknowledge flags first", async () => {
    signIn(EDITOR);
    routes({ total: 1, items: [wageInput({ flags: [{ code: "POSSIBLE_DUPLICATE", message: "Looks like input #10" }] })] });
    render(<WageInputsPage />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Approve" }))[0]);
    const dialog = await screen.findByRole("dialog");
    const approve = within(dialog).getByRole("button", { name: "Approve" });
    expect(approve).toBeDisabled();
    fireEvent.click(within(dialog).getByLabelText("I have checked these"));
    expect(approve).not.toBeDisabled();
  });

  it("says arrears proposals are not available yet", async () => {
    signIn(EDITOR);
    routes();
    mockSearch = new URLSearchParams("tab=arrears");
    render(<WageInputsPage />);
    expect(await screen.findByText("Arrears proposals are not available yet")).toBeInTheDocument();
  });
});

describe("Add wage input modal", () => {
  it("validates inline and posts the amount as a decimal string", async () => {
    signIn(EDITOR);
    routes();
    mockSearch = new URLSearchParams("modal=wage-input");
    mockPost.mockResolvedValue({ items: [{ id: 99, status: "PENDING_APPROVAL" }] });
    render(<WageInputsPage />);
    const dialog = await screen.findByRole("dialog", { name: "Add wage input" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit for approval" }));
    expect(await within(dialog).findAllByText("Choose the employee.")).toHaveLength(2);
    expect(within(dialog).getByText("Some fields need attention.")).toBeInTheDocument();

    await waitFor(() => expect(within(dialog).getAllByRole("option", { name: /Asha Rao/ }).length).toBe(1));
    fireEvent.change(within(dialog).getByLabelText(/^Employee/), { target: { value: "142" } });
    fireEvent.change(within(dialog).getByLabelText(/Component code/), { target: { value: "bonus" } });
    fireEvent.change(within(dialog).getByLabelText(/^Amount/), { target: { value: "1,500" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit for approval" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    const [url, body] = mockPost.mock.calls[0];
    expect(url).toBe("/payroll/wage-inputs");
    expect(body).toMatchObject({ employee_id: 142, component_code: "BONUS", amount: { amount: "1500.00", currency: "INR" }, submit: true });
    expect(typeof body.amount.amount).toBe("string");
  });

  it("shows a conflict banner with Reload when the draft changed elsewhere", async () => {
    signIn(EDITOR);
    mockGet.mockImplementation((url: string) => {
      if (url === "/payroll/wage-inputs/11") return Promise.resolve(wageInput({ status: "DRAFT" }));
      if (url === "/payroll/wage-inputs") return Promise.resolve({ total: 0, items: [] });
      return Promise.resolve({ total: 0, items: [] });
    });
    mockPatch.mockRejectedValue(conflict());
    mockSearch = new URLSearchParams("modal=wage-input&id=11");
    render(<WageInputsPage />);
    const dialog = await screen.findByRole("dialog", { name: "Edit wage input" });
    await waitFor(() => expect(within(dialog).getByLabelText(/^Amount/)).toHaveValue("12500.50"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save as draft" }));
    expect(await within(dialog).findByText("Someone else changed this")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Reload/ })).toBeInTheDocument();
    expect(mockPatch).toHaveBeenCalledWith("/payroll/wage-inputs/11", expect.objectContaining({ row_version: 2, amount: { amount: "12500.50", currency: "INR" } }), expect.anything());
  });
});

describe("Wage input full page", () => {
  it("shows a forbidden or missing input as not found", async () => {
    signIn(EDITOR);
    mockParams = { id: "404" };
    mockGet.mockImplementation((url: string) => (url === "/payroll/wage-inputs/404" ? Promise.reject(notFound()) : Promise.resolve({ total: 0, items: [] })));
    render(<WageInputPage />);
    expect(await screen.findByText("Wage input not found")).toBeInTheDocument();
  });

  it("renders the input with a units explanation", async () => {
    signIn(EDITOR);
    mockParams = { id: "11" };
    mockGet.mockImplementation((url: string) =>
      url === "/payroll/wage-inputs/11"
        ? Promise.resolve(wageInput({ amount: null, units: "8.50", rate: "250.00", status: "APPROVED" }))
        : Promise.resolve({ total: 0, items: [] }),
    );
    render(<WageInputPage />);
    expect(await screen.findByText("Why this amount?")).toBeInTheDocument();
    expect(screen.getAllByText("8.5").length).toBeGreaterThan(0);
  });
});
