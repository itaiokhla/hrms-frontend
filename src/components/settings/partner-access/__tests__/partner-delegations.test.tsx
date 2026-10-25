import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { ApiError } from "@/lib/api";

import { PartnerDelegations, type PartnerDelegation } from "../PartnerDelegations";

const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock("react-hot-toast", () => ({ __esModule: true, default: { success: (...a: unknown[]) => mockToast.success(...a), error: (...a: unknown[]) => mockToast.error(...a) } }));

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("@/lib/api", () => {
  const actual = jest.requireActual("@/lib/api");
  return { ...actual, api: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a) } };
});

function row(overrides: Partial<PartnerDelegation> = {}): PartnerDelegation {
  return {
    id: 7, company: { id: 1, name: "Acme Corp", slug: "acme-corp" }, permissions: [{ code: "employee:read", label: "View employees" }],
    narrowed: false, read_only: true, legal_entity_count: 0, pay_group_count: 0, starts_at: "2026-10-24T08:00:00Z",
    expires_at: "2026-10-31T08:00:00Z", reason: "Month-end bureau review", ...overrides,
  };
}

const session = {
  access_token: "tok.en.value", token_type: "bearer" as const, expires_at: "2026-10-24T08:10:00Z", delegation_expires_at: "2026-10-31T08:00:00Z",
  read_only: true as const, company: { id: 1, name: "Acme Corp", slug: "acme-corp" }, permissions: ["employee:read"],
};

beforeEach(() => jest.clearAllMocks());

describe("Partner console: delegated access", () => {
  it("explains the empty state", async () => {
    mockGet.mockResolvedValue({ items: [] });
    render(<PartnerDelegations />);
    expect(await screen.findByText("No delegated access right now")).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith("/partner/delegations");
  });

  it("lists current delegations: company, permissions and limits, never HR data", async () => {
    mockGet.mockResolvedValue({ items: [row(), row({ id: 8, company: { id: 2, name: "Beta Industries", slug: "beta" }, narrowed: true, legal_entity_count: 1, pay_group_count: 2 })] });
    render(<PartnerDelegations />);
    const list = await screen.findByRole("list", { name: "Delegated access" });
    expect(within(list).getByText("Acme Corp")).toBeInTheDocument();
    expect(within(list).getByText("Beta Industries")).toBeInTheDocument();
    expect(within(list).getAllByText("Read only")).toHaveLength(2);
    expect(within(list).getByText("Limited to 1 legal entity and 2 pay groups.")).toBeInTheDocument();
    expect(within(list).getAllByText("View employees")).toHaveLength(2);
  });

  it("opens a workspace: shows the short-lived token once, read only", async () => {
    mockGet.mockResolvedValue({ items: [row()] });
    mockPost.mockResolvedValue(session);
    render(<PartnerDelegations />);
    fireEvent.click(await screen.findByRole("button", { name: "Open Acme Corp" }));
    const dialog = await screen.findByRole("dialog");
    expect(mockPost).toHaveBeenCalledWith("/partner/delegations/7/token");
    expect(within(dialog).getByLabelText("Access token")).toHaveValue("tok.en.value");
    expect(within(dialog).getByText(/Read-only: changes are refused/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("a delegation that just ended shows the refusal and refreshes the list", async () => {
    mockGet.mockResolvedValueOnce({ items: [row()] }).mockResolvedValueOnce({ items: [] });
    mockPost.mockRejectedValue(new ApiError(403, "This delegation is not current.", "DELEGATION_NOT_CURRENT"));
    render(<PartnerDelegations />);
    fireEvent.click(await screen.findByRole("button", { name: "Open Acme Corp" }));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("This delegation is not current."));
    expect(await screen.findByText("No delegated access right now")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a load failure with a retry", async () => {
    mockGet.mockRejectedValueOnce(new ApiError(500, "Server error")).mockResolvedValue({ items: [] });
    render(<PartnerDelegations />);
    expect(await screen.findByText("Server error")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No delegated access right now")).toBeInTheDocument();
  });
});
