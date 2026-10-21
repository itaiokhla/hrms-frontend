import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { useSession } from "@/store/session";

import { CurrencyBadge } from "../CurrencyBadge";
import { HideAmountsToggle, MoneyText } from "../MoneyText";
import { __resetHideAmounts, hideAmountsKey, useHideAmounts } from "../useHideAmounts";

const plain = (s: string | null | undefined) => (s ?? "").replace(/[  ]/g, " ").replace(/[‎‏؜]/g, "");

function signIn(id: number) {
  act(() => {
    useSession.setState({ me: { user: { id } } as never, status: "authenticated" });
  });
}

beforeEach(() => {
  window.localStorage.clear();
  __resetHideAmounts();
  signIn(7);
});

describe("MoneyText", () => {
  it("renders the exact amount with tabular figures, left-to-right", () => {
    render(<MoneyText money={{ amount: "96775.65", currency: "INR" }} locale="en-IN" />);
    const bdi = document.querySelector("bdi")!;
    expect(plain(bdi.textContent)).toBe("₹96,775.65");
    expect(bdi).toHaveAttribute("dir", "ltr");
    expect(bdi.parentElement).toHaveClass("tabular-nums");
  });

  it("styles negatives with the danger tone and a text cue", () => {
    const { container } = render(<MoneyText amount="-1234" currency="USD" locale="en-US" />);
    const root = container.firstElementChild!;
    expect(root).toHaveClass("text-danger");
    expect(root).toHaveAttribute("data-negative", "true");
    expect(screen.getByText("(recovery)")).toBeInTheDocument();
    expect(plain(root.querySelector("bdi")!.textContent)).toBe("-$1,234.00");
  });

  it("can drop or change the negative cue", () => {
    const { rerender } = render(<MoneyText amount="-5" currency="USD" locale="en-US" negativeCue={false} />);
    expect(screen.queryByText("(recovery)")).not.toBeInTheDocument();
    rerender(<MoneyText amount="-5" currency="USD" locale="en-US" negativeCue="(owed)" />);
    expect(screen.getByText("(owed)")).toBeInTheDocument();
  });

  it("shows a dash for a missing amount", () => {
    render(<MoneyText money={null} />);
    expect(screen.getByLabelText("No amount")).toHaveTextContent("—");
  });

  it("masks digits under Hide amounts and reveals on focus or hover", () => {
    window.localStorage.setItem(hideAmountsKey(7), "1");
    __resetHideAmounts();
    const { container } = render(<MoneyText amount="1234.50" currency="USD" locale="en-US" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute("data-masked", "true");
    expect(container.textContent).not.toMatch(/\d/);
    expect(screen.getByText("Amount hidden. Focus to reveal.")).toBeInTheDocument();
    expect(root).toHaveAttribute("tabindex", "0");
    fireEvent.focus(root);
    expect(plain(root.querySelector("bdi")!.textContent)).toBe("$1,234.50");
    fireEvent.blur(root);
    expect(container.textContent).not.toMatch(/\d/);
    fireEvent.mouseEnter(root);
    expect(container.textContent).toMatch(/1,234\.50/);
  });

  it("ignores Hide amounts when not hideable", () => {
    window.localStorage.setItem(hideAmountsKey(7), "1");
    __resetHideAmounts();
    const { container } = render(<MoneyText amount="5" currency="USD" locale="en-US" hideable={false} />);
    expect(container.textContent).toMatch(/5\.00/);
  });
});

describe("HideAmountsToggle and useHideAmounts", () => {
  it("toggles every MoneyText and stores the preference per user", () => {
    const { container } = render(
      <>
        <HideAmountsToggle />
        <MoneyText amount="10" currency="USD" locale="en-US" />
      </>,
    );
    const button = screen.getByRole("button", { name: "Hide amounts" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector("[data-masked]")).not.toBeNull();
    expect(window.localStorage.getItem(hideAmountsKey(7))).toBe("1");
    expect(window.localStorage.getItem(hideAmountsKey(8))).toBeNull();
    fireEvent.click(button);
    expect(window.localStorage.getItem(hideAmountsKey(7))).toBeNull();
  });

  it("keeps working when localStorage throws", () => {
    const get = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    function Probe() {
      const { hidden, toggle } = useHideAmounts();
      return (
        <button type="button" onClick={toggle}>
          {hidden ? "hidden" : "shown"}
        </button>
      );
    }
    render(<Probe />);
    expect(screen.getByRole("button")).toHaveTextContent("shown");
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toHaveTextContent("hidden");
    get.mockRestore();
    set.mockRestore();
  });
});

describe("CurrencyBadge", () => {
  it("shows the ISO code with its name", () => {
    render(<CurrencyBadge code="aed" showName />);
    expect(screen.getByLabelText("AED, UAE Dirham")).toHaveTextContent("AEDUAE Dirham");
  });
  it("says historic or unknown in words", () => {
    const { rerender } = render(<CurrencyBadge code="BGN" />);
    expect(screen.getByText("· historic")).toBeInTheDocument();
    rerender(<CurrencyBadge code="QQQ" />);
    expect(screen.getByLabelText("QQQ, Unknown currency")).toBeInTheDocument();
  });
});
