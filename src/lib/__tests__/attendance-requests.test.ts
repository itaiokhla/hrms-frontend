/** AS-M4 (G-13): the approvals, on-duty and muster guards, the sidebar children and the request API wrappers. */
import { ATTENDANCE_ROUTE_GATES, ATTENDANCE_ROUTE_GUARDS, canSeeApprovals, canSeeMuster, canSeeOnDuty } from "@/lib/attendance-routes";
import { ERROR_TEXT, KIND_LABELS, MUSTER_MARKS } from "@/lib/attendanceRequests";
import { navFor } from "@/lib/navigation";
import { P, type PermissionCode, type Scope } from "@/lib/permissions.generated";
import type { Me } from "@/lib/types";

function me(permissions: Partial<Record<PermissionCode, Scope[]>>, v2 = true): Me {
  return {
    user: { id: 1, email: "a@b.io", full_name: "Test User", mfa_enabled: false, permission_version: 1, last_login_at: null },
    company: { id: 1, name: "Alpha", slug: "alpha", timezone: "Asia/Kolkata", currency: "INR",
      subscription: { status: "active", plan: "pro", trial_ends_at: null, active: true } },
    employee: { id: 10, employee_code: "E1", first_name: "Test", last_name: "User", position: null, department: null, has_photo: false },
    roles: [], permissions, is_company_admin: false, registry_version: "test", attendance: { v2 },
  };
}

const priya = me({ [P.ATTENDANCE_MARK]: ["SELF"], [P.ATTENDANCE_REQUEST]: ["SELF"], [P.ATTENDANCE_READ]: ["SELF"] });
const arjun = me({ [P.ATTENDANCE_READ]: ["REPORTING_TREE"], [P.ATTENDANCE_APPROVE]: ["DIRECT_REPORTS"],
  [P.ATTENDANCE_REQUEST_ON_BEHALF]: ["DIRECT_REPORTS"] });
const prakash = me({ [P.ATTENDANCE_READ]: ["TEAM"], [P.ATTENDANCE_MUSTER]: ["TEAM"] });

const children = (user: Me) =>
  navFor(user).flatMap((g) => g.items).find((i) => i.label === "Attendance")?.children?.map((c) => c.label) ?? [];

describe("AS-M4 route guards", () => {
  it("opens approvals for approvers, on-duty for requesters and muster for muster holders", () => {
    expect(canSeeApprovals(arjun)).toBe(true);
    expect(canSeeApprovals(priya)).toBe(false);
    expect(canSeeOnDuty(priya)).toBe(true);
    expect(canSeeOnDuty(arjun)).toBe(true);
    expect(canSeeOnDuty(me({}))).toBe(false);
    expect(canSeeMuster(prakash)).toBe(true);
    expect(canSeeMuster(priya)).toBe(false);
    for (const path of ["/approvals", "/attendance/on-duty", "/attendance/remote-work", "/attendance/muster"]) {
      expect(ATTENDANCE_ROUTE_GUARDS[path]).toBeDefined();
    }
    expect(ATTENDANCE_ROUTE_GATES["/attendance/muster"]).toBe("V2");
    expect(ATTENDANCE_ROUTE_GATES["/attendance/on-duty"]).toBe("GLOBAL");
  });

  it("lists the sidebar children by permission and hides Muster on v1 tenants", () => {
    expect(children(priya)).toEqual(expect.arrayContaining(["On duty", "Remote work"]));
    expect(children(priya)).not.toContain("Approvals");
    expect(children(arjun)).toContain("Approvals");
    expect(children(prakash)).toContain("Muster");
    expect(children(me({ [P.ATTENDANCE_READ]: ["TEAM"], [P.ATTENDANCE_MUSTER]: ["TEAM"] }, false))).not.toContain("Muster");
  });

  it("labels every kind, mark and the area's error codes", () => {
    expect(Object.keys(KIND_LABELS)).toHaveLength(6);
    expect(MUSTER_MARKS).toContain("IDLE");
    expect(ERROR_TEXT.SELF_EDIT_FORBIDDEN).toMatch(/your own attendance/);
  });
});

describe("AS-M6 open shifts (A14, 03-shifts/03 §12.3)", () => {
  const imran = me({ [P.ROSTER_READ]: ["SELF"], [P.ROSTER_REQUEST]: ["SELF"] });
  const kiran = me({ [P.ROSTER_READ]: ["BRANCH"], [P.ROSTER_PLAN]: ["BRANCH"] });
  const nobody = me({ [P.ATTENDANCE_READ]: ["SELF"] });

  it("opens the board for requesters and planners on attendance v2 only", () => {
    expect(ATTENDANCE_ROUTE_GUARDS["/attendance/open-shifts"](imran)).toBe(true);
    expect(ATTENDANCE_ROUTE_GUARDS["/attendance/open-shifts"](kiran)).toBe(true);
    expect(ATTENDANCE_ROUTE_GUARDS["/attendance/open-shifts"](nobody)).toBe(false);
    expect(ATTENDANCE_ROUTE_GATES["/attendance/open-shifts"]).toBe("V2");
    // Open shifts lives in the Shifts section of the sidebar (SHIFT_ITEMS), not under Attendance.
    const shiftChildren = (user: Me) =>
      navFor(user).flatMap((g) => g.items).find((i) => i.label === "Shifts")?.children?.map((c) => c.label) ?? [];
    expect(shiftChildren(imran)).toContain("Open shifts");
    expect(children(imran)).not.toContain("Open shifts");
    expect(shiftChildren(nobody)).not.toContain("Open shifts");
    expect(shiftChildren(me({ [P.ROSTER_REQUEST]: ["SELF"] }, false))).not.toContain("Open shifts");
  });

  it("guards the open-shift page twin like the board (FU-AS-51 g)", () => {
    const detail = ATTENDANCE_ROUTE_GUARDS["/attendance/open-shifts/[id]"];
    expect([imran, kiran, nobody].map(detail)).toEqual([true, true, false]);
    expect(ATTENDANCE_ROUTE_GATES["/attendance/open-shifts/[id]"]).toBe("V2");
  });
});
