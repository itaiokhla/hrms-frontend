import { act } from "@testing-library/react";

import { P, type PermissionCode, type Scope } from "@/lib/permissions.generated";
import type { Me } from "@/lib/types";
import { useSession } from "@/store/session";

export function me(permissions: Partial<Record<PermissionCode, Scope[]>>, userId = 1): Me {
  return {
    user: { id: userId, email: "hr@acme.io", full_name: "HR", mfa_enabled: false, permission_version: 1, last_login_at: null },
    company: { id: 1, name: "Acme", slug: "acme", timezone: "UTC", currency: "INR", subscription: { status: "active", plan: "pro", trial_ends_at: null, active: true } },
    employee: null,
    roles: [],
    permissions,
    is_company_admin: false,
    registry_version: "test",
  };
}

export const READER: Partial<Record<PermissionCode, Scope[]>> = {
  [P.PAYROLL_SALARY_STRUCTURE_READ]: ["COMPANY"],
  [P.PAYROLL_COMPENSATION_READ]: ["COMPANY"],
};

export const EDITOR: Partial<Record<PermissionCode, Scope[]>> = {
  ...READER,
  [P.PAYROLL_SALARY_STRUCTURE_EDIT]: ["COMPANY"],
  [P.PAYROLL_COMPENSATION_EDIT]: ["COMPANY"],
};

export const APPROVER: Partial<Record<PermissionCode, Scope[]>> = {
  ...READER,
  [P.PAYROLL_COMPENSATION_APPROVE]: ["COMPANY"],
};

export function signIn(permissions: Partial<Record<PermissionCode, Scope[]>>, userId = 1) {
  act(() => useSession.setState({ me: me(permissions, userId), status: "authenticated" }));
}

/** Mutable URL state for the next/navigation mock. */
export const nav = {
  search: new URLSearchParams(),
  pathname: "/payroll/compensation",
  params: {} as Record<string, string>,
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  rerender: () => {},
};

export function resetNav(pathname: string, query = "", params: Record<string, string> = {}) {
  nav.search = new URLSearchParams(query);
  nav.pathname = pathname;
  nav.params = params;
  nav.push.mockReset();
  nav.replace.mockReset();
  nav.back.mockReset();
  const set = (url: string) => {
    nav.search = new URLSearchParams(url.split("?")[1] ?? "");
    nav.rerender();
  };
  nav.push.mockImplementation(set);
  nav.replace.mockImplementation(set);
}

export function money(amount: string, currency = "INR") {
  return { amount, currency };
}

/** Factory for `jest.mock("next/navigation", () => require("./helpers").navigationMock())`. */
export function navigationMock() {
  const router = { push: (u: string) => nav.push(u), replace: (u: string) => nav.replace(u), back: () => nav.back(), prefetch: jest.fn(), refresh: jest.fn(), forward: jest.fn() };
  return {
    useRouter: () => router,
    usePathname: () => nav.pathname,
    useSearchParams: () => nav.search,
    useParams: () => nav.params,
    notFound: () => {
      throw new Error("NEXT_NOT_FOUND");
    },
  };
}

/** A stand-in for the shared EmployeePicker (it searches /employees through the real client). */
export function employeePickerMock() {
  return {
    EmployeePicker: ({ onChange }: { onChange: (v: { id: number; full_name: string } | null) => void }) => (
      <button type="button" onClick={() => onChange({ id: 42, full_name: "Asha Rao" })}>
        Pick Asha
      </button>
    ),
  };
}
