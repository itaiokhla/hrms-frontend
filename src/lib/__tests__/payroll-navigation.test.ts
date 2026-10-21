import { canSeeLegacyPayroll, navFor, navHrefs, type NavItem } from "@/lib/navigation";
import { P, type PermissionCode, type Scope } from "@/lib/permissions.generated";
import type { Me } from "@/lib/types";

function me(permissions: Partial<Record<PermissionCode, Scope[]>>, { employee = true, admin = false } = {}): Me {
  return {
    user: { id: 1, email: "a@b.io", full_name: "Test User", mfa_enabled: false, permission_version: 1, last_login_at: null },
    company: {
      id: 1, name: "Acme", slug: "acme", timezone: "Asia/Kolkata", currency: "INR",
      subscription: { status: "active", plan: "pro", trial_ends_at: null, active: true },
    },
    employee: employee
      ? { id: 10, employee_code: "E1", first_name: "Test", last_name: "User", position: null, department: null, has_photo: false }
      : null,
    roles: [],
    permissions,
    is_company_admin: admin,
    registry_version: "test",
  };
}

const SELF_SERVICE: Partial<Record<PermissionCode, Scope[]>> = {
  [P.EMPLOYEE_READ]: ["SELF"], [P.ATTENDANCE_MARK]: ["SELF"], [P.LEAVE_APPLY]: ["SELF"], [P.HOLIDAY_READ]: ["COMPANY"],
  [P.PAYROLL_READ]: ["SELF"], [P.COMPENSATION_READ]: ["SELF"], [P.ASSET_READ]: ["SELF"],
  [P.PAYROLL_PAYSLIP_READ]: ["SELF"], [P.PAYROLL_COMPENSATION_READ]: ["SELF"], [P.PAYROLL_BANK_DETAILS_READ_MASKED]: ["SELF"],
  [P.PAYROLL_BANK_DETAILS_EDIT]: ["SELF"], [P.PAYROLL_TAX_PROFILE_READ]: ["SELF"], [P.PAYROLL_LOANS_READ]: ["SELF"],
  [P.PAYROLL_REIMBURSEMENTS_READ]: ["SELF"],
};

const payrollGroup = (user: Me): NavItem | undefined =>
  navFor(user).flatMap((g) => g.items).find((i) => i.label === "Payroll");
const childHrefs = (item: NavItem | undefined) => (item?.children ?? []).map((c) => c.href);
const WORKSPACE_PREFIX = /^\/payroll(\/|$)/;

describe("payroll workspace menu (3.8 §3.2)", () => {
  it("an entity-scoped payroll user sees the payroll menus their grants cover", () => {
    const scoped = me(
      {
        ...SELF_SERVICE,
        [P.PAYROLL_RUN_READ]: ["LEGAL_ENTITY"],
        [P.PAYROLL_INPUTS_READ]: ["LEGAL_ENTITY"],
        [P.PAYROLL_COMPENSATION_READ]: ["SELF", "LEGAL_ENTITY"],
        [P.PAYROLL_CONFIGURATION_READ]: ["LEGAL_ENTITY"],
        [P.PAYROLL_RUN_APPROVE]: ["LEGAL_ENTITY"],
      },
      { employee: true },
    );
    const group = payrollGroup(scoped);
    expect(group?.href).toBe("/payroll");
    expect(childHrefs(group)).toEqual([
      "/payroll", "/payroll/runs", "/payroll/inputs", "/payroll/approvals", "/payroll/compensation", "/settings/payroll/general",
    ]);
    // Not companyWide, and no legacy codes: no legacy page.
    expect(childHrefs(group)).not.toContain("/payroll/legacy");
    expect(childHrefs(group)).not.toContain("/payroll/payments");
  });

  it("a pay-group-scoped finance user sees payout files and bank details", () => {
    const finance = me(
      { [P.PAYROLL_PAYMENT_PREPARE]: ["PAY_GROUP"], [P.PAYROLL_BANK_DETAILS_READ_MASKED]: ["PAY_GROUP"], [P.PAYROLL_RUN_READ]: ["PAY_GROUP"] },
      { employee: false },
    );
    expect(childHrefs(payrollGroup(finance))).toEqual(["/payroll", "/payroll/runs", "/payroll/payments", "/payroll/bank-details"]);
  });

  it("a manager without payroll codes sees no payroll menu at all", () => {
    const manager = me({
      ...SELF_SERVICE,
      [P.EMPLOYEE_READ]: ["SELF", "REPORTING_TREE"],
      [P.REPORT_READ]: ["REPORTING_TREE"],
      [P.LEAVE_APPROVE]: ["REPORTING_TREE"],
      [P.OVERTIME_APPROVE]: ["REPORTING_TREE"],
    });
    expect(payrollGroup(manager)).toBeUndefined();
    expect(navHrefs(navFor(manager)).filter((h) => WORKSPACE_PREFIX.test(h) || h.startsWith("/settings/payroll"))).toEqual([]);
  });

  it("an employee sees self-service pay pages only, never the workspace", () => {
    const employee = me(SELF_SERVICE);
    const hrefs = navHrefs(navFor(employee));
    expect(hrefs.filter((h) => WORKSPACE_PREFIX.test(h))).toEqual([]);
    expect(hrefs).toEqual(
      expect.arrayContaining(["/payslips", "/me/salary", "/me/payslips", "/me/payments", "/me/bank-accounts", "/me/loans"]),
    );
    // Today's Payslips entry stays the parent link, so the top-level menu is unchanged.
    const top = navFor(employee).flatMap((g) => g.items.map((i) => i.label));
    expect(top).toEqual(["Dashboard", "Attendance", "Leave", "Holidays", "Payslips", "Assets"]);
  });

  it("self-service needs a linked employee profile", () => {
    const noProfile = me(SELF_SERVICE, { employee: false });
    expect(navHrefs(navFor(noProfile)).filter((h) => h.startsWith("/me/") || h === "/payslips")).toEqual([]);
  });

  it("without the legacy payslip grant the Payslips entry opens the first self-service page", () => {
    const v2Only = me({ [P.PAYROLL_PAYSLIP_READ]: ["SELF"], [P.PAYROLL_COMPENSATION_READ]: ["SELF"] });
    const entry = navFor(v2Only).flatMap((g) => g.items).find((i) => i.label === "Payslips");
    expect(entry?.href).toBe("/me/salary");
    expect(childHrefs(entry)).toEqual(["/me/salary", "/me/payslips", "/me/payments"]);
  });

  it("holders of the legacy codes keep the legacy page, reachable from the Payroll entry", () => {
    const legacy = me({ [P.PAYROLL_READ]: ["COMPANY"], [P.PAYROLL_PREPARE]: ["COMPANY"] }, { employee: false });
    expect(canSeeLegacyPayroll(legacy)).toBe(true);
    const group = payrollGroup(legacy);
    expect(group?.href).toBe("/payroll");
    expect(childHrefs(group)).toEqual(["/payroll", "/payroll/legacy"]);
  });

  it("legacy payroll:read at SELF scope is not legacy payroll access", () => {
    expect(canSeeLegacyPayroll(me({ [P.PAYROLL_READ]: ["SELF"] }))).toBe(false);
  });

  it("a company administrator without payroll-confidential codes gets no payroll menu (I-08)", () => {
    const admin = me({ [P.SETTINGS_MANAGE]: ["COMPANY"], [P.USER_READ]: ["COMPANY"], [P.EMPLOYEE_READ]: ["COMPANY"] }, { admin: true });
    expect(payrollGroup(admin)).toBeUndefined();
  });

  it("a full payroll manager sees every workspace page in the documented order", () => {
    const all = Object.fromEntries(
      Object.values(P).filter((code) => code.startsWith("payroll:")).map((code) => [code, ["COMPANY"] as Scope[]]),
    ) as Partial<Record<PermissionCode, Scope[]>>;
    expect(childHrefs(payrollGroup(me(all)))).toEqual([
      "/payroll", "/payroll/runs", "/payroll/inputs", "/payroll/approvals", "/payroll/compensation", "/payroll/revisions",
      "/payroll/structures", "/payroll/components", "/payroll/payments", "/payroll/bank-details", "/payroll/loans",
      "/payroll/reimbursements", "/payroll/payslips", "/payroll/compliance", "/payroll/reports", "/settings/payroll/general",
      "/payroll/legacy",
    ]);
  });
});
