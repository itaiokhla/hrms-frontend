import { can, canBeyondSelf, companyWide } from "@/lib/access";
import { navFor } from "@/lib/navigation";
import { P, PERMISSION_META, type PermissionCode, type Scope } from "@/lib/permissions.generated";
import type { Me } from "@/lib/types";

function me(permissions: Partial<Record<PermissionCode, Scope[]>>, employee = true): Me {
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
    is_company_admin: false,
    registry_version: "test",
  };
}

const hrefs = (user: Me) => navFor(user).flatMap((g) => g.items.map((i) => i.href));

describe("scope semantics mirror the backend", () => {
  it("COMPANY covers every scope and REPORTING_TREE covers DIRECT_REPORTS", () => {
    const company = me({ [P.EMPLOYEE_READ]: ["COMPANY"] });
    expect(can(company, P.EMPLOYEE_READ, "SELF")).toBe(true);
    expect(can(company, P.EMPLOYEE_READ, "DEPARTMENT")).toBe(true);

    const tree = me({ [P.LEAVE_APPROVE]: ["REPORTING_TREE"] });
    expect(can(tree, P.LEAVE_APPROVE, "DIRECT_REPORTS")).toBe(true);
    expect(can(tree, P.LEAVE_APPROVE, "DEPARTMENT")).toBe(false);
    expect(can(tree, P.LEAVE_APPROVE, "COMPANY")).toBe(false);
  });

  it("denies by default", () => {
    expect(can(me({}), P.EMPLOYEE_READ)).toBe(false);
    expect(can(null, P.EMPLOYEE_READ)).toBe(false);
    expect(companyWide(me({ [P.PAYROLL_READ]: ["SELF"] }), P.PAYROLL_READ)).toBe(false);
    expect(canBeyondSelf(me({ [P.EMPLOYEE_READ]: ["SELF"] }), P.EMPLOYEE_READ)).toBe(false);
  });
});

describe("navigation is generated from permissions, not role names", () => {
  it("an employee sees only self-service items", () => {
    const employee = me({
      [P.EMPLOYEE_READ]: ["SELF"], [P.ATTENDANCE_MARK]: ["SELF"], [P.LEAVE_APPLY]: ["SELF"],
      [P.HOLIDAY_READ]: ["COMPANY"], [P.PAYROLL_READ]: ["SELF"], [P.ASSET_READ]: ["SELF"],
    });
    const items = hrefs(employee);
    expect(items).toEqual(expect.arrayContaining(["/dashboard", "/attendance", "/leaves", "/holidays", "/payslips", "/assets"]));
    expect(items).not.toContain("/employees");
    expect(items).not.toContain("/payroll");
    expect(items).not.toContain("/users");
  });

  it("a manager gets people pages but no payroll or administration", () => {
    const manager = me({ [P.EMPLOYEE_READ]: ["SELF", "REPORTING_TREE"], [P.REPORT_READ]: ["REPORTING_TREE"] });
    const items = hrefs(manager);
    expect(items).toEqual(expect.arrayContaining(["/employees", "/organization", "/reports"]));
    expect(items).not.toContain("/payroll");
    expect(items).not.toContain("/roles");
  });

  it("a custom payroll-only role sees payroll without people administration", () => {
    const payroll = me({ [P.PAYROLL_READ]: ["COMPANY"], [P.PAYROLL_PREPARE]: ["COMPANY"] }, false);
    const items = hrefs(payroll);
    expect(items).toContain("/payroll");
    expect(items).not.toContain("/employees");
    expect(items).not.toContain("/payslips"); // no employee profile linked
  });

  it("every navigable permission exists in the generated registry", () => {
    expect(Object.keys(PERMISSION_META)).toEqual(expect.arrayContaining(Object.values(P)));
  });
});
