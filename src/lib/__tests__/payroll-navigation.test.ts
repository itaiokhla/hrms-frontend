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
    expect(childHrefs(payrollGroup(finance))).toEqual(["/payroll", "/payroll/runs", "/payroll/payments", "/payroll/invoices", "/payroll/bank-details"]);
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
    // The default self-service role sees every self-service pay page, in this order.
    const entry = navFor(employee).flatMap((g) => g.items).find((i) => i.label === "Payslips");
    expect((entry?.children ?? []).map((c) => [c.label, c.href])).toEqual([
      ["My Salary", "/me/salary"],
      ["My Payslips", "/me/payslips"],
      ["My Payments", "/me/payments"],
      ["My Tax", "/me/tax"],
      ["My Bank Accounts", "/me/bank-accounts"],
      ["My Loans", "/me/loans"],
      ["My Claims", "/me/claims"],
    ]);
    // Self payslip access never opens the download center: exports are staff-only on the server.
    expect(hrefs).not.toContain("/downloads");
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
      "/payroll", "/payroll/runs", "/payroll/inputs", "/payroll/approvals", "/payroll/team-inputs", "/payroll/compensation", "/payroll/revisions",
      "/payroll/structures", "/payroll/components", "/payroll/payments", "/payroll/invoices", "/payroll/bank-details", "/payroll/loans",
      "/payroll/reimbursements", "/payroll/payslips", "/payroll/compliance", "/payroll/reports", "/downloads",
      "/settings/payroll/general", "/payroll/legacy",
    ]);
  });
});

describe("self-service claims and tax entries", () => {
  const payslipsEntry = (user: Me) => navFor(user).flatMap((g) => g.items).find((i) => i.label === "Payslips");
  const selfLabels = (user: Me) => (payslipsEntry(user)?.children ?? []).map((c) => c.label);

  it("a claims-only grant shows My Claims and not the loans page it cannot open", () => {
    const claimsOnly = me({ [P.PAYROLL_READ]: ["SELF"], [P.PAYROLL_REIMBURSEMENTS_READ]: ["SELF"] });
    expect(selfLabels(claimsOnly)).toEqual(["My Claims"]);
    expect(navHrefs(navFor(claimsOnly))).not.toContain("/me/loans");
  });

  it("a loans-only grant shows My Loans and not My Claims", () => {
    const loansOnly = me({ [P.PAYROLL_READ]: ["SELF"], [P.PAYROLL_LOANS_READ]: ["SELF"] });
    expect(selfLabels(loansOnly)).toEqual(["My Loans"]);
  });

  it("My Tax needs a linked employee, self payslip access and the self tax profile grant", () => {
    const both = { [P.PAYROLL_READ]: ["SELF"], [P.PAYROLL_PAYSLIP_READ]: ["SELF"], [P.PAYROLL_TAX_PROFILE_READ]: ["SELF"] } as Partial<Record<PermissionCode, Scope[]>>;
    expect(selfLabels(me(both))).toEqual(["My Payslips", "My Payments", "My Tax"]);
    // Without the tax profile grant the page would deny access, so there is no entry.
    expect(selfLabels(me({ [P.PAYROLL_READ]: ["SELF"], [P.PAYROLL_PAYSLIP_READ]: ["SELF"] }))).toEqual(["My Payslips", "My Payments"]);
    expect(selfLabels(me({ [P.PAYROLL_READ]: ["SELF"], [P.PAYROLL_TAX_PROFILE_READ]: ["SELF"] }))).toEqual([]);
    expect(navHrefs(navFor(me(both, { employee: false })))).not.toContain("/me/tax");
  });

  it("no linked employee profile: no My Claims", () => {
    const user = me({ [P.PAYROLL_REIMBURSEMENTS_READ]: ["SELF"] }, { employee: false });
    expect(navHrefs(navFor(user))).not.toContain("/me/claims");
  });

  it("menus never depend on role names", () => {
    const user = me({ [P.PAYROLL_READ]: ["SELF"], [P.PAYROLL_REIMBURSEMENTS_READ]: ["SELF"] });
    const named: Me = { ...user, roles: [{ id: 1, name: "Payroll Manager", system_key: "payroll_manager" }] };
    expect(navHrefs(navFor(named))).toEqual(navHrefs(navFor(user)));
  });
});

describe("download center entry", () => {
  const downloads = (user: Me) => childHrefs(payrollGroup(user)).includes("/downloads");

  it("shows for report exporters scoped to a legal entity", () => {
    expect(downloads(me({ [P.PAYROLL_REPORTS_EXPORT]: ["LEGAL_ENTITY"] }, { employee: false }))).toBe(true);
  });

  it("shows for payslip readers and publishers beyond SELF", () => {
    expect(downloads(me({ [P.PAYROLL_PAYSLIP_READ]: ["PAY_GROUP"] }, { employee: false }))).toBe(true);
    expect(downloads(me({ [P.PAYROLL_PAYSLIP_PUBLISH]: ["COMPANY"] }, { employee: false }))).toBe(true);
    const publisher = me({ [P.PAYROLL_PAYSLIP_PUBLISH]: ["COMPANY"] }, { employee: false });
    expect(childHrefs(payrollGroup(publisher))).toEqual(["/payroll/payslips", "/downloads"]);
  });

  it("is hidden for SELF-only payslip or report grants and for report readers without export", () => {
    expect(navHrefs(navFor(me({ [P.PAYROLL_PAYSLIP_READ]: ["SELF"], [P.PAYROLL_REPORTS_EXPORT]: ["SELF"] })))).not.toContain("/downloads");
    expect(downloads(me({ [P.PAYROLL_REPORTS_READ]: ["COMPANY"] }, { employee: false }))).toBe(false);
  });
});
