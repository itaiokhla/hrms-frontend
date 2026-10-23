import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import PayslipPage from "@/app/(app)/payroll/payslips/[id]/page";
import PayslipsPage from "@/app/(app)/payroll/payslips/page";
import { payrollError } from "@/lib/payroll/api";
import { P } from "@/lib/permissions.generated";
import type { Me } from "@/lib/types";

import { me, notFound, payslipDetail, signIn, staffQuestion } from "./fixtures";

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockSearch = new URLSearchParams();
let mockParams: Record<string, string> = {};
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack }),
  usePathname: () => "/payroll/payslips",
  useSearchParams: () => mockSearch,
  useParams: () => mockParams,
}));
jest.mock("react-hot-toast", () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("@/lib/payroll/api", () => {
  const actual = jest.requireActual("@/lib/payroll/api");
  return { ...actual, payrollApi: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a), put: jest.fn(), patch: jest.fn(), delete: jest.fn() } };
});

type Handler = unknown | ((params?: Record<string, unknown>) => unknown);
function routes(map: Record<string, Handler>) {
  mockGet.mockImplementation((url: string, options?: { params?: Record<string, unknown> }) => {
    if (!(url in map)) return Promise.reject(notFound("Thing"));
    const raw = map[url];
    const value = typeof raw === "function" ? (raw as (p?: Record<string, unknown>) => unknown)(options?.params) : raw;
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  });
}

const READER = me({ [P.PAYROLL_PAYSLIP_READ]: ["LEGAL_ENTITY"] });
const ANSWERER = me({ [P.PAYROLL_PAYSLIP_READ]: ["LEGAL_ENTITY"], [P.PAYROLL_PAYSLIP_PUBLISH]: ["LEGAL_ENTITY"] });
/** An HR user who is also employee #42 (the asker in the fixtures). */
const SELF_ANSWERER = { ...ANSWERER, employee: { id: 42, employee_code: "E0042", first_name: "Asha", last_name: "Rao", position: null, department: null, has_photo: false } } as Me;

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = new URLSearchParams();
  mockParams = {};
});

describe("Payslips workspace tabs", () => {
  it("keeps Payslips as the default tab and shows the open-question count on Questions", async () => {
    signIn(READER);
    routes({
      "/payroll/payslips": { total: 0, items: [] },
      "/payroll/payslip-questions": (params?: Record<string, unknown>) => (params?.status === "OPEN" && params?.limit === 1 ? { total: 3, items: [staffQuestion()] } : { total: 0, items: [] }),
    });
    render(<PayslipsPage />);
    expect(await screen.findByText("No payslips yet")).toBeInTheDocument();
    const tab = screen.getByRole("tab", { name: /Questions/ });
    await waitFor(() => expect(tab).toHaveTextContent("3"));
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/payroll/payslips?tab=questions", { scroll: false }));
  });

  it("is denied to employees who only read their own payslips", () => {
    signIn(me({ [P.PAYROLL_PAYSLIP_READ]: ["SELF"] }));
    render(<PayslipsPage />);
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe("Payslip questions inbox (HR)", () => {
  it("lists open questions in scope by default with employee, payslip and status", async () => {
    signIn(ANSWERER);
    mockSearch = new URLSearchParams("tab=questions");
    routes({ "/payroll/payslip-questions": { total: 1, items: [staffQuestion()] } });
    render(<PayslipsPage />);
    const table = await screen.findByRole("table", { name: "Payslip questions" });
    expect(within(table).getByText("Asha Rao")).toBeInTheDocument();
    expect(within(table).getByText("November 2026")).toBeInTheDocument();
    expect(within(table).getByText("Why is my HRA lower than last month?")).toBeInTheDocument();
    expect(within(table).getByText("Open")).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith("/payroll/payslip-questions", { params: { status: "OPEN", skip: 0, limit: 50 } });
    fireEvent.click(within(table).getByRole("button", { name: "Answer Asha Rao" }));
    expect(mockPush).toHaveBeenCalledWith("/payroll/payslips?tab=questions&modal=payslip-question&id=71", { scroll: false });
  });

  it("filters by status and run, and offers no Answer button without publish access", async () => {
    signIn(READER);
    mockSearch = new URLSearchParams("tab=questions");
    routes({ "/payroll/payslip-questions": { total: 1, items: [staffQuestion()] } });
    render(<PayslipsPage />);
    const table = await screen.findByRole("table", { name: "Payslip questions" });
    expect(within(table).queryByRole("button", { name: /Answer/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Pay run id"), { target: { value: "9" } });
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/payroll/payslip-questions", { params: { run_id: 9, skip: 0, limit: 50 } }));
  });

  it("shows an empty inbox plainly", async () => {
    signIn(READER);
    mockSearch = new URLSearchParams("tab=questions");
    routes({ "/payroll/payslip-questions": { total: 0, items: [] } });
    render(<PayslipsPage />);
    expect(await screen.findByText("No open questions")).toBeInTheDocument();
  });

  it("answers a deep-linked question with its row version and an idempotency key, optionally closing it", async () => {
    signIn(ANSWERER);
    mockSearch = new URLSearchParams("tab=questions&modal=payslip-question&id=71");
    routes({ "/payroll/payslip-questions": { total: 1, items: [staffQuestion()] }, "/payroll/payslip-questions/71": staffQuestion() });
    mockPost.mockResolvedValue({ id: 71, document_id: 501, status: "CLOSED", row_version: 2 });
    render(<PayslipsPage />);
    const dialog = await screen.findByRole("dialog", { name: "Question from Asha Rao" });
    expect(within(dialog).getByRole("link", { name: /Open the payslip · November 2026/ })).toHaveAttribute("href", "/payroll/payslips/501");
    fireEvent.click(within(dialog).getByRole("button", { name: "Send answer" }));
    expect(await within(dialog).findByText("Write the answer.")).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/^Answer/), { target: { value: "HRA was prorated for 2 days of unpaid leave." } });
    fireEvent.click(within(dialog).getByLabelText("Close the question with this answer"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Send answer" }));
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith(
        "/payroll/payslip-questions/71/answer",
        { answer: "HRA was prorated for 2 days of unpaid leave.", close: true, row_version: 1 },
        { idempotencyKey: expect.any(String) },
      ),
    );
  });

  it("shows a question outside the viewer's scope as not found", async () => {
    signIn(ANSWERER);
    mockSearch = new URLSearchParams("tab=questions&modal=payslip-question&id=999");
    routes({ "/payroll/payslip-questions": { total: 0, items: [] }, "/payroll/payslip-questions/999": notFound("Question") });
    render(<PayslipsPage />);
    const dialog = await screen.findByRole("dialog", { name: "Payslip question" });
    expect(await within(dialog).findByText("Question not found")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Send answer" })).not.toBeInTheDocument();
  });

  it("never offers to answer a question about the viewer's own payslip", async () => {
    signIn(SELF_ANSWERER);
    mockSearch = new URLSearchParams("tab=questions&modal=payslip-question&id=71");
    routes({ "/payroll/payslip-questions": { total: 1, items: [staffQuestion()] }, "/payroll/payslip-questions/71": staffQuestion() });
    render(<PayslipsPage />);
    const dialog = await screen.findByRole("dialog", { name: "Question from Asha Rao" });
    expect(await within(dialog).findByText("This is your own payslip")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Send answer" })).not.toBeInTheDocument();
    // The open modal hides the page behind it from assistive technology; look underneath it.
    const table = await screen.findByRole("table", { name: "Payslip questions", hidden: true });
    expect(within(table).queryByRole("button", { name: /Answer/, hidden: true })).not.toBeInTheDocument();
    expect(within(table).getByText("Asha Rao")).toBeInTheDocument();
  });

  it("explains the server's refusals: own payslip and already answered", async () => {
    signIn(ANSWERER);
    mockSearch = new URLSearchParams("tab=questions&modal=payslip-question&id=71");
    routes({ "/payroll/payslip-questions": { total: 1, items: [staffQuestion()] }, "/payroll/payslip-questions/71": staffQuestion() });
    mockPost.mockRejectedValueOnce(payrollError(403, { detail: "You cannot answer a question about your own payslip.", code: "SELF_ANSWER" }));
    mockPost.mockRejectedValueOnce(payrollError(409, { detail: "Only an open question can be answered; this one is ANSWERED.", code: "QUESTION_NOT_OPEN" }));
    render(<PayslipsPage />);
    const dialog = await screen.findByRole("dialog", { name: "Question from Asha Rao" });
    fireEvent.change(within(dialog).getByLabelText(/^Answer/), { target: { value: "Prorated." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send answer" }));
    expect(await within(dialog).findByText("You can't answer a question about your own payslip")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Send answer" }));
    expect(await within(dialog).findByText("This question was already answered or closed")).toBeInTheDocument();
  });

  it("shows an answered question read-only", async () => {
    signIn(ANSWERER);
    mockSearch = new URLSearchParams("tab=questions&modal=payslip-question&id=71");
    const answered = staffQuestion({ status: "ANSWERED", answer: "Prorated for unpaid leave.", answered_at: "2026-12-02T10:00:00Z", row_version: 2 });
    routes({ "/payroll/payslip-questions": { total: 1, items: [answered] }, "/payroll/payslip-questions/71": answered });
    render(<PayslipsPage />);
    const dialog = await screen.findByRole("dialog", { name: "Question from Asha Rao" });
    expect(await within(dialog).findByText("Prorated for unpaid leave.")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Send answer" })).not.toBeInTheDocument();
  });
});

describe("Why this amount? for payslip-only readers", () => {
  it("shows the explanation frozen on the payslip without asking for the run trace", async () => {
    signIn(READER);
    mockParams = { id: "501" };
    const detail = payslipDetail();
    detail.content.earnings = [{ ...detail.content.earnings[0], explanation: "Monthly basic for 30 of 30 paid days." }, { ...detail.content.earnings[1], explanation: null }];
    routes({ "/payroll/payslips/501": detail });
    render(<PayslipPage />);
    const why = await screen.findByRole("button", { name: "Why this amount? Basic" });
    expect(screen.queryByRole("button", { name: "Why this amount? House rent allowance" })).not.toBeInTheDocument();
    fireEvent.click(why);
    expect(await screen.findByText("Monthly basic for 30 of 30 paid days.")).toBeInTheDocument();
    expect(mockGet).not.toHaveBeenCalledWith("/payroll/runs/9/employees/77");
  });

  it("falls back to the frozen explanation when the run trace can't be loaded", async () => {
    signIn(me({ [P.PAYROLL_PAYSLIP_READ]: ["COMPANY"], [P.PAYROLL_RUN_READ]: ["COMPANY"] }));
    mockParams = { id: "501" };
    const detail = payslipDetail();
    detail.content.earnings = [{ ...detail.content.earnings[0], explanation: "Monthly basic for 30 of 30 paid days." }];
    routes({ "/payroll/runs": { total: 0, items: [] }, "/payroll/payslips/501": detail, "/payroll/runs/9/employees/77": payrollError(500, { detail: "boom" }) });
    render(<PayslipPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Why this amount? Basic" }));
    expect(await screen.findByText("Monthly basic for 30 of 30 paid days.")).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith("/payroll/runs/9/employees/77");
  });
});
