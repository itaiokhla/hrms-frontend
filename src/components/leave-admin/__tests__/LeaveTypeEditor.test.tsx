/**
 * Leave type editor (03-leave/01 §3.9, §11.3): usage from GET /leaves/v2/types/{id}, frozen fields once in use,
 * PUT with the row version (If-Match), the typed confirmation when a sensitive type becomes standard, and 409
 * ROW_VERSION_CONFLICT with Reload.
 */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { LeaveTypeEditor, bodyOf, formOf, validateTypeForm } from "@/components/leave-admin/LeaveTypeEditor";
import { http } from "@/lib/api";
import { LeaveAdminError, leaveAdminApi } from "@/lib/leave/adminApi";
import type { LeaveTypeV2 } from "@/lib/leave/adminTypes";

jest.mock("react-hot-toast", () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));
jest.mock("@/lib/api", () => {
  const actual = jest.requireActual("@/lib/api");
  return { ...actual, http: { ...actual.http, request: jest.fn() } };
});

const request = http.request as unknown as jest.Mock;

function leaveType(patch: Partial<LeaveTypeV2> = {}): LeaveTypeV2 {
  return {
    id: 7, code: "earned", name: "Earned Leave", display_name: "Earned Leave", description: null, kind: null, category: "ANNUAL",
    unit: "DAY", sensitivity: "STANDARD", absence_class: "PLANNED", counts_toward_absence_score: false, is_paid: true,
    is_unlimited: false, is_active: true, counts_non_working_days: false, allow_half_day: true, color_token: "leave-1",
    icon: "sun", display_order: 100, name_i18n: {}, annual_quota: 18, row_version: 4,
    usage: { leaves: 41, pending_requests: 2, ledger_rows: 120, employees_with_balance: 30, plans: [{ id: 3, name: "India office" }], events: 0, claims: 0, encashments: 0, in_use: true },
    ...patch,
  };
}

/** Route the mocked axios `request` by method + url. */
function serve(handlers: Record<string, (config: { data?: unknown; headers?: Record<string, string> }) => { status: number; data: unknown }>) {
  request.mockImplementation((config: { method: string; url: string; data?: unknown; headers?: Record<string, string> }) => {
    const handler = handlers[`${config.method.toUpperCase()} ${config.url}`];
    if (!handler) return Promise.reject(new Error(`unexpected ${config.method} ${config.url}`));
    return Promise.resolve(handler(config));
  });
}

beforeEach(() => request.mockReset());

describe("leave type editor", () => {
  it("locks code, kind, unit and unlimited when the type is in use and shows its usage", async () => {
    serve({ "GET /leaves/v2/types/7": () => ({ status: 200, data: leaveType() }) });
    render(<LeaveTypeEditor typeId={7} onSaved={jest.fn()} onCancel={jest.fn()} />);
    expect(await screen.findByTestId("type-usage")).toHaveTextContent("41 request(s)");
    expect(screen.getByTestId("type-usage")).toHaveTextContent("India office");
    expect(screen.getByTestId("type-code")).toBeDisabled();
    expect(screen.getByTestId("type-kind")).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Hours" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: /Unlimited/ })).toBeDisabled();
    // Fields that may still change stay editable.
    expect(screen.getByTestId("type-name")).not.toBeDisabled();
    expect(screen.getByTestId("type-category")).not.toBeDisabled();
  });

  it("keeps the code editable while the type is unused", async () => {
    serve({ "GET /leaves/v2/types/7": () => ({ status: 200, data: leaveType({ usage: { ...leaveType().usage!, in_use: false, leaves: 0, ledger_rows: 0, plans: [] } }) }) });
    render(<LeaveTypeEditor typeId={7} onSaved={jest.fn()} onCancel={jest.fn()} />);
    expect(await screen.findByTestId("type-code")).not.toBeDisabled();
  });

  it("saves every field with PUT and If-Match: row_version (bare integer) and an idempotency key", async () => {
    const onSaved = jest.fn();
    let sent: { data?: unknown; headers?: Record<string, string> } = {};
    serve({
      "GET /leaves/v2/types/7": () => ({ status: 200, data: leaveType() }),
      "PUT /leaves/v2/types/7": (config) => {
        sent = config;
        return { status: 200, data: leaveType({ name: "Earned Leave (2027)", row_version: 5 }) };
      },
    });
    render(<LeaveTypeEditor typeId={7} onSaved={onSaved} onCancel={jest.fn()} />);
    fireEvent.change(await screen.findByTestId("type-name"), { target: { value: "Earned Leave (2027)" } });
    fireEvent.click(screen.getByTestId("type-save"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(sent.headers?.["If-Match"]).toBe("4");
    expect(sent.headers?.["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);
    // The frozen fields go back unchanged; the body is the full LeaveTypeWriteV2.
    expect(sent.data).toMatchObject({
      code: "earned", kind: null, unit: "DAY", is_unlimited: false, name: "Earned Leave (2027)", category: "ANNUAL",
      sensitivity: "STANDARD", absence_class: "PLANNED", is_paid: true, is_active: true, counts_non_working_days: false,
      allow_half_day: true, color_token: "leave-1", icon: "sun", display_order: 100, annual_quota: 18, name_i18n: {},
    });
    expect(Object.keys(sent.data as object)).not.toContain("row_version");
  });

  it("asks for a reason and the typed code before a sensitive type becomes standard", async () => {
    let sent: unknown = null;
    serve({
      "GET /leaves/v2/types/7": () => ({ status: 200, data: leaveType({ code: "sick", name: "Sick Leave", category: "SICK", sensitivity: "SENSITIVE", absence_class: "PROTECTED" }) }),
      "PUT /leaves/v2/types/7": (config) => {
        sent = config.data;
        return { status: 200, data: leaveType() };
      },
    });
    render(<LeaveTypeEditor typeId={7} onSaved={jest.fn()} onCancel={jest.fn()} />);
    fireEvent.click(await screen.findByRole("radio", { name: "Standard" }));
    expect(screen.getByTestId("lower-sensitivity")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("type-save"));
    expect(await screen.findByText("Give a reason of at least 10 characters.")).toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(1); // only the GET

    fireEvent.change(screen.getByTestId("lower-reason"), { target: { value: "Works council agreed to show sick leave." } });
    fireEvent.change(screen.getByTestId("lower-confirm"), { target: { value: "SICK" } });
    fireEvent.click(screen.getByTestId("type-save"));
    expect(await screen.findByText("Type the code sick exactly.")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("lower-confirm"), { target: { value: "sick" } });
    fireEvent.click(screen.getByTestId("type-save"));
    await waitFor(() => expect(sent).toMatchObject({ sensitivity: "STANDARD", reason: "Works council agreed to show sick leave.", confirm_code: "sick" }));
  });

  it("offers Reload on 409 ROW_VERSION_CONFLICT", async () => {
    let gets = 0;
    serve({
      "GET /leaves/v2/types/7": () => ({ status: 200, data: leaveType({ row_version: 4 + gets++ }) }),
      "PUT /leaves/v2/types/7": () => ({ status: 409, data: { detail: "This leave type was changed by someone else. Reload it and try again.", code: "ROW_VERSION_CONFLICT" } }),
    });
    render(<LeaveTypeEditor typeId={7} onSaved={jest.fn()} onCancel={jest.fn()} />);
    fireEvent.change(await screen.findByTestId("type-name"), { target: { value: "x" } });
    fireEvent.click(screen.getByTestId("type-save"));
    expect(await screen.findByText("Someone changed this type. Reload to see their changes.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Reload/ }));
    await waitFor(() => expect(gets).toBe(2));
  });

  it("explains frozen-field refusals from the server", async () => {
    serve({
      "GET /leaves/v2/types/7": () => ({ status: 200, data: leaveType({ usage: { ...leaveType().usage!, in_use: false } }) }),
      "PUT /leaves/v2/types/7": () => ({
        status: 409,
        data: { detail: { message: "This leave type is in use: create a new type instead of changing unit.", details: { fields: ["unit"] } }, code: "LEAVE_TYPE_FIELD_FROZEN" },
      }),
    });
    render(<LeaveTypeEditor typeId={7} onSaved={jest.fn()} onCancel={jest.fn()} />);
    fireEvent.click(await screen.findByRole("radio", { name: "Hours" }));
    fireEvent.click(screen.getByTestId("type-save"));
    expect(await screen.findByText(/create a new type instead of changing unit/)).toBeInTheDocument();
  });

  it("creates with POST and without If-Match", async () => {
    let sent: { data?: unknown; headers?: Record<string, string> } = {};
    serve({ "POST /leaves/v2/types": (config) => ((sent = config), { status: 201, data: leaveType({ id: 9 }) }) });
    const onSaved = jest.fn();
    render(<LeaveTypeEditor onSaved={onSaved} onCancel={jest.fn()} />);
    fireEvent.change(screen.getByTestId("type-name"), { target: { value: "Study Leave" } });
    fireEvent.change(screen.getByTestId("type-code"), { target: { value: "study leave" } });
    fireEvent.change(screen.getByTestId("type-category"), { target: { value: "STUDY" } });
    fireEvent.click(screen.getByTestId("type-save"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(sent.headers?.["If-Match"]).toBeUndefined();
    expect(sent.data).toMatchObject({ code: "study_leave", name: "Study Leave", category: "STUDY", icon: "graduation-cap" });
  });
});

describe("type form helpers", () => {
  it("validates the server's limits", () => {
    const form = { ...formOf(null), name: "", code: "9x", display_order: "10001", annual_quota: "400", icon: "Bad Icon" };
    expect(Object.keys(validateTypeForm(form)).sort()).toEqual(["annual_quota", "code", "display_order", "icon", "name"]);
    expect(validateTypeForm({ ...formOf(null), name: "Comp", code: "comp", kind: "COMP_OFF", category: "OTHER" }).category).toBeDefined();
  });

  it("forces the server's combinations in the body", () => {
    const body = bodyOf({ ...formOf(null), name: "Unpaid", code: "unpaid", category: "UNPAID", is_paid: true, absence_class: "PROTECTED", counts_toward_absence_score: true });
    expect(body.is_paid).toBe(false);
    expect(body.counts_toward_absence_score).toBe(false);
    expect(bodyOf({ ...formOf(null), kind: "EVENT", is_unlimited: true }).is_unlimited).toBe(false);
  });

  it("keeps structured server errors", () => {
    const error = new LeaveAdminError(409, "x", "LEAVE_TYPE_FIELD_FROZEN", [{ field: "unit", message: "x" }]);
    expect(error.status).toBe(409);
    expect(leaveAdminApi.updateType).toBeDefined();
  });
});
