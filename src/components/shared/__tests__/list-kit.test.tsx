/** X-M3 list and form kit (WI-X-3.4; X 04 §2-§5): sort, search, chips, views, columns, bulk bar, URL state, FormHost. */
import "@testing-library/jest-dom";
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";

import { BulkBar, SelectAllMatching } from "@/components/shared/BulkBar";
import { ColumnChooser } from "@/components/shared/ColumnChooser";
import { FilterBar } from "@/components/shared/FilterBar";
import { FormHost, type FormRenderProps } from "@/components/shared/FormHost";
import { SavedViews } from "@/components/shared/SavedViews";
import { DataTable, Pagination } from "@/components/ui/layout";
import { ConfirmProvider } from "@/components/ui/overlay";
import type { SavedViewList } from "@/lib/savedViews";
import { useListQuery } from "@/lib/useListQuery";

let search = new URLSearchParams();
const replace = jest.fn((url: string) => {
  search = new URLSearchParams(url.split("?")[1] ?? "");
});
const push = jest.fn((url: string) => {
  search = new URLSearchParams(url.split("?")[1] ?? "");
});
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, back: jest.fn() }),
  usePathname: () => "/overtime",
  useSearchParams: () => search,
}));
jest.mock("react-hot-toast", () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));

beforeEach(() => {
  jest.clearAllMocks();
  search = new URLSearchParams();
});

type Row = { id: number; name: string; minutes: number };
const ROWS: Row[] = [{ id: 1, name: "Ravi Kumar", minutes: 90 }, { id: 2, name: "Sunita Patil", minutes: 30 }];

describe("DataTable server sort and selection", () => {
  function Sorted() {
    const [sort, setSort] = useState<string | undefined>();
    return (
      <DataTable rows={ROWS} rowKey={(r) => r.id} sort={sort} onSortChange={setSort}
        columns={[{ key: "name", header: "Employee", sortKey: "employee", cell: (r) => r.name },
          { key: "minutes", header: "Minutes", cell: (r) => r.minutes }]} />
    );
  }

  it("cycles ascending → descending → default and sets aria-sort on the header only", () => {
    render(<Sorted />);
    const header = screen.getByRole("columnheader", { name: /Employee/ });
    expect(header).not.toHaveAttribute("aria-sort");
    fireEvent.click(within(header).getByRole("button"));
    expect(header).toHaveAttribute("aria-sort", "ascending");
    fireEvent.click(within(header).getByRole("button"));
    expect(header).toHaveAttribute("aria-sort", "descending");
    fireEvent.click(within(header).getByRole("button"));
    expect(header).not.toHaveAttribute("aria-sort");
    expect(within(screen.getByRole("columnheader", { name: "Minutes" })).queryByRole("button")).toBeNull();
  });

  it("labels row checkboxes and selects the page from the header", () => {
    const onTogglePage = jest.fn();
    render(<DataTable rows={ROWS} rowKey={(r) => r.id} columns={[{ key: "name", header: "Employee", cell: (r) => r.name }]}
      selection={{ isSelected: () => false, onToggle: jest.fn(), onTogglePage, label: (r) => `Select ${r.name}` }} />);
    expect(screen.getByRole("checkbox", { name: "Select Ravi Kumar" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all rows on this page" }));
    expect(onTogglePage).toHaveBeenCalledWith(ROWS, true);
  });

  it("makes the identifier a real link that a plain click opens in place", () => {
    const open = jest.fn();
    render(<DataTable rows={ROWS} rowKey={(r) => r.id} onRowClick={open} rowHref={(r) => `/overtime?modal=overtime-entry&id=${r.id}`}
      columns={[{ key: "name", header: "Employee", cell: (r) => r.name }]} />);
    const link = screen.getByRole("link", { name: "Ravi Kumar" });
    expect(link).toHaveAttribute("href", "/overtime?modal=overtime-entry&id=1");
    fireEvent.click(link);
    expect(open).toHaveBeenCalledWith(ROWS[0]);
    open.mockClear();
    fireEvent.click(link, { ctrlKey: true }); // new tab: left to the browser
    expect(open).not.toHaveBeenCalled();
  });
});

describe("Pagination 25 / 50", () => {
  it("always shows the total and the page-size choice when sizes are offered", () => {
    const setLimit = jest.fn();
    render(<Pagination total={12} skip={0} limit={25} onChange={jest.fn()} pageSizes={[25, 50]} onLimitChange={setLimit} />);
    expect(screen.getByText("1–12 of 12")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Rows per page"), { target: { value: "50" } });
    expect(setLimit).toHaveBeenCalledWith(50);
  });
});

describe("FilterBar", () => {
  it("has a labelled search that Escape clears, removable chips, Clear all and a live count", () => {
    const onChange = jest.fn();
    const onRemove = jest.fn();
    const onClear = jest.fn();
    render(<FilterBar search={{ value: "ravi", onChange }} chips={[{ key: "status", label: "Status", values: ["Pending"] },
      { key: "branch", label: "Branch", values: ["Pune Plant"], fixed: true }]} onRemoveChip={onRemove} onClearAll={onClear}
      resultCount={37} />);
    const box = screen.getByLabelText("Search name or code");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(onChange).toHaveBeenCalledWith("");
    fireEvent.click(screen.getByRole("button", { name: "Remove filter Status" }));
    expect(onRemove).toHaveBeenCalledWith("status");
    expect(screen.queryByRole("button", { name: "Remove filter Branch" })).toBeNull(); // fixed scope chip
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onClear).toHaveBeenCalled();
    expect(screen.getByTestId("result-count")).toHaveTextContent("37 results");
  });
});

describe("SavedViews tabs", () => {
  const DATA: SavedViewList = {
    list_key: "overtime.entries", default_sort: "-date", sort_keys: ["date"], columns: [], page_sizes: [25, 50], limit: 20,
    system_views: [{ id: "sys:waiting_for_me", key: "waiting_for_me", name: "Waiting for me", query: { awaiting: true }, is_hidden: false, position: 0 },
      { id: "sys:in_my_scope", key: "in_my_scope", name: "In my scope", query: {}, is_hidden: true, position: 1 }],
    views: [{ id: 7, list_key: "overtime.entries", name: "Night shifts", query: { status: "PENDING_APPROVAL" }, is_shared: false, is_default: false,
      position: 0, own: true, owner_name: null, row_version: 1, allowed_actions: ["update", "delete"] },
    { id: 9, list_key: "overtime.entries", name: "Karan's view", query: {}, is_shared: true, is_default: false, position: 0, own: false,
      owner_name: "Karan Desai", row_version: 1, allowed_actions: [] }],
  };

  it("orders All · system (not hidden) · own · shared, and selects with the stored query", () => {
    const onSelect = jest.fn();
    render(<SavedViews data={DATA} active="7" modified onSelect={onSelect} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent?.replace(/Shared|•/g, ""))).toEqual(
      ["All", "Waiting for me", "Night shifts", "Karan's view"]);
    expect(screen.getByRole("tab", { name: /Night shifts/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("modified")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Waiting for me" }));
    expect(onSelect).toHaveBeenCalledWith("sys:waiting_for_me", { awaiting: true });
    expect(screen.getByRole("tab", { name: /Karan's view/ })).toHaveAttribute("title", "Shared by Karan Desai");
  });
});

describe("BulkBar", () => {
  it("is shown only while something is selected and offers Select all matching", () => {
    const { rerender } = render(<BulkBar count={0} onClear={jest.fn()}><button>Approve</button></BulkBar>);
    expect(screen.queryByRole("region", { name: "Bulk actions" })).toBeNull();
    const clear = jest.fn();
    rerender(<BulkBar count={12} onClear={clear}><button>Approve</button></BulkBar>);
    expect(screen.getByRole("region", { name: "Bulk actions" })).toHaveTextContent("12 selected");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(clear).toHaveBeenCalled();
    const all = jest.fn();
    render(<SelectAllMatching pageCount={25} total={312} onSelectAll={all} />);
    fireEvent.click(screen.getByRole("button", { name: "Select all 312 matching" }));
    expect(all).toHaveBeenCalled();
  });
});

describe("ColumnChooser", () => {
  it("moves columns with buttons (not drag only) and resets", async () => {
    const onChange = jest.fn();
    render(<ColumnChooser columns={[{ key: "a", label: "Requested" }, { key: "b", label: "Status" }]} visible={["a", "b"]}
      onChange={onChange} defaults={["a", "b"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    fireEvent.click(await screen.findByRole("button", { name: "Move Requested down" }));
    expect(onChange).toHaveBeenCalledWith(["b", "a"]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Status" }));
    expect(onChange).toHaveBeenCalledWith(["a"]);
  });
});

describe("useListQuery URL state", () => {
  const options = { filters: ["status"], sortKeys: ["date", "employee"] };

  it("never writes defaults, resets skip on a filter change and keeps the first row on a limit change", () => {
    search = new URLSearchParams("tab=all&skip=50&limit=50&modal=overtime-entry&id=4");
    const { result, rerender } = renderHook(() => useListQuery(options));
    expect(result.current.skip).toBe(50);
    act(() => result.current.setFilter("status", "APPROVED"));
    expect(replace).toHaveBeenLastCalledWith("/overtime?tab=all&limit=50&modal=overtime-entry&id=4&status=APPROVED", { scroll: false });
    rerender();
    act(() => result.current.setLimit(25));
    expect(replace.mock.calls.at(-1)?.[0]).not.toMatch(/limit=25/); // the default page size is not written
  });

  it("drops an unknown sort from the URL", async () => {
    search = new URLSearchParams("sort=salary");
    const { result } = renderHook(() => useListQuery(options));
    expect(result.current.sort).toBeUndefined();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/overtime", { scroll: false }));
  });
});

describe("FormHost (one form, three frames)", () => {
  function ShiftForm({ formId, mode, onSuccess, setDirty }: FormRenderProps) {
    return (
      <form id={formId} noValidate onSubmit={(e) => { e.preventDefault(); onSuccess({ id: 57 }); }}>
        <label>Name<input onChange={() => setDirty(true)} /></label>
        <span data-testid="mode">{mode}</span>
      </form>
    );
  }
  const host = () => (
    <ConfirmProvider>
      <FormHost formKey="shift" objectName="Shift" recordTitle={(id) => `Shift #${id}`} renderForm={(p) => <ShiftForm {...p} />}
        renderView={(id) => <p>Details of {id}</p>} />
    </ConfirmProvider>
  );

  it("creates in a Modal and replaces the URL with the new record's Sheet", async () => {
    search = new URLSearchParams("modal=shift");
    render(host());
    expect(screen.getByRole("dialog", { name: "New shift" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create shift" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/overtime?modal=shift&id=57", { scroll: false }));
  });

  it("views in a Sheet, edits by swapping the body, and asks before discarding with Keep editing", async () => {
    search = new URLSearchParams("modal=shift&id=57");
    const { rerender } = render(host());
    expect(screen.getByRole("dialog", { name: "Shift #57" })).toHaveTextContent("Details of 57");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(replace).toHaveBeenLastCalledWith("/overtime?modal=shift&id=57&mode=edit", { scroll: false });
    rerender(host());
    expect(screen.getByRole("dialog", { name: "Editing Shift #57" })).toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1); // never a second overlay
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "General 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const discard = await screen.findByRole("dialog", { name: "Discard changes?" });
    fireEvent.click(within(discard).getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Discard changes?" })).toBeNull());
    expect(screen.getByTestId("mode")).toHaveTextContent("edit");
  });
});
