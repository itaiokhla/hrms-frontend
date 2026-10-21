import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { P, type PermissionCode, type Scope } from "@/lib/permissions.generated";
import type { Me } from "@/lib/types";

import { SettingsShell } from "../SettingsRail";

const push = jest.fn();
let pathname = "/settings/payroll/overtime";
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: jest.fn(), back: jest.fn() }),
  usePathname: () => pathname,
}));

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
  push.mockClear();
  pathname = "/settings/payroll/overtime";
});

describe("SettingsShell", () => {
  it("renders the permitted sections with the current one marked, plus a mobile picker", () => {
    render(
      <SettingsShell me={me({ [P.SETTINGS_MANAGE]: ["COMPANY"], [P.PAYROLL_CONFIGURATION_READ]: ["LEGAL_ENTITY"], [P.ROLE_READ]: ["COMPANY"] })}>
        <p>page body</p>
      </SettingsShell>,
    );
    const rail = screen.getByRole("navigation", { name: "Settings" });
    expect(within(rail).getByRole("link", { name: "Overtime" })).toHaveAttribute("aria-current", "page");
    expect(within(rail).getByRole("link", { name: "Profile & policies" })).toHaveAttribute("href", "/settings");
    expect(within(rail).getByRole("link", { name: /Roles & access/ })).toHaveAttribute("href", "/roles");
    expect(within(rail).queryByRole("link", { name: "Branding & domains" })).not.toBeInTheDocument();
    expect(screen.getByText("page body")).toBeInTheDocument();

    const picker = screen.getByLabelText("Settings section") as HTMLSelectElement;
    expect(picker.value).toBe("/settings/payroll/overtime");
    fireEvent.change(picker, { target: { value: "/settings/payroll/leave" } });
    expect(push).toHaveBeenCalledWith("/settings/payroll/leave");
  });

  it("stays out of the way when there is nothing to choose between", () => {
    pathname = "/settings";
    render(
      <SettingsShell me={me({ [P.SETTINGS_MANAGE]: ["COMPANY"] })}>
        <p>only page</p>
      </SettingsShell>,
    );
    expect(screen.queryByRole("navigation", { name: "Settings" })).not.toBeInTheDocument();
    expect(screen.getByText("only page")).toBeInTheDocument();
  });
});
