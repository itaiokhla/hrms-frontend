/** Calendar hierarchy UI (LH-M1 Goal 2; 04-holiday/01 §3–4; 09-ui-ux/02 §18): include order, lineage tree, forms. */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { CalendarAssignmentForm } from "@/components/holiday/CalendarAssignmentForm";
import { includePriorities } from "@/components/holiday/CalendarDetail";
import { CalendarLineageTree } from "@/components/holiday/CalendarLineageTree";
import { CalendarForm } from "@/components/holiday/CalendarsPage";
import { api } from "@/lib/api";
import { calendarsApi, HolidayApiError, type Calendar, type LineageNode } from "@/lib/holiday/api";

jest.mock("react-hot-toast", () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => "/holidays/calendars",
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("@/lib/api", () => {
  const actual = jest.requireActual("@/lib/api");
  return { ...actual, api: { ...actual.api, get: jest.fn() } };
});
jest.mock("@/lib/holiday/api", () => {
  const actual = jest.requireActual("@/lib/holiday/api");
  return {
    ...actual,
    calendarsApi: { ...actual.calendarsApi, create: jest.fn(), update: jest.fn(), setBranchLink: jest.fn(), createAssignment: jest.fn() },
  };
});

const mocked = calendarsApi as jest.Mocked<typeof calendarsApi>;
const get = api.get as jest.Mock;

const BLR: Calendar = {
  id: 7,
  code: "BENGALURU_TECH_PARK_2026",
  name: "Bengaluru Tech Park 2026",
  name_i18n: {},
  description: null,
  legal_entity_id: null,
  owner: "Tenant-wide",
  country_code: "IN",
  subdivision_code: "IN-KA",
  weekend_days: null,
  effective_weekend: [6],
  employee_observance: "NONE",
  status: "ACTIVE",
  row_version: 3,
  parent_calendar_id: null,
  includes_count: 1,
  used_by: { branches: 0, employees: 0, criteria: 0 } as Calendar["used_by"],
  can_manage: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  get.mockImplementation((url: string) =>
    Promise.resolve(url === "/branches" ? [{ id: 21, name: "Bengaluru Office", code: "BR21" }] : url === "/legal-entities" ? [] : { items: [] }),
  );
});

describe("include priorities", () => {
  const row = (id: number) => ({ included_calendar_id: id, code: `C${id}`, name: `C${id}` });

  it("numbers includes from 1 in order", () => {
    expect(includePriorities([row(3), row(1)], null)).toEqual([
      { included_calendar_id: 3, priority: 1 },
      { included_calendar_id: 1, priority: 2 },
    ]);
  });

  it("keeps 0 for the legacy parent while it stays first", () => {
    expect(includePriorities([row(9), row(3)], 9).map((r) => r.priority)).toEqual([0, 1]);
  });

  it("drops the reserved 0 once the parent moves down (the server then clears the legacy parent)", () => {
    expect(includePriorities([row(3), row(9)], 9).map((r) => r.priority)).toEqual([1, 2]);
  });
});

describe("lineage tree", () => {
  const node = (id: number, code: string, extra: Partial<LineageNode> = {}): LineageNode => ({
    id,
    code,
    name: code,
    status: "ACTIVE",
    priority: null,
    own_count: 0,
    exclusions: 0,
    repeated: false,
    children: [],
    ...extra,
  });

  it("shows includes in order with priority, own counts, exclusions and diamonds once", () => {
    const root = node(1, "BLR", {
      own_count: 2,
      exclusions: 1,
      children: [
        node(2, "INDIA", { priority: 1, own_count: 12, children: [node(4, "BASE", { priority: 1, own_count: 3 })] }),
        node(3, "KA", { priority: 2, children: [node(4, "BASE", { priority: 1, repeated: true })] }),
      ],
    });
    render(<CalendarLineageTree root={root} year={2026} />);
    expect(screen.getByRole("tree")).toHaveAccessibleName("Calendars BLR includes");
    expect(screen.getByTestId("lineage-node-INDIA")).toHaveTextContent("priority 1");
    expect(screen.getByTestId("lineage-node-INDIA")).toHaveTextContent("12 own in 2026");
    expect(screen.getByTestId("lineage-node-BLR")).toHaveTextContent("1 excluded");
    expect(screen.getAllByTestId("lineage-node-BASE")).toHaveLength(2);
    expect(screen.getByText(/also included above/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "INDIA" })).toHaveAttribute("href", "/holidays/calendars/2");
  });
});

describe("calendar form", () => {
  it("creates with a derived weekend and an upper-case region", async () => {
    mocked.create.mockResolvedValue({ ...BLR, id: 8 });
    const onSaved = jest.fn();
    render(<CalendarForm onSaved={onSaved} onCancel={jest.fn()} />);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "India National 2026" } });
    fireEvent.change(screen.getByLabelText(/^Country/), { target: { value: "in" } });
    fireEvent.click(screen.getByTestId("calendar-save"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mocked.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "India National 2026", country_code: "IN", weekend_days: null, legal_entity_id: null }),
    );
  });

  it("puts a taken code on the code field", async () => {
    mocked.create.mockRejectedValue(new HolidayApiError(409, "Code INDIA is already used.", "ORG_CODE_TAKEN"));
    render(<CalendarForm onSaved={jest.fn()} onCancel={jest.fn()} />);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "India" } });
    fireEvent.click(screen.getByTestId("calendar-save"));
    expect(await screen.findByText("Code INDIA is already used.")).toBeInTheDocument();
  });

  it("edits with If-Match and an explicit weekend", async () => {
    mocked.update.mockResolvedValue(BLR);
    render(<CalendarForm calendar={BLR} onSaved={jest.fn()} onCancel={jest.fn()} />);
    fireEvent.click(screen.getByLabelText("Fri"));
    fireEvent.click(screen.getByTestId("calendar-save"));
    await waitFor(() => expect(mocked.update).toHaveBeenCalledWith(7, expect.objectContaining({ weekend_days: [4] }), 3));
  });
});

describe("calendar assignment form", () => {
  const today = "2026-10-27";

  it("links a branch from a date", async () => {
    mocked.setBranchLink.mockResolvedValue({} as never);
    const onSaved = jest.fn();
    render(<CalendarAssignmentForm calendar={BLR} today={today} onSaved={onSaved} onCancel={jest.fn()} />);
    fireEvent.click(screen.getByTestId("assignment-save"));
    expect(await screen.findByText("Choose a branch.")).toBeInTheDocument();
    await screen.findByRole("option", { name: "Bengaluru Office (BR21)" });
    fireEvent.change(screen.getByTestId("assignment-branch"), { target: { value: "21" } });
    fireEvent.change(screen.getByTestId("assignment-from"), { target: { value: "2026-11-01" } });
    fireEvent.click(screen.getByTestId("assignment-save"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mocked.setBranchLink).toHaveBeenCalledWith(21, { holiday_calendar_id: 7, effective_from: "2026-11-01" });
  });

  it("asks for a reason before a backdated link", async () => {
    render(<CalendarAssignmentForm calendar={BLR} today={today} onSaved={jest.fn()} onCancel={jest.fn()} />);
    await screen.findByRole("option", { name: "Bengaluru Office (BR21)" });
    fireEvent.change(screen.getByTestId("assignment-branch"), { target: { value: "21" } });
    fireEvent.change(screen.getByTestId("assignment-from"), { target: { value: "2026-10-20" } });
    fireEvent.click(screen.getByTestId("assignment-save"));
    expect(await screen.findByText("Give a reason for a backdated change.")).toBeInTheDocument();
    expect(mocked.setBranchLink).not.toHaveBeenCalled();
  });

  it("shows the server's entity mismatch", async () => {
    mocked.setBranchLink.mockRejectedValue(new HolidayApiError(422, "BR21 belongs to another legal entity.", "CALENDAR_ENTITY_MISMATCH"));
    render(<CalendarAssignmentForm calendar={BLR} today={today} onSaved={jest.fn()} onCancel={jest.fn()} />);
    await screen.findByRole("option", { name: "Bengaluru Office (BR21)" });
    fireEvent.change(screen.getByTestId("assignment-branch"), { target: { value: "21" } });
    fireEvent.click(screen.getByTestId("assignment-save"));
    expect(await screen.findByText("BR21 belongs to another legal entity.")).toBeInTheDocument();
  });

  it("saves a criteria row and maps a priority clash to the priority field", async () => {
    mocked.createAssignment.mockRejectedValueOnce(new HolidayApiError(409, "Priority 100 overlaps row 4.", "CALENDAR_ASSIGNMENT_CONFLICT"));
    render(<CalendarAssignmentForm calendar={BLR} today={today} defaultMode="criteria" onSaved={jest.fn()} onCancel={jest.fn()} />);
    fireEvent.click(screen.getByTestId("assignment-save"));
    expect(await screen.findByText("Choose at least one group.")).toBeInTheDocument();
    fireEvent.click(await screen.findByLabelText("Bengaluru Office"));
    fireEvent.click(screen.getByTestId("assignment-save"));
    expect(await screen.findByText("Priority 100 overlaps row 4.")).toBeInTheDocument();
    expect(mocked.createAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ calendar_id: 7, criteria: { branch_ids: [21] }, priority: 100, effective_from: today }),
    );
  });
});
