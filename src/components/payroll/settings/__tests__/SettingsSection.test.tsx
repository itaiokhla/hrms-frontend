import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { payrollError } from "@/lib/payroll/api";
import { P, type PermissionCode, type Scope } from "@/lib/permissions.generated";
import type { Me } from "@/lib/types";
import { useSession } from "@/store/session";

import { localTodayISO, sectionBySlug } from "../model";
import { SettingsSection } from "../SettingsSection";
import type { PolicyRow, SettingValueItem, ValuesResponse } from "../types";

const replace = jest.fn();
const push = jest.fn();
let search = new URLSearchParams();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push, back: jest.fn() }),
  usePathname: () => "/settings/payroll/overtime",
  useSearchParams: () => search,
}));

const get = jest.fn();
jest.mock("@/lib/api", () => {
  const actual = jest.requireActual("@/lib/api");
  return { ...actual, api: { ...actual.api, get: (...args: unknown[]) => get(...args) } };
});
jest.mock("react-hot-toast", () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));

const values = jest.fn();
const save = jest.fn();
jest.mock("../settingsApi", () => {
  const actual = jest.requireActual("../settingsApi");
  return {
    ...actual,
    settingsApi: { ...actual.settingsApi, values: (...a: unknown[]) => values(...a), save: (...a: unknown[]) => save(...a) },
  };
});

function me(permissions: Partial<Record<PermissionCode, Scope[]>>): Me {
  return {
    user: { id: 7, email: "pm@acme.io", full_name: "Pat Manager", mfa_enabled: true, permission_version: 1, last_login_at: null },
    company: { id: 1, name: "Acme", slug: "acme", timezone: "Asia/Kolkata", currency: "INR", subscription: { status: "active", plan: "pro", trial_ends_at: null, active: true } },
    employee: null,
    roles: [],
    permissions,
    is_company_admin: false,
    registry_version: "test",
  };
}

const MANAGER = me({
  [P.PAYROLL_CONFIGURATION_READ]: ["COMPANY"],
  [P.PAYROLL_CONFIGURATION_WRITE]: ["COMPANY"],
  [P.ORG_READ]: ["COMPANY"],
});

function overtimeItem(overrides: Partial<SettingValueItem> = {}): SettingValueItem {
  return {
    key: "payroll.overtime.enabled",
    value: false,
    level: "TENANT",
    badge: { code: "SET_HERE", label: "Set here", level: "TENANT" },
    locked_by: null,
    legal_limit: [],
    effective_from: "2026-10-01",
    effective_to: null,
    editable: true,
    row_version: 3,
    here: { row_id: 11, value: false, locked: false, effective_from: "2026-10-01", effective_to: null, source: "STARTER_PROFILE", profile_version: "STARTER_V1", reason: "Starter configuration" },
    shadowed: [],
    valid: true,
    issues: [],
    pending: null,
    ...overrides,
  };
}

function response(items: SettingValueItem[], scope = { scope_type: "TENANT", scope_id: null as number | null, name: "Company" }): ValuesResponse {
  return { scope, as_of: localTodayISO(), registry_version: "x", profile_version: "STARTER_V1", items, issues: [] };
}

const POLICY: PolicyRow = {
  id: 5, type: "OVERTIME_POLICY", name: "Default overtime", description: null, status: "ACTIVE", active_version: null,
  latest_version: 1, draft_versions: [1], rule_count: 1, created_at: null,
};

function routeGets(extra: Record<string, unknown> = {}) {
  get.mockImplementation((url: string) => {
    if (url in extra) return Promise.resolve(extra[url]);
    if (url === "/legal-entities") return Promise.resolve([{ id: 3, legal_name: "Acme India Pvt Ltd" }]);
    if (url === "/branches") return Promise.resolve([]);
    if (url === "/payroll/org/pay-groups") return Promise.resolve([{ id: 9, name: "Staff Monthly", legal_entity_id: 3, status: "ACTIVE" }]);
    if (url === "/payroll/policies") return Promise.resolve([POLICY]);
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

async function renderSection(user: Me = MANAGER) {
  act(() => useSession.setState({ me: user, status: "authenticated" }));
  render(<SettingsSection section={sectionBySlug("overtime")!} />);
  return screen.findByRole("switch", { name: "Overtime pay" });
}

beforeEach(() => {
  jest.clearAllMocks();
  search = new URLSearchParams();
  routeGets();
  values.mockResolvedValue(response([overtimeItem()]));
});

describe("Settings › Payroll › Overtime", () => {
  it("shows the switch with its consequences, inheritance, the open decision and the policies", async () => {
    const toggle = await renderSection();
    expect(screen.getByRole("heading", { name: "Overtime", level: 1 })).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toBeEnabled();
    expect(screen.getByText("Approved overtime is paid by multiplier buckets.")).toBeInTheDocument();
    expect(screen.getByText(/No overtime earnings/)).toBeInTheDocument();
    expect(screen.getByText("Overridden here")).toBeInTheDocument();
    expect(screen.getByText(/enter the multipliers in the overtime policy/)).toBeInTheDocument();
    // The scope bar starts at the company level and offers the entity the user can open.
    expect(screen.getByRole("radio", { name: "Tenant" })).toHaveAttribute("aria-checked", "true");
    await waitFor(() => expect(screen.getByRole("radio", { name: "Legal entity" })).toBeEnabled());
    expect(values).toHaveBeenCalledWith({ scope_type: "TENANT", scope_id: null, name: "Company" }, localTodayISO());
    expect(await screen.findByText("Default overtime")).toBeInTheDocument();
    expect(screen.getByText("Not active: it changes nobody's pay yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add policy/ })).toBeInTheDocument();
  });

  it("saves the changed key with its row version, scope, effective date and an Idempotency-Key", async () => {
    save.mockResolvedValue({
      changes: [{ key: "payroll.overtime.enabled", scope: { scope_type: "TENANT", scope_id: null, name: "Company" }, effective_from: localTodayISO(),
        resolution_grain: "DAY", status: "ACTIVE", row_id: 12, row_version: 4, message: "Applies from today." }],
      warnings: [],
    });
    const toggle = await renderSection();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.click(toggle);
    expect(screen.getByText("1 unsaved change")).toBeInTheDocument();
    expect(screen.getByText(/Day settings: Applies from/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const [changes, key] = save.mock.calls[0];
    expect(changes).toEqual([
      { key: "payroll.overtime.enabled", scope_type: "TENANT", scope_id: null, value: true, row_version: 3, effective_from: localTodayISO() },
    ]);
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByText("Applies from today.")).toBeInTheDocument();
    expect(values).toHaveBeenCalledTimes(2); // reloaded after saving
  });

  it("shows a 409 conflict with the other person's value and reloads on request", async () => {
    save.mockRejectedValue(
      payrollError(409, {
        code: "STALE_ROW_VERSION",
        detail: { message: "Overtime pay was changed by someone else. Review the current value and save again.", key: "payroll.overtime.enabled", current: { value: true, row_version: 4 } },
      }),
    );
    fireEvent.click(await renderSection());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const banner = await screen.findByText("Someone else changed this");
    const box = banner.closest("[role=alert]") as HTMLElement;
    expect(within(box).getByText(/changed by someone else/)).toBeInTheDocument();
    expect(within(box).getByText("Overtime pay now").nextSibling).toHaveTextContent("On");
    fireEvent.click(within(box).getByRole("button", { name: /Reload latest values/ }));
    await waitFor(() => expect(values).toHaveBeenCalledTimes(2));
    expect(screen.getByText("No unsaved changes.")).toBeInTheDocument();
  });

  it("EC-UX-04: a re-read after changing the effective date keeps the row version the edit was based on", async () => {
    // Gate-chrome regression (24 Oct, Chrome): tab 2 edited a value, then picked a future effective date; the
    // section re-read the values (now including tab 1's newer save, row version 4) and the save carried 4, so
    // tab 1's value was overwritten without the conflict banner.
    save.mockRejectedValue(
      payrollError(409, {
        code: "STALE_ROW_VERSION",
        detail: { message: "Overtime pay was changed by someone else. Review the current value and save again.", key: "payroll.overtime.enabled", current: { value: true, row_version: 4 } },
      }),
    );
    fireEvent.click(await renderSection()); // edit based on row version 3
    values.mockResolvedValue(response([overtimeItem({ row_version: 4 })])); // someone else saved meanwhile
    fireEvent.change(screen.getByLabelText("Effective from"), { target: { value: "2027-01-01" } });
    await waitFor(() => expect(values).toHaveBeenCalledWith({ scope_type: "TENANT", scope_id: null, name: "Company" }, "2027-01-01"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: "test" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0][0]).toMatchObject({ key: "payroll.overtime.enabled", row_version: 3, effective_from: "2027-01-01" });
    expect(await screen.findByText("Someone else changed this")).toBeInTheDocument();
  });

  it("shows V-xx validation issues next to the control and in the summary", async () => {
    save.mockRejectedValue(
      payrollError(400, {
        code: "SETTINGS_INVALID",
        detail: { message: "Overtime needs multipliers", issues: [{ rule: "V-04", severity: "ERROR", keys: ["payroll.overtime.enabled"], message: "Overtime needs multipliers in an active policy." }] },
      }),
    );
    fireEvent.click(await renderSection());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Fix these before saving")).toBeInTheDocument();
    expect(screen.getAllByText(/Overtime needs multipliers in an active policy/).length).toBeGreaterThanOrEqual(2);
  });

  it("is read-only for configuration readers", async () => {
    const toggle = await renderSection(me({ [P.PAYROLL_CONFIGURATION_READ]: ["COMPANY"], [P.ORG_READ]: ["COMPANY"] }));
    expect(toggle).toBeDisabled();
    expect(screen.getByText(/You can view this setting but not change it/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Add policy/ })).not.toBeInTheDocument();
  });

  it("disables a value locked by a broader level, naming the level", async () => {
    values.mockResolvedValue(response([overtimeItem({ badge: { code: "LOCKED", label: "Locked by tenant", level: "TENANT" }, here: null, editable: true })],
      { scope_type: "LEGAL_ENTITY", scope_id: 3, name: "Acme India Pvt Ltd" }));
    search = new URLSearchParams("scope=LEGAL_ENTITY&id=3");
    const toggle = await renderSection();
    expect(toggle).toBeDisabled();
    expect(screen.getAllByText("Locked by tenant").length).toBeGreaterThan(0);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ scope_type: "LEGAL_ENTITY", scope_id: 3 }), localTodayISO());
  });

  it("entity-scoped readers get their own entities from the access preview", async () => {
    routeGets({
      "/payroll/access-preview": {
        permissions: [{ permission: P.PAYROLL_CONFIGURATION_READ, grants: [{ scope: "LEGAL_ENTITY", targets: [{ id: 3, name: "Acme India Pvt Ltd" }] }] }],
      },
    });
    search = new URLSearchParams("scope=LEGAL_ENTITY&id=3");
    values.mockResolvedValue(response([overtimeItem({ badge: { code: "INHERITED", label: "Inherited from tenant", level: "TENANT" }, here: null })],
      { scope_type: "LEGAL_ENTITY", scope_id: 3, name: "Acme India Pvt Ltd" }));
    await renderSection(me({ [P.PAYROLL_CONFIGURATION_READ]: ["LEGAL_ENTITY"], [P.PAYROLL_CONFIGURATION_WRITE]: ["LEGAL_ENTITY"] }));
    expect(get).toHaveBeenCalledWith("/payroll/access-preview");
    expect(get).not.toHaveBeenCalledWith("/legal-entities");
    expect(await screen.findByRole("option", { name: "Acme India Pvt Ltd" })).toBeInTheDocument();
    expect(screen.getByText("Inherited from tenant")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Overtime pay" })).toBeEnabled();
  });
});
