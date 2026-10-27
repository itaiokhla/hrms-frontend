/** LH BUG-24 (safe parts, LH-M0): ?tab= validated, ErrorState + Retry instead of stuck skeletons, paged Requests. */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import LeavesPage from "@/app/(app)/leaves/page";
import { me, signIn } from "@/components/payroll/inputs/__tests__/fixtures";
import { ApiError } from "@/lib/api";
import { P } from "@/lib/permissions.generated";

let mockSearch = new URLSearchParams();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  usePathname: () => "/leaves",
  useSearchParams: () => mockSearch,
}));
jest.mock("react-hot-toast", () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));

const mockGet = jest.fn();
jest.mock("@/lib/api", () => {
  const actual = jest.requireActual("@/lib/api");
  return { ...actual, api: { get: (...a: unknown[]) => mockGet(...a), post: jest.fn(), put: jest.fn() } };
});

const EMPLOYEE = me({ [P.LEAVE_APPLY]: ["SELF"], [P.LEAVE_READ]: ["SELF"] }, 42);
const HR = me({ [P.LEAVE_APPLY]: ["SELF"], [P.LEAVE_READ]: ["COMPANY"], [P.LEAVE_APPROVE]: ["COMPANY"] }, 42);

function respond(overrides: Record<string, unknown> = {}) {
  mockGet.mockImplementation((url: string) => {
    if (url in overrides) {
      const value = overrides[url];
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    }
    if (url === "/leaves/approvals" || url === "/leaves/my" || url === "/leaves/types") return Promise.resolve([]);
    if (url.startsWith("/leaves/my/balance")) return Promise.resolve({});
    if (url === "/leaves") return Promise.resolve({ total: 0, items: [], skip: 0, limit: 50 });
    return Promise.resolve([]);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = new URLSearchParams();
});

it("ignores a ?tab= the person cannot see", async () => {
  signIn(EMPLOYEE);
  respond();
  mockSearch = new URLSearchParams("tab=policy");
  render(<LeavesPage />);
  expect(await screen.findByRole("tab", { name: "My leave", selected: true })).toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: "Policy" })).not.toBeInTheDocument();
});

it("opens a visible tab from ?tab=", async () => {
  signIn(HR);
  respond();
  mockSearch = new URLSearchParams("tab=approvals");
  render(<LeavesPage />);
  expect(await screen.findByRole("tab", { name: /Approvals/, selected: true })).toBeInTheDocument();
});

it("shows an error with Retry instead of a skeleton when a load fails", async () => {
  signIn(EMPLOYEE);
  respond({ "/leaves/my": new ApiError(500, "Server unavailable") });
  render(<LeavesPage />);
  expect(await screen.findByText("Server unavailable")).toBeInTheDocument();
  respond();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.getByText("No leave requests yet")).toBeInTheDocument());
});

it("pages the Requests list with the server total", async () => {
  signIn(HR);
  respond({ "/leaves": { total: 120, items: [], skip: 0, limit: 50 } });
  mockSearch = new URLSearchParams("tab=team");
  render(<LeavesPage />);
  expect(await screen.findByText("1–50 of 120")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/leaves", { params: { status: undefined, skip: 50, limit: 50 } }));
});
