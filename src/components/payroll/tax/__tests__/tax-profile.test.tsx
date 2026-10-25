import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import ComplianceRoute from "@/app/(app)/payroll/compliance/page";
import MyTaxRoute from "@/app/(app)/me/tax/page";
import { payrollError } from "@/lib/payroll/api";
import { P } from "@/lib/permissions.generated";

import { me, notFound, signIn } from "../../me/__tests__/fixtures";
import type { MyTaxProfile, StaffTaxVersion, TaxField, TaxVersion } from "../types";

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockSearch = new URLSearchParams();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn() }),
  usePathname: () => "/payroll/compliance",
  useSearchParams: () => mockSearch,
  useParams: () => ({}),
}));
const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock("react-hot-toast", () => ({ __esModule: true, default: { success: (...a: unknown[]) => mockToast.success(...a), error: (...a: unknown[]) => mockToast.error(...a) } }));

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPut = jest.fn();
jest.mock("@/lib/payroll/api", () => {
  const actual = jest.requireActual("@/lib/payroll/api");
  return {
    ...actual,
    payrollApi: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a), put: (...a: unknown[]) => mockPut(...a), patch: jest.fn(), delete: jest.fn() },
    stepUpApi: { status: () => Promise.resolve({ active: true }), emailCode: jest.fn(), verify: jest.fn() },
  };
});
const mockHttpGet = jest.fn();
jest.mock("@/lib/api", () => {
  const actual = jest.requireActual("@/lib/api");
  return { ...actual, http: { ...actual.http, get: (...a: unknown[]) => mockHttpGet(...a) } };
});

/* ------------------------------------------------------------------ fixtures */

const FIXTURE_NOTE = "FIXTURE — not law: illustrative field of the fixture, not a statement of law.";
const field = (over: Partial<TaxField> & Pick<TaxField, "code" | "label" | "type">): TaxField => ({
  required: false, help: "", group: "Details", note: FIXTURE_NOTE, proof_required: false, choices: [], minimum: null, maximum: null,
  min_length: 0, max_length: null, sensitive: false, ...over,
});
const SCHEMA: TaxField[] = [
  field({ code: "regime", label: "Tax regime", type: "ENUM", group: "Regime and elections", choices: [{ value: "NEW", label: "New regime" }, { value: "OLD", label: "Old regime" }], help: "The fixture withholds tax for the new regime only." }),
  field({ code: "previous_employment.income", label: "Income from a previous employer this tax year", type: "MONEY", group: "Previous employment", proof_required: true, minimum: "0" }),
  field({ code: "previous_employment.tax", label: "Tax already withheld by a previous employer", type: "MONEY", group: "Previous employment", minimum: "0" }),
  field({ code: "tax_id", label: "Tax identifier", type: "IDENTIFIER", group: "Identifiers", max_length: 20, sensitive: true }),
];
const PACK = { code: "IN", version: "IN-2026.10-FIXTURE", name: "India (FIXTURE — not law)", country: "IN", currency: "INR", status: "DRAFT", is_fixture: true, usage: "FIXTURE", label: "FIXTURE — not law: pack IN-2026.10-FIXTURE is test data." };

function version(over: Partial<TaxVersion> = {}): TaxVersion {
  return {
    id: 9, version_no: 1, status: "SUBMITTED", country: "IN", pack_code: "IN", effective_from: "2026-04-01",
    values: { regime: "NEW", "previous_employment.income": "250000.00", "previous_employment.tax": "12000.00" },
    identifiers: {}, proofs: [], proofs_missing: ["previous_employment.income"], schema_current: true,
    submitted_at: "2026-10-20T09:00:00+00:00", reviewed_at: null, review_note: null, withdrawn_at: null, row_version: 1, ...over,
  };
}

function profile(over: Partial<MyTaxProfile> = {}): MyTaxProfile {
  return {
    employee_id: 42, as_of: "2026-10-24", can_edit: true, legal_entity: { id: 1, name: "Acme India", country_code: "IN" }, country: "IN",
    available: true, reason: null, message: null, pack: PACK, currency: "INR", schema: SCHEMA, schema_hash: "h", current: null,
    pending: null, latest: null, versions: [], ...over,
  };
}

const UNAVAILABLE = profile({
  available: false, reason: "NO_PACK_FIELDS", message: "Tax declarations are not available for your country yet.", pack: null, currency: null, schema: [], schema_hash: null, country: "AE",
});

function serve(routes: Record<string, unknown>) {
  mockGet.mockImplementation((url: string) => {
    if (!(url in routes)) return Promise.reject(notFound("Route"));
    const value = routes[url];
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = new URLSearchParams();
  mockPut.mockResolvedValue({ id: 10, version_no: 2, status: "SUBMITTED", row_version: 1, effective_from: "2026-10-24" });
  mockPost.mockResolvedValue({ id: 9, version_no: 1, status: "WITHDRAWN", row_version: 2, effective_from: "2026-04-01" });
  jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = jest.fn(() => "blob:x");
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = jest.fn();
});

const TAX = "/me/payroll/tax-profile";

/* ------------------------------------------------------------------ My Tax */

describe("My Tax", () => {
  it("says plainly that nothing is asked for a country whose pack declares no fields, and shows no form", async () => {
    signIn(me());
    serve({ [TAX]: UNAVAILABLE });
    render(<MyTaxRoute />);
    expect(await screen.findByText("Not available for your country yet")).toBeInTheDocument();
    expect(screen.getByText(/Tax declarations are not available for your country yet\./)).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Tax declarations" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Send for review/ })).not.toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith(TAX);
  });

  it("is denied without tax profile access and explains a missing employee record", () => {
    signIn(me({ [P.PAYROLL_LOANS_READ]: ["SELF"] }));
    render(<MyTaxRoute />);
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("renders the form the pack defines, with its labels, help and honesty notes", async () => {
    signIn(me());
    serve({ [TAX]: profile() });
    render(<MyTaxRoute />);
    const form = await screen.findByRole("form", { name: "Tax declarations" });
    expect(within(form).getByLabelText("Tax regime")).toBeInTheDocument();
    expect(within(form).getByLabelText(/Income from a previous employer this tax year \(INR\)/)).toBeInTheDocument();
    expect(within(form).getByLabelText(/Tax identifier/)).toBeInTheDocument();
    expect(within(form).getByText("Previous employment")).toBeInTheDocument();
    expect(within(form).getByText("The fixture withholds tax for the new regime only.")).toBeInTheDocument();
    expect(within(form).getAllByText(FIXTURE_NOTE).length).toBe(4);
    expect(within(form).getByText(/HR needs a proof for this/)).toBeInTheDocument();
    // The pack's own label is shown as sent, never reworded.
    expect(screen.getByText(PACK.label)).toBeInTheDocument();
  });

  it("checks the entries before sending and refuses a comma in an amount", async () => {
    signIn(me());
    serve({ [TAX]: profile() });
    render(<MyTaxRoute />);
    const form = await screen.findByRole("form", { name: "Tax declarations" });
    fireEvent.change(within(form).getByLabelText(/Income from a previous employer/), { target: { value: "12,00" } });
    fireEvent.click(screen.getByRole("button", { name: /Send for review/ }));
    expect(await screen.findAllByText(/enter an amount such as 1200\.50/)).not.toHaveLength(0);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("sends the declarations as text money with the effective date, a typed identifier and no empty fields", async () => {
    signIn(me());
    serve({ [TAX]: profile() });
    render(<MyTaxRoute />);
    const form = await screen.findByRole("form", { name: "Tax declarations" });
    fireEvent.change(within(form).getByLabelText("Tax regime"), { target: { value: "NEW" } });
    fireEvent.change(within(form).getByLabelText(/Income from a previous employer/), { target: { value: "250000.00" } });
    fireEvent.change(within(form).getByLabelText(/Tax identifier/), { target: { value: "ABCDE1234F" } });
    fireEvent.click(screen.getByRole("button", { name: /Send for review/ }));
    await waitFor(() => expect(mockPut).toHaveBeenCalledTimes(1));
    const [path, body, options] = mockPut.mock.calls[0];
    expect(path).toBe(TAX);
    expect(body).toEqual({ values: { regime: "NEW", "previous_employment.income": "250000.00", tax_id: "ABCDE1234F" }, effective_from: "2026-10-24" });
    expect(typeof body.values["previous_employment.income"]).toBe("string");
    expect(options.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Your declarations were sent to HR for review."));
    await waitFor(() => expect(mockGet.mock.calls.filter(([u]) => u === TAX).length).toBeGreaterThan(1));
  });

  it("shows the server's message under the field it belongs to, even for a dotted field code", async () => {
    signIn(me());
    serve({ [TAX]: profile() });
    mockPut.mockRejectedValue(
      payrollError(422, { detail: [{ field: "previous_employment.income", msg: "Income from a previous employer: at most the INR minor-unit digits.", code: "TOO_MANY_DECIMALS" }], code: "TAX_PROFILE_INVALID" }),
    );
    render(<MyTaxRoute />);
    const form = await screen.findByRole("form", { name: "Tax declarations" });
    fireEvent.change(within(form).getByLabelText(/Income from a previous employer/), { target: { value: "1.005" } });
    fireEvent.click(screen.getByRole("button", { name: /Send for review/ }));
    const field = within(form).getByLabelText(/Income from a previous employer/);
    await waitFor(() => expect(field).toHaveAttribute("aria-invalid", "true"));
    expect(within(form).getAllByText(/at most the INR minor-unit digits/).length).toBeGreaterThan(0);
  });

  it("shows a pending submission with its status, values and the proof it still needs, and no second form", async () => {
    signIn(me());
    const pending = version();
    serve({ [TAX]: profile({ pending, latest: pending, versions: [pending] }) });
    render(<MyTaxRoute />);
    const panel = await screen.findByLabelText("Submission waiting for review");
    expect(within(panel).getByText("Submitted")).toBeInTheDocument();
    expect(within(panel).getByText("Waiting for HR to review. Applies from 1 Apr 2026. Withdraw it to change something and send it again.")).toBeInTheDocument();
    expect(within(panel).getByText("New regime")).toBeInTheDocument();
    expect(within(panel).getByText(/2,50,000\.00|250,000\.00/)).toBeInTheDocument();
    expect(within(panel).getByText("Proof required")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Tax declarations" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Update my declarations" })).not.toBeInTheDocument();
  });

  it("withdraws the pending version with its row version and opens the form again", async () => {
    signIn(me());
    const pending = version({ row_version: 3 });
    serve({ [TAX]: profile({ pending, latest: pending, versions: [pending] }) });
    render(<MyTaxRoute />);
    fireEvent.click(await screen.findByRole("button", { name: /Withdraw/ }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/me/payroll/tax-profile/versions/9/withdraw", { row_version: 3 }));
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Your submission was withdrawn."));
  });

  it("uploads a proof for a field with its code, as a file, and lists existing proofs for download", async () => {
    signIn(me());
    const pending = version({
      proofs: [{ id: 3, field_code: "regime", file_name: "regime-note.pdf", mime: "application/pdf", bytes: 2048, sha256: "a".repeat(64), uploaded_at: null }],
    });
    serve({ [TAX]: profile({ pending, latest: pending, versions: [pending] }) });
    mockHttpGet.mockResolvedValue({ data: new Blob(["x"]), headers: { "content-disposition": 'attachment; filename="regime-note.pdf"' } });
    render(<MyTaxRoute />);
    const row = (await screen.findByText("Income from a previous employer this tax year", { selector: "span" })).closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: /Add proof/ }));
    const input = await within(row).findByLabelText(/Upload a proof for Income from a previous employer/);
    const file = new File(["%PDF-1.4"], "slip.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    const [path, body] = mockPost.mock.calls[0];
    expect(path).toBe("/me/payroll/tax-profile/versions/9/proofs");
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get("field_code")).toBe("previous_employment.income");
    expect(((body as FormData).get("file") as File).name).toBe("slip.pdf");
    // An existing proof downloads through the session, by the employee's own path.
    const regime = screen.getByText("Tax regime", { selector: "span" }).closest("li") as HTMLElement;
    fireEvent.click(within(regime).getByRole("button", { name: "Download regime-note.pdf" }));
    await waitFor(() => expect(mockHttpGet).toHaveBeenCalledWith("/me/payroll/tax-profile/versions/9/proofs/3", { responseType: "blob" }));
  });

  it("shows the in-force declarations with the identifier masked, and keeps it empty in the next form", async () => {
    signIn(me());
    const approved = version({
      status: "APPROVED", proofs_missing: [], reviewed_at: "2026-10-21T10:00:00+00:00", review_note: "Checked",
      identifiers: { tax_id: "••••234F" },
    });
    serve({ [TAX]: profile({ current: approved, latest: approved, versions: [approved] }) });
    render(<MyTaxRoute />);
    const card = await screen.findByLabelText("Declarations in force");
    expect(within(card).getByText("Approved")).toBeInTheDocument();
    expect(within(card).getByText("••••234F")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("ABCDE1234F");
    fireEvent.click(screen.getByRole("button", { name: "Update my declarations" }));
    const id = (await screen.findByRole("form", { name: "Tax declarations" })).querySelector('input[placeholder^="On file"]') as HTMLInputElement;
    expect(id.value).toBe("");
    expect(id.placeholder).toContain("••••234F");
    // The amounts of the approved version start the next one.
    expect((screen.getByLabelText(/Income from a previous employer/) as HTMLInputElement).value).toBe("250000.00");
  });

  it("shows why HR rejected a version and lets the employee send it again", async () => {
    signIn(me());
    const rejected = version({ status: "REJECTED", review_note: "The proof does not show the employer", reviewed_at: "2026-10-21T10:00:00+00:00" });
    serve({ [TAX]: profile({ latest: rejected, versions: [rejected] }) });
    render(<MyTaxRoute />);
    expect(await screen.findByText("Version #1 was not approved")).toBeInTheDocument();
    expect(screen.getAllByText("The proof does not show the employer").length).toBeGreaterThan(0);
    expect(screen.getByRole("form", { name: "Tax declarations" })).toBeInTheDocument();
    const history = screen.getByRole("table", { name: "Tax declaration versions" });
    expect(within(history).getByText("Rejected")).toBeInTheDocument();
  });

  it("is read-only when the person may not edit", async () => {
    signIn(me());
    serve({ [TAX]: profile({ can_edit: false }) });
    render(<MyTaxRoute />);
    expect(await screen.findByText("You can read but not change your declarations")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Tax declarations" })).not.toBeInTheDocument();
  });

  it("shows an error state with a retry when the profile cannot be read", async () => {
    signIn(me());
    serve({ [TAX]: payrollError(500, { detail: "Database unavailable" }) });
    render(<MyTaxRoute />);
    expect(await screen.findByText("Database unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ HR review */

function staff(over: Partial<StaffTaxVersion> = {}): StaffTaxVersion {
  return {
    ...version(), employee_id: 77, legal_entity_id: 1, submitted_by_user_id: 5, reviewed_by_user_id: null,
    employee: { id: 77, name: "Emma Test", employee_code: "E0077" }, schema: SCHEMA, currency: "INR", is_own: false, ...over,
  };
}
const list = (items: StaffTaxVersion[]) => ({ total: items.length, counts: { SUBMITTED: items.filter((i) => i.status === "SUBMITTED").length }, items });
const REVIEWER = me({ [P.PAYROLL_TAX_PROFILE_REVIEW]: ["COMPANY"] });
const BOTH = me({ [P.PAYROLL_TAX_PROFILE_REVIEW]: ["COMPANY"], [P.PAYROLL_STATUTORY_REVIEW]: ["COMPANY"] });

describe("Tax declarations review", () => {
  it("is denied without review or statutory access", () => {
    signIn(me({ [P.PAYROLL_TAX_PROFILE_READ]: ["SELF"] }));
    render(<ComplianceRoute />);
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
  });

  it("opens straight on the declarations for a reviewer without statutory access, with no tab bar", async () => {
    signIn(REVIEWER);
    serve({ "/payroll/tax-profiles": list([staff()]) });
    render(<ComplianceRoute />);
    expect(await screen.findByRole("heading", { name: "Tax declarations" })).toBeInTheDocument();
    expect((await screen.findAllByText("Emma Test")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("tab", { name: "Statutory" })).not.toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith("/payroll/tax-profiles", { params: { status: "SUBMITTED", limit: 100 } });
  });

  it("offers both tabs to someone with both and keeps the tab in the URL", async () => {
    signIn(BOTH);
    serve({ "/payroll/compliance": { as_of: "2026-10-24", environment: "TEST", entities: [] }, "/payroll/liabilities": { total: 0, items: [], totals: {} } });
    render(<ComplianceRoute />);
    expect(await screen.findByRole("tab", { name: "Statutory" })).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Tax declarations" }));
    fireEvent.click(screen.getByRole("tab", { name: "Tax declarations" }));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/payroll/compliance?tab=tax"));
  });

  it("opens the tax tab from the link a notification uses", async () => {
    signIn(BOTH);
    mockSearch = new URLSearchParams("tab=tax");
    serve({ "/payroll/tax-profiles": list([]) });
    render(<ComplianceRoute />);
    expect(await screen.findByText("Nothing to review")).toBeInTheDocument();
  });

  it("explains what blocks an approval: a missing proof, or the reviewer's own declarations", async () => {
    signIn(REVIEWER);
    serve({ "/payroll/tax-profiles": list([staff(), staff({ id: 12, employee_id: 42, is_own: true, proofs_missing: [], employee: { id: 42, name: "Me Myself", employee_code: "E0042" } })]) });
    render(<ComplianceRoute />);
    fireEvent.click((await screen.findAllByText("Emma Test"))[0]);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("A proof the country's rules ask for is still missing.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Approve/ })).toBeDisabled();
    expect(within(dialog).getByText("Proof required")).toBeInTheDocument();
  });

  it("blocks a reviewer from reviewing their own declarations in the screen as well as on the server", async () => {
    signIn(REVIEWER);
    serve({ "/payroll/tax-profiles": list([staff({ id: 12, employee_id: 42, is_own: true, proofs_missing: [], employee: { id: 42, name: "Me Myself", employee_code: "E0042" } })]) });
    render(<ComplianceRoute />);
    fireEvent.click((await screen.findAllByText("Me Myself"))[0]);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("You cannot review your own declarations: someone else has to.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Approve/ })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: /Reject/ })).toBeDisabled();
  });

  it("approves with a note after confirming, sending the row version", async () => {
    signIn(REVIEWER);
    serve({ "/payroll/tax-profiles": list([staff({ proofs_missing: [], proofs: [{ id: 4, field_code: "previous_employment.income", file_name: "slip.pdf", mime: "application/pdf", bytes: 100, sha256: "b".repeat(64), uploaded_at: null }], identifiers: { tax_id: "••••234F" } })]) });
    render(<ComplianceRoute />);
    fireEvent.click((await screen.findAllByText("Emma Test"))[0]);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("••••234F")).toBeInTheDocument();
    expect(within(dialog).getByText("slip.pdf")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /Approve/ }));
    fireEvent.change(within(dialog).getByLabelText(/Note \(optional\)/), { target: { value: "Matches the slip" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm approval" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/tax-profiles/9/approve", { note: "Matches the slip", row_version: 1 }));
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Declarations approved. Payroll uses them from their start date."));
  });

  it("needs a reason to reject and shows a stale-version conflict with Reload", async () => {
    signIn(REVIEWER);
    serve({ "/payroll/tax-profiles": list([staff()]) });
    render(<ComplianceRoute />);
    fireEvent.click((await screen.findAllByText("Emma Test"))[0]);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Reject/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm rejection" }));
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockToast.error).toHaveBeenCalledWith("Write the reason for rejecting.");
    mockPost.mockRejectedValue(payrollError(409, { detail: { message: "The declaration was changed by someone else. Reload it." }, code: "ROW_VERSION_CONFLICT" }));
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Proof unreadable" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm rejection" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/tax-profiles/9/reject", { note: "Proof unreadable", row_version: 1 }));
    expect(await within(dialog).findByRole("button", { name: /Reload/ })).toBeInTheDocument();
  });

  it("filters by status and shows the empty state", async () => {
    signIn(REVIEWER);
    serve({ "/payroll/tax-profiles": list([]) });
    render(<ComplianceRoute />);
    expect(await screen.findByText("Nothing to review")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Approved" }));
    fireEvent.click(screen.getByRole("tab", { name: "Approved" }));
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/payroll/tax-profiles", { params: { status: "APPROVED", limit: 100 } }));
  });
});
