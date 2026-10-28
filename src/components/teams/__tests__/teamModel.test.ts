/** X-M1: the pure Teams helpers (X 01 §3, §15.2) and the "My teams" menu entries (§15.3). */
import type { Team } from "@/components/teams/api";
import { myTeamsEntries } from "@/components/teams/MyTeamsMenu";
import {
  allowedRoles, homeText, leadsText, membershipActions, rangeText, teamListParams, validateMembership, validateTeam,
  withRole, type MembershipValues, type TeamValues,
} from "@/components/teams/teamModel";

const filters = { q: "", team_type: "", status: "", has_lead: "" };

const team = (over: Partial<Team> = {}): Team => ({
  id: 1, code: "PAYMENTS", name: "Payments", team_type: "PROJECT", parent_team_id: null, legal_entity_id: 11, branch_id: 21,
  site_id: null, description: null, status: "ACTIVE", effective_from: "2026-01-01", effective_to: null, row_version: 1,
  leads: [], member_count: 0, warnings: [], ...over,
});

const teamValues = (over: Partial<TeamValues> = {}): TeamValues => ({
  code: "PAYMENTS", name: "Payments", team_type: "PROJECT", parent_team_id: "", legal_entity_id: "", branch_id: "",
  description: "", effective_from: "2026-11-02", ...over,
});

const member = (over: Partial<MembershipValues> = {}): MembershipValues => ({
  employee_id: 7, member_role: "MEMBER", is_primary_team: false, is_routing_lead: false, effective_from: "2026-11-02",
  effective_to: "", reason: "", move_primary: false, ...over,
});

describe("list views (§15.2)", () => {
  it("maps each view onto the list query", () => {
    expect(teamListParams("all", filters)).toEqual({ skip: 0, limit: 25 });
    expect(teamListParams("mine", filters)).toMatchObject({ mine: true });
    expect(teamListParams("no-lead", filters)).toMatchObject({ has_lead: false });
    expect(teamListParams("crews", filters)).toMatchObject({ team_type: "CREW" });
  });

  it("passes the filters, trims the search and lets a view win over the matching control", () => {
    const params = teamListParams("all", { q: "  pay ", team_type: "PROJECT", status: "ACTIVE", has_lead: "yes" }, 25, 25);
    expect(params).toEqual({ q: "pay", team_type: "PROJECT", status: "ACTIVE", has_lead: true, skip: 25, limit: 25 });
    expect(teamListParams("crews", { ...filters, team_type: "PROJECT" }).team_type).toBe("CREW");
    expect(teamListParams("no-lead", { ...filters, has_lead: "yes" }).has_lead).toBe(false);
    expect(teamListParams("all", { ...filters, has_lead: "no" }).has_lead).toBe(false);
  });
});

describe("cells", () => {
  it("marks the routing lead with ★ and deputies", () => {
    expect(leadsText(team())).toBe("—");
    expect(leadsText(team({ leads: [
      { employee_id: 1, name: "Meghna Rao", member_role: "LEAD", routing: true },
      { employee_id: 2, name: "Arjun Mehta", member_role: "DEPUTY_LEAD", routing: false },
    ] }))).toBe("Meghna Rao ★, Arjun Mehta (deputy)");
  });

  it("shows the branch, else the legal entity, else company-wide", () => {
    const branch = (id: number) => (id === 21 ? "Bengaluru" : undefined);
    const entity = (id: number) => (id === 11 ? "Alpha India" : undefined);
    expect(homeText(team(), branch, entity)).toBe("Bengaluru");
    expect(homeText(team({ branch_id: null }), branch, entity)).toBe("Alpha India");
    expect(homeText(team({ branch_id: 99 }), branch, entity)).toBe("Branch #99");
    expect(homeText(team({ branch_id: null, legal_entity_id: null }), branch, entity)).toBe("Company-wide");
  });

  it("writes an open range", () => {
    expect(rangeText("2026-11-02", null, (d) => d)).toBe("2026-11-02 – open");
    expect(rangeText("2026-11-02", "2026-11-30", (d) => d)).toBe("2026-11-02 – 2026-11-30");
  });
});

describe("TeamForm validation", () => {
  it("needs a code (create only), a name and a type", () => {
    expect(validateTeam(teamValues(), "create")).toEqual({});
    expect(Object.keys(validateTeam(teamValues({ code: "", name: " ", team_type: "" }), "create")).sort())
      .toEqual(["code", "name", "team_type"]);
    expect(validateTeam(teamValues({ code: "" }), "edit")).toEqual({});
  });

  it("keeps the backend code pattern and lengths", () => {
    expect(validateTeam(teamValues({ code: "CREW-A" }), "create")).toEqual({});
    expect(validateTeam(teamValues({ code: "-CREW" }), "create").code).toBeDefined();
    expect(validateTeam(teamValues({ code: "A B" }), "create").code).toBeDefined();
    expect(validateTeam(teamValues({ code: "X".repeat(31) }), "create").code).toBeDefined();
    expect(validateTeam(teamValues({ description: "x".repeat(501) }), "create").description).toBeDefined();
  });
});

describe("MembershipForm rules", () => {
  it("needs a person and ordered dates", () => {
    expect(validateMembership(member(), { canLeads: false })).toEqual({});
    expect(validateMembership(member({ employee_id: null }), { canLeads: true }).employee_id).toBeDefined();
    expect(validateMembership(member({ effective_to: "2026-11-01" }), { canLeads: true }).effective_to).toBeDefined();
    expect(validateMembership(member({ effective_to: "2026-11-02" }), { canLeads: true })).toEqual({});
  });

  it("allows leads only with the leads permission, and routing only for a LEAD", () => {
    expect(allowedRoles(false)).toEqual(["MEMBER"]);
    expect(allowedRoles(true)).toEqual(["MEMBER", "DEPUTY_LEAD", "LEAD"]);
    expect(validateMembership(member({ member_role: "LEAD" }), { canLeads: false }).member_role).toBeDefined();
    expect(validateMembership(member({ member_role: "DEPUTY_LEAD", is_routing_lead: true }), { canLeads: true }).is_routing_lead)
      .toBeDefined();
    expect(validateMembership(member({ member_role: "LEAD", is_routing_lead: true }), { canLeads: true })).toEqual({});
  });

  it("clears the routing flag when the role leaves LEAD", () => {
    const lead = member({ member_role: "LEAD", is_routing_lead: true });
    expect(withRole(lead, "DEPUTY_LEAD")).toMatchObject({ member_role: "DEPUTY_LEAD", is_routing_lead: false });
    expect(withRole(lead, "LEAD").is_routing_lead).toBe(true);
  });
});

describe("member row actions (TM-3, TM-7, SG-X3)", () => {
  const all = { members: true, leads: true };
  it("ends an active row, cancels a future one and changes either", () => {
    expect(membershipActions({ state: "ACTIVE", member_role: "MEMBER", employee_id: 7 }, all, 1))
      .toEqual({ end: true, cancel: false, changeRole: true });
    expect(membershipActions({ state: "FUTURE", member_role: "MEMBER", employee_id: 7 }, all, 1))
      .toEqual({ end: false, cancel: true, changeRole: true });
    expect(membershipActions({ state: "ENDED", member_role: "MEMBER", employee_id: 7 }, all, 1))
      .toEqual({ end: false, cancel: false, changeRole: false });
  });

  it("never lets anyone change their own row, and keeps lead rows for the leads permission", () => {
    const none = { end: false, cancel: false, changeRole: false };
    expect(membershipActions({ state: "ACTIVE", member_role: "MEMBER", employee_id: 7 }, all, 7)).toEqual(none);
    expect(membershipActions({ state: "ACTIVE", member_role: "LEAD", employee_id: 7 }, { members: true, leads: false }, 1)).toEqual(none);
    expect(membershipActions({ state: "ACTIVE", member_role: "MEMBER", employee_id: 7 }, { members: true, leads: false }, 1).end).toBe(true);
    expect(membershipActions({ state: "ACTIVE", member_role: "MEMBER", employee_id: 7 }, { members: false, leads: false }, 1)).toEqual(none);
  });
});

describe("My teams (§15.3)", () => {
  it("lists led teams first, then other memberships once each", () => {
    expect(myTeamsEntries(null)).toEqual([]);
    expect(myTeamsEntries({
      member_of: [{ id: 101, name: "Payments", primary: true }, { id: 102, name: "Platform", primary: false }],
      leads: [{ id: 101, name: "Payments", routing: true }],
      acting_for: [],
    })).toEqual([
      { id: 101, name: "Payments", lead: true, routing: true, primary: true },
      { id: 102, name: "Platform", lead: false, routing: false, primary: false },
    ]);
  });
});
