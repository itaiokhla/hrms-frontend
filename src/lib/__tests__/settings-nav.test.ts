import { P, type PermissionCode, type Scope } from "@/lib/permissions.generated";
import { SETTING_SECTIONS } from "@/lib/settings.generated";
import { activeSettingsHref, isPayrollSettingsSlug, settingsNavFor } from "@/lib/settings-nav";
import type { Me } from "@/lib/types";

function me(permissions: Partial<Record<PermissionCode, Scope[]>>): Me {
  return {
    user: { id: 1, email: "a@b.io", full_name: "Test User", mfa_enabled: false, permission_version: 1, last_login_at: null },
    company: {
      id: 1, name: "Acme", slug: "acme", timezone: "UTC", currency: "INR",
      subscription: { status: "active", plan: "pro", trial_ends_at: null, active: true },
    },
    employee: null,
    roles: [],
    permissions,
    is_company_admin: false,
    registry_version: "test",
  };
}

const labels = (user: Me) => settingsNavFor(user).map((g) => g.label);

describe("settings rail (3.8 §3.1)", () => {
  it("shows only permitted groups; empty groups disappear", () => {
    expect(labels(me({}))).toEqual([]);
    expect(labels(me({ [P.SETTINGS_MANAGE]: ["COMPANY"] }))).toEqual(["Company"]);
    expect(labels(me({ [P.ORG_READ]: ["COMPANY"], [P.ROLE_READ]: ["COMPANY"] }))).toEqual(["Organization", "Security"]);
  });

  it("lists every generated payroll section for configuration readers, at any scope", () => {
    const groups = settingsNavFor(me({ [P.PAYROLL_CONFIGURATION_READ]: ["LEGAL_ENTITY"] }));
    const payroll = groups.find((g) => g.label === "Payroll");
    expect(payroll?.items.map((i) => i.href)).toEqual(SETTING_SECTIONS.map((s) => `/settings/payroll/${s.slug}`));
    expect(payroll?.items[0].label).toBe("General & calendars");
    // Change requests sit under Security for configuration readers and approvers.
    expect(groups.find((g) => g.label === "Security")?.items.map((i) => i.label)).toEqual(["Settings change requests"]);
  });

  it("keeps today's settings pages reachable", () => {
    const admin = me({
      [P.SETTINGS_MANAGE]: ["COMPANY"], [P.BRANDING_MANAGE]: ["COMPANY"], [P.ORG_READ]: ["COMPANY"],
      [P.LEAVE_MANAGE_POLICY]: ["COMPANY"], [P.HOLIDAY_MANAGE]: ["COMPANY"], [P.ROLE_READ]: ["COMPANY"],
    });
    const hrefs = settingsNavFor(admin).flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toEqual(
      expect.arrayContaining(["/settings", "/settings/branding", "/settings/organization", "/leaves?tab=policy", "/holidays", "/roles"]),
    );
  });

  it("marks the most specific in-shell entry active", () => {
    const groups = settingsNavFor(me({ [P.SETTINGS_MANAGE]: ["COMPANY"], [P.BRANDING_MANAGE]: ["COMPANY"], [P.PAYROLL_CONFIGURATION_READ]: ["COMPANY"] }));
    expect(activeSettingsHref(groups, "/settings")).toBe("/settings");
    expect(activeSettingsHref(groups, "/settings/branding")).toBe("/settings/branding");
    expect(activeSettingsHref(groups, "/settings/payroll/overtime")).toBe("/settings/payroll/overtime");
    expect(activeSettingsHref(groups, "/payroll")).toBeUndefined();
  });

  it("validates payroll section slugs", () => {
    expect(isPayrollSettingsSlug("overtime")).toBe(true);
    expect(isPayrollSettingsSlug("change-requests")).toBe(true);
    expect(isPayrollSettingsSlug("not-a-section")).toBe(false);
  });
});
