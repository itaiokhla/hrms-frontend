import "@testing-library/jest-dom";
import { act, render, screen } from "@testing-library/react";

import PayrollOverviewPage from "@/app/(app)/payroll/page";
import { ApiError } from "@/lib/api";
import { P, type PermissionCode, type Scope } from "@/lib/permissions.generated";
import type { Me } from "@/lib/types";
import { useSession } from "@/store/session";

import { SetupChecklist } from "../SetupChecklist";
import type { SettingValueItem, ValuesResponse } from "../types";

// The overview page opens its "new run" sheet through useModalRoute (Next's app router hooks).
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  usePathname: () => "/payroll",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

const values = jest.fn();
jest.mock("../settingsApi", () => {
  const actual = jest.requireActual("../settingsApi");
  return { ...actual, settingsApi: { ...actual.settingsApi, values: (...a: unknown[]) => values(...a) } };
});

function item(key: string, value: unknown, source: string | null): SettingValueItem {
  return {
    key, value, level: "TENANT", badge: { code: "SET_HERE", label: "Set here" }, locked_by: null, legal_limit: [], effective_from: null,
    effective_to: null, editable: true, row_version: 1, shadowed: [], valid: true, issues: [], pending: null,
    here: source ? { row_id: 1, value, locked: false, effective_from: "2026-10-01", effective_to: null, source, profile_version: "STARTER_V1", reason: null } : null,
  };
}

const RESPONSE: ValuesResponse = {
  scope: { scope_type: "TENANT", scope_id: null, name: "Company" }, as_of: "2026-10-21", registry_version: "x", profile_version: "STARTER_V1",
  items: [item("payroll.overtime.enabled", false, "STARTER_PROFILE"), item("payroll.attendance.enabled", true, "ADMIN")],
  issues: [],
};

function me(permissions: Partial<Record<PermissionCode, Scope[]>>): Me {
  return {
    user: { id: 1, email: "a@b.io", full_name: "A", mfa_enabled: false, permission_version: 1, last_login_at: null },
    company: { id: 1, name: "Acme", slug: "acme", timezone: "UTC", currency: "INR", subscription: { status: "active", plan: "pro", trial_ends_at: null, active: true } },
    employee: null,
    roles: [],
    permissions,
    is_company_admin: false,
    registry_version: "test",
  };
}

beforeEach(() => {
  values.mockReset();
  values.mockResolvedValue(RESPONSE);
});

describe("SetupChecklist", () => {
  it("lists the starter decisions, marking only administrator decisions as done", async () => {
    render(<SetupChecklist />);
    expect(await screen.findByText("Decisions for your payroll setup")).toBeInTheDocument();
    expect(values).toHaveBeenCalledWith({ scope_type: "TENANT", scope_id: null });
    expect(screen.getByText("Use attendance for payroll: On", { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/1 of \d+ done/)).toBeInTheDocument();
    const overtime = screen.getByRole("link", { name: /Overtime pay/ });
    expect(overtime).toHaveAttribute("href", "/settings/payroll/overtime#setting-payroll-overtime-enabled");
  });

  it("offers a retry when the values can't be loaded", async () => {
    values.mockRejectedValue(new ApiError(503, "Server unavailable"));
    render(<SetupChecklist />);
    expect(await screen.findByText("Server unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("Payroll overview shell", () => {
  // The Payroll page is now the KPI overview for anyone who reads pay runs (payroll:read or payroll.run.read;
  // covered in runs/__tests__/overview.test.tsx, including a legacy payroll manager's header links). A legacy
  // payroll preparer with configuration access but no pay-run read keeps this shell: the real setup checklist,
  // the pages of the role, and the Payroll settings and Legacy payroll links in the header.
  it("shows the checklist and the legacy link to a legacy payroll preparer with configuration access", async () => {
    act(() =>
      useSession.setState({
        me: me({ [P.PAYROLL_PREPARE]: ["COMPANY"], [P.PAYROLL_CONFIGURATION_READ]: ["COMPANY"] }),
        status: "authenticated",
      }),
    );
    render(<PayrollOverviewPage />);
    expect(screen.getByRole("heading", { name: "Payroll", level: 1 })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Legacy payroll|Open legacy payroll/ })[0]).toHaveAttribute("href", "/payroll/legacy");
    const settingsLinks = screen.getAllByRole("link", { name: /Payroll settings/ });
    expect(settingsLinks.length).toBeGreaterThan(0);
    for (const link of settingsLinks) expect(link).toHaveAttribute("href", "/settings/payroll/general");
    expect(await screen.findByText("Decisions for your payroll setup")).toBeInTheDocument();
    expect(values).toHaveBeenCalledWith({ scope_type: "TENANT", scope_id: null });
    expect(screen.getByText("Your payroll pages")).toBeInTheDocument();
    // No KPI figures without pay-run access.
    expect(screen.queryByText("Total employees")).not.toBeInTheDocument();
    expect(screen.queryByText(/₹|INR \d/)).not.toBeInTheDocument();
  });

  it("denies a manager without payroll codes", () => {
    act(() => useSession.setState({ me: me({ [P.EMPLOYEE_READ]: ["REPORTING_TREE"] }), status: "authenticated" }));
    render(<PayrollOverviewPage />);
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
    expect(values).not.toHaveBeenCalled();
  });
});
