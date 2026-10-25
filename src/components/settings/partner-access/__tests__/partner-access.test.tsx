import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import PartnerAccessRoute from "@/app/(app)/settings/partner-access/page";
import { settingsNavFor } from "@/lib/settings-nav";
import { P, type PermissionCode, type Scope } from "@/lib/permissions.generated";
import type { Me } from "@/lib/types";
import { useSession } from "@/store/session";

import { stillAllowed, validateGrant } from "../GrantModal";
import type { CatalogueItem, Delegation, Overview } from "../types";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  usePathname: () => "/settings/partner-access",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));
const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock("react-hot-toast", () => ({ __esModule: true, default: { success: (...a: unknown[]) => mockToast.success(...a), error: (...a: unknown[]) => mockToast.error(...a) } }));

const mockOverview = jest.fn();
const mockGrant = jest.fn();
const mockRevoke = jest.fn();
const mockActivity = jest.fn();
jest.mock("../api", () => ({
  partnerAccessApi: {
    overview: (...a: unknown[]) => mockOverview(...a),
    grant: (...a: unknown[]) => mockGrant(...a),
    revoke: (...a: unknown[]) => mockRevoke(...a),
    activity: (...a: unknown[]) => mockActivity(...a),
  },
}));

function me(permissions: Partial<Record<PermissionCode, Scope[]>>): Me {
  return {
    user: { id: 1, email: "admin@acme.io", full_name: "Acme Admin", mfa_enabled: false, permission_version: 1, last_login_at: null },
    company: { id: 1, name: "Acme", slug: "acme", timezone: "UTC", currency: "INR", subscription: { status: "active", plan: "pro", trial_ends_at: null, active: true } },
    employee: null,
    roles: [],
    permissions,
    is_company_admin: true,
    registry_version: "test",
  } as Me;
}

const signIn = (user: Me) => act(() => useSession.setState({ me: user, status: "authenticated" }));
const ADMIN = me({ [P.SETTINGS_PARTNER_ACCESS_MANAGE]: ["COMPANY"] });

const item = (code: string, label: string, module: string, narrowable_by: CatalogueItem["narrowable_by"] = [], sensitivity: CatalogueItem["sensitivity"] = "standard"): CatalogueItem => ({
  code, label, module, description: `${label} description`, sensitivity, narrowable_by,
});
const CATALOGUE = [
  item("employee:read", "View employees", "People", ["LEGAL_ENTITY"]),
  item("holiday:read", "View holidays", "Time"),
  item("payroll:run:read", "View payroll runs", "Payroll", ["LEGAL_ENTITY", "PAY_GROUP"], "restricted"),
];

function delegation(overrides: Partial<Delegation> = {}): Delegation {
  return {
    id: 5, partner_id: 1, partner_name: "Northwind Partners", status: "ACTIVE", permission_codes: ["employee:read"],
    permissions: [{ code: "employee:read", label: "View employees" }], legal_entities: [], pay_groups: [], narrowed: false,
    read_only: true, starts_at: "2026-10-24T08:00:00Z", expires_at: "2026-10-31T08:00:00Z", reason: "Month-end bureau review",
    granted_by: { id: 1, name: "Acme Admin" }, granted_at: "2026-10-24T08:00:00Z", revoked_at: null, revoked_by: null, revoke_reason: null,
    ...overrides,
  };
}

function overview(overrides: Partial<Overview> = {}): Overview {
  return {
    partner: { id: 1, name: "Northwind Partners", status: "active" }, max_days: 30, reason_min: 10, catalogue: CATALOGUE,
    targets: { legal_entities: [{ id: 1, code: "LE01", name: "Acme India" }, { id: 2, code: "AE01", name: "Acme Gulf" }], pay_groups: [{ id: 9, code: "PG-IN", name: "India monthly", legal_entity_id: 1 }] },
    items: [], ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  signIn(ADMIN);
});

describe("Partner access page", () => {
  it("is denied without settings:partner_access:manage", () => {
    signIn(me({ [P.SETTINGS_MANAGE]: ["COMPANY"] }));
    render(<PartnerAccessRoute />);
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
    expect(mockOverview).not.toHaveBeenCalled();
  });

  it("explains an empty state and offers to grant access", async () => {
    mockOverview.mockResolvedValue(overview());
    render(<PartnerAccessRoute />);
    expect(await screen.findByText("No partner access granted")).toBeInTheDocument();
    expect(screen.getByText(/cannot see any of your data right now/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Grant access/ })[0]).toBeEnabled();
  });

  it("cannot grant without a partner, and says so", async () => {
    mockOverview.mockResolvedValue(overview({ partner: null }));
    render(<PartnerAccessRoute />);
    expect(await screen.findByText("This workspace has no partner")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Grant access/ })).toBeDisabled();
  });

  it("shows an inactive partner as a reason that new access cannot be granted", async () => {
    mockOverview.mockResolvedValue(overview({ partner: { id: 1, name: "Northwind Partners", status: "suspended" } }));
    render(<PartnerAccessRoute />);
    expect(await screen.findByText("Northwind Partners is not active")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Grant access/ })).toBeDisabled();
  });

  it("lists delegations with status, permissions and limits; only open ones can be ended", async () => {
    mockOverview.mockResolvedValue(overview({
      items: [
        delegation({ id: 5, narrowed: true, legal_entities: [{ id: 1, name: "Acme India" }] }),
        delegation({ id: 4, status: "REVOKED", revoked_at: "2026-10-25T08:00:00Z", revoked_by: { id: 1, name: "Acme Admin" }, revoke_reason: "Work finished" }),
        delegation({ id: 3, status: "EXPIRED" }),
      ],
    }));
    render(<PartnerAccessRoute />);
    const list = await screen.findByRole("list", { name: "Delegations" });
    expect(within(list).getAllByText("Northwind Partners")).toHaveLength(3);
    expect(within(list).getByText("Active")).toBeInTheDocument();
    expect(within(list).getByText("Revoked")).toBeInTheDocument();
    expect(within(list).getByText("Expired")).toBeInTheDocument();
    expect(within(list).getAllByText("Read only")).toHaveLength(3);
    expect(within(list).getByText(/Limited to Acme India/)).toBeInTheDocument();
    expect(within(list).getByText(/Ended by Acme Admin .*: Work finished/)).toBeInTheDocument();
    expect(within(list).getByRole("button", { name: "End access 5" })).toBeInTheDocument();
    expect(within(list).queryByRole("button", { name: "End access 4" })).not.toBeInTheDocument();
    expect(within(list).queryByRole("button", { name: "End access 3" })).not.toBeInTheDocument();
  });

  it("grants read-only access: validates first, then sends codes, days and reason", async () => {
    mockOverview.mockResolvedValue(overview());
    mockGrant.mockResolvedValue(delegation());
    render(<PartnerAccessRoute />);
    fireEvent.click((await screen.findAllByRole("button", { name: /Grant access/ }))[0]);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Grant access" }));
    expect(await within(dialog).findAllByText("Choose at least one permission to share.")).not.toHaveLength(0); // inline and in the summary
    expect(mockGrant).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByLabelText(/View employees/));
    fireEvent.change(within(dialog).getByLabelText(/For how long/), { target: { value: "14" } });
    fireEvent.change(within(dialog).getByLabelText(/Why are you sharing this/), { target: { value: "short" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Grant access" }));
    expect(await within(dialog).findAllByText(/at least 10 characters/)).not.toHaveLength(0);
    expect(mockGrant).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/Why are you sharing this/), { target: { value: "Month-end bureau review" } });
    const before = Date.now();
    fireEvent.click(within(dialog).getByRole("button", { name: "Grant access" }));
    await waitFor(() => expect(mockGrant).toHaveBeenCalledTimes(1));
    const sent = mockGrant.mock.calls[0][0];
    expect(sent).toMatchObject({ permission_codes: ["employee:read"], legal_entity_ids: [], pay_group_ids: [], reason: "Month-end bureau review" });
    const lifetime = new Date(sent.expires_at).getTime() - before;
    expect(lifetime).toBeGreaterThan(13.9 * 86_400_000);
    expect(lifetime).toBeLessThan(14 * 86_400_000); // never a hair over what was chosen
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Access granted"));
    expect(mockOverview).toHaveBeenCalledTimes(2); // reloaded
  });

  it("limits to legal entities: permissions that cannot be limited switch off and drop out", async () => {
    mockOverview.mockResolvedValue(overview());
    mockGrant.mockResolvedValue(delegation());
    render(<PartnerAccessRoute />);
    fireEvent.click((await screen.findAllByRole("button", { name: /Grant access/ }))[0]);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByLabelText(/View holidays/));
    fireEvent.click(within(dialog).getByLabelText(/View employees/));
    fireEvent.click(within(dialog).getByLabelText("Only selected legal entities or pay groups"));
    // Nothing chosen yet: refused with a plain message.
    fireEvent.change(within(dialog).getByLabelText(/Why are you sharing this/), { target: { value: "Gulf entity review only" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Grant access" }));
    expect(await within(dialog).findAllByText(/Choose at least one legal entity or pay group/)).not.toHaveLength(0);
    fireEvent.click(within(dialog).getByLabelText(/Acme Gulf/));
    expect(within(dialog).getByLabelText(/View holidays/)).toBeDisabled();
    expect(within(dialog).getByLabelText(/View holidays/)).not.toBeChecked();
    expect(within(dialog).getByLabelText(/View employees/)).toBeChecked();
    // Pay groups alone cannot carry employee:read.
    fireEvent.click(within(dialog).getByLabelText(/Acme Gulf/));
    fireEvent.click(within(dialog).getByLabelText(/India monthly/));
    expect(within(dialog).getByLabelText(/View employees/)).toBeDisabled();
    expect(within(dialog).getByLabelText(/View employees/)).not.toBeChecked();
    fireEvent.click(within(dialog).getByLabelText(/View payroll runs/));
    fireEvent.click(within(dialog).getByRole("button", { name: "Grant access" }));
    await waitFor(() => expect(mockGrant).toHaveBeenCalledTimes(1));
    expect(mockGrant.mock.calls[0][0]).toMatchObject({ permission_codes: ["payroll:run:read"], legal_entity_ids: [], pay_group_ids: [9] });
  });

  it("shows the server's refusal inside the dialog and keeps it open", async () => {
    mockOverview.mockResolvedValue(overview());
    mockGrant.mockRejectedValue(Object.assign(new (jest.requireActual("@/lib/api").ApiError)(403, "You can only delegate permissions you hold company-wide yourself: payroll:run:read", "DELEGATION_EXCEEDS_GRANTOR")));
    render(<PartnerAccessRoute />);
    fireEvent.click((await screen.findAllByRole("button", { name: /Grant access/ }))[0]);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByLabelText(/View payroll runs/));
    fireEvent.change(within(dialog).getByLabelText(/Why are you sharing this/), { target: { value: "Quarterly payroll review" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Grant access" }));
    expect(await within(dialog).findByText(/hold company-wide yourself/)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it("ends access with a reason and reloads", async () => {
    mockOverview.mockResolvedValue(overview({ items: [delegation()] }));
    mockRevoke.mockResolvedValue(delegation({ status: "REVOKED" }));
    render(<PartnerAccessRoute />);
    fireEvent.click(await screen.findByRole("button", { name: "End access 5" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/loses access on its very next request/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "End access now" }));
    expect(await within(dialog).findByText(/Give a reason/)).toBeInTheDocument();
    expect(mockRevoke).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/Why are you ending it/), { target: { value: "Contract ended today" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "End access now" }));
    await waitFor(() => expect(mockRevoke).toHaveBeenCalledWith(5, "Contract ended today"));
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Access ended"));
    expect(mockOverview).toHaveBeenCalledTimes(2);
  });

  it("shows what the partner did under one access", async () => {
    mockOverview.mockResolvedValue(overview({ items: [delegation()] }));
    mockActivity.mockResolvedValue([
      { id: 3, at: "2026-10-24T09:00:00Z", action: "DELEGATED_REQUEST", description: "", operator_email: "ops@northwind.example", method: "GET", path: "/api/v1/employees" },
      { id: 2, at: "2026-10-24T08:59:00Z", action: "DELEGATED_REQUEST_DENIED", description: "", operator_email: "ops@northwind.example", method: "POST", path: "/api/v1/employees" },
      { id: 1, at: "2026-10-24T08:58:00Z", action: "DELEGATION_TOKEN_ISSUED", description: "ops opened Acme", operator_email: "ops@northwind.example", method: null, path: null },
    ]);
    render(<PartnerAccessRoute />);
    fireEvent.click(await screen.findByRole("button", { name: "Activity of access 5" }));
    const log = await screen.findByRole("list", { name: "Partner activity" });
    expect(mockActivity).toHaveBeenCalledWith(5);
    expect(within(log).getByText("GET /api/v1/employees")).toBeInTheDocument();
    expect(within(log).getByText("Read")).toBeInTheDocument();
    expect(within(log).getByText("Refused")).toBeInTheDocument();
    expect(within(log).getByText("Opened workspace")).toBeInTheDocument();
  });

  it("shows a load failure with a retry", async () => {
    mockOverview.mockRejectedValueOnce(new (jest.requireActual("@/lib/api").ApiError)(500, "Server error")).mockResolvedValue(overview());
    render(<PartnerAccessRoute />);
    expect(await screen.findByText("Server error")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No partner access granted")).toBeInTheDocument();
  });
});

describe("grant form rules", () => {
  it("allows a permission only when it survives the chosen narrowing", () => {
    const [employees, holidays, runs] = CATALOGUE;
    expect(stillAllowed(holidays, [], [])).toBe(true);
    expect(stillAllowed(holidays, [1], [])).toBe(false);
    expect(stillAllowed(employees, [1], [])).toBe(true);
    expect(stillAllowed(employees, [], [9])).toBe(false);
    expect(stillAllowed(employees, [1], [9])).toBe(true); // the legal entity carries it
    expect(stillAllowed(runs, [], [9])).toBe(true);
  });

  it("needs a permission and a reason of the server's minimum length", () => {
    expect(validateGrant({ codes: [], reason: "" }, 10)).toEqual({ codes: expect.any(String), reason: expect.any(String) });
    expect(validateGrant({ codes: ["employee:read"], reason: "  too short " }, 10).reason).toBeDefined();
    expect(validateGrant({ codes: ["employee:read"], reason: "Month-end review" }, 10)).toEqual({});
  });
});

describe("settings rail entry", () => {
  it("shows Partner access only to holders of the permission", () => {
    const labels = (user: Me) => settingsNavFor(user).flatMap((g) => g.items.map((i) => i.label));
    expect(labels(ADMIN)).toContain("Partner access");
    expect(labels(me({ [P.SETTINGS_MANAGE]: ["COMPANY"], [P.ROLE_READ]: ["COMPANY"] }))).not.toContain("Partner access");
    const entry = settingsNavFor(ADMIN).flatMap((g) => g.items).find((i) => i.label === "Partner access");
    expect(entry).toMatchObject({ href: "/settings/partner-access" });
    expect(entry?.external).toBeUndefined(); // it renders inside the settings shell
  });
});
