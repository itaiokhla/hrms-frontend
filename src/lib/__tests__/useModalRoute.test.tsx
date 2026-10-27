import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ConfirmProvider } from "@/components/ui/overlay";

import { useModalRoute } from "@/lib/useModalRoute";

let search = new URLSearchParams();
const push = jest.fn((url: string) => setUrl(url));
const replace = jest.fn((url: string) => setUrl(url));
const back = jest.fn();
let rerenderPage: () => void = () => {};

function setUrl(url: string) {
  search = new URLSearchParams(url.split("?")[1] ?? "");
  rerenderPage();
}

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: (u: string) => push(u), replace: (u: string) => replace(u), back: () => back() }),
  usePathname: () => "/payroll/runs",
  useSearchParams: () => search,
}));

function Page({ dirty = false }: { dirty?: boolean }) {
  const modal = useModalRoute("hold", { keys: ["employee"], dirty });
  return (
    <div>
      <span data-testid="state">{modal.open ? `open:${modal.id}` : "closed"}</span>
      <button type="button" onClick={() => modal.openModal({ employee: 42 })}>
        open
      </button>
      <button type="button" onClick={() => void modal.close()}>
        close
      </button>
      <button type="button" onClick={() => void modal.close({ force: true })}>
        saved
      </button>
    </div>
  );
}

function mount(dirty = false) {
  const utils = render(
    <ConfirmProvider>
      <Page dirty={dirty} />
    </ConfirmProvider>,
  );
  rerenderPage = () =>
    utils.rerender(
      <ConfirmProvider>
        <Page dirty={dirty} />
      </ConfirmProvider>,
    );
  return utils;
}

beforeEach(() => {
  search = new URLSearchParams("tab=employees");
  push.mockClear();
  replace.mockClear();
  back.mockClear();
});

describe("useModalRoute", () => {
  it("opens from a deep link and closes by removing only its params", async () => {
    search = new URLSearchParams("tab=employees&modal=hold&employee=7");
    mount();
    expect(screen.getByTestId("state")).toHaveTextContent("open:7");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "close" }));
    });
    expect(replace).toHaveBeenCalledWith("/payroll/runs?tab=employees");
    expect(back).not.toHaveBeenCalled();
    expect(screen.getByTestId("state")).toHaveTextContent("closed");
  });

  it("pushes the modal URL so browser Back closes it, and closes with Back", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    expect(push).toHaveBeenCalledWith("/payroll/runs?tab=employees&modal=hold&employee=42");
    expect(screen.getByTestId("state")).toHaveTextContent("open:42");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "close" }));
    });
    expect(back).toHaveBeenCalled();
    // Browser Back itself: the URL loses the params and the modal closes.
    act(() => setUrl("/payroll/runs?tab=employees"));
    expect(screen.getByTestId("state")).toHaveTextContent("closed");
  });

  it("asks before discarding a dirty form, and keeps it when the person cancels", async () => {
    search = new URLSearchParams("modal=hold&employee=7");
    mount(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "close" }));
    });
    expect(await screen.findByRole("dialog", { name: "Discard changes?" })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByTestId("state")).toHaveTextContent("open:7");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "close" }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
    });
    expect(replace).toHaveBeenCalledWith("/payroll/runs");
  });

  it("closes a dirty form without asking once it was saved (force)", async () => {
    search = new URLSearchParams("tab=employees&modal=hold&employee=42");
    mount(true);
    await act(async () => {
      fireEvent.click(screen.getByText("saved"));
    });
    expect(screen.queryByRole("dialog", { name: "Discard changes?" })).not.toBeInTheDocument();
    expect(replace).toHaveBeenCalledWith("/payroll/runs?tab=employees");
  });

  it("holds a dirty modal open after browser Back until the person decides", async () => {
    search = new URLSearchParams("modal=hold&employee=7");
    mount(true);
    act(() => setUrl("/payroll/runs"));
    expect(screen.getByTestId("state")).toHaveTextContent("open:7");
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Keep editing" }));
    });
    expect(push).toHaveBeenCalledWith("/payroll/runs?modal=hold&employee=7");
    expect(screen.getByTestId("state")).toHaveTextContent("open:7");
  });
});
