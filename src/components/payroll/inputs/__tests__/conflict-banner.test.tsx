import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";

import { ConflictBanner as DocumentsConflictBanner } from "@/components/payroll/documents/shared";
import { PAYMENT_ERROR_TEXT, PaymentErrorBanner } from "@/components/payroll/money/shared";
import { ConflictBanner as RunsConflictBanner } from "@/components/payroll/runs/shared";
import { ApiError } from "@/lib/api";
import { payrollError } from "@/lib/payroll/api";

import { ConflictBanner, ErrorSummary, PAYROLL_ERROR_WORDING, errorWording } from "../shared";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  usePathname: () => "/payroll",
  useSearchParams: () => new URLSearchParams(),
}));

const conflict = (code: string, message = "Server says no.") => payrollError(409, { detail: message, code });

/** Every code the payment and run areas raise, with the title each area must show. */
const TITLES: [string, string][] = [
  ["FX_QUOTE_EXPIRED", "Exchange-rate quote expired"],
  ["FUNDING_SIGNATORY", "Not a signatory of the funding account"],
  ["NOT_A_SIGNATORY", "Not a signatory of the funding account"],
  ["BATCH_CANCELLED", "Payment batch cancelled"],
  ["REVERSAL_HOLD", "Held by a run reversal"],
  ["VALUE_DATE_IN_PAST", "Value date is in the past"],
  ["RUN_FINALIZED", "Pay run already finalized"],
  ["ROW_VERSION_CONFLICT", "Someone else changed this"],
  ["STEP_UP_REQUIRED", "Confirm it's you"],
  ["QUERIES_DISABLED", "Payslip queries are turned off"],
];

describe("ConflictBanner refusal codes", () => {
  it.each(TITLES)("words %s as a conflict", (code, title) => {
    render(<ConflictBanner error={conflict(code)} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-code", code);
    expect(screen.getByText(title)).toBeInTheDocument();
    const text = PAYROLL_ERROR_WORDING[code].text;
    // Codes with their own explanation replace the server text; the stale-version code keeps it.
    if (text) {
      expect(screen.getByText(text)).toBeInTheDocument();
      expect(screen.queryByText("Server says no.")).not.toBeInTheDocument();
    } else {
      expect(screen.getByText("Server says no.")).toBeInTheDocument();
    }
  });

  it("keeps the generic wording and the server message for any other code", () => {
    render(<ConflictBanner error={conflict("LOAN_LIMIT_EXCEEDED", "The most you can borrow is 50,000.00 INR.")} />);
    expect(screen.getByText("Someone else changed this")).toBeInTheDocument();
    expect(screen.getByText("The most you can borrow is 50,000.00 INR.")).toBeInTheDocument();
  });

  it("keeps the generic wording for a 412 without a code", () => {
    render(<ConflictBanner error={payrollError(412, {})} />);
    expect(screen.getByText("Someone else changed this")).toBeInTheDocument();
  });

  it("renders nothing for errors that are not conflicts, nor for no error", () => {
    const { container, rerender } = render(<ConflictBanner error={payrollError(403, { detail: "No.", code: "NOT_A_SIGNATORY" })} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ConflictBanner error={new Error("boom")} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ConflictBanner error={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("reloads on request", () => {
    const onReload = jest.fn();
    render(<ConflictBanner error={conflict("BATCH_CANCELLED")} onReload={onReload} />);
    fireEvent.click(screen.getByRole("button", { name: /Reload/ }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("does not treat inherited object keys as codes", () => {
    expect(errorWording(new ApiError(409, "x", "constructor"))).toBeNull();
    expect(errorWording(new ApiError(409, "x", "toString"))).toBeNull();
  });

  it("is the same banner in the runs and documents areas", () => {
    expect(RunsConflictBanner).toBe(ConflictBanner);
    expect(DocumentsConflictBanner).toBe(ConflictBanner);
  });
});

describe("ErrorSummary uses the same wording for non-conflict refusals", () => {
  it("words a 403 signatory refusal and a 400 past value date", () => {
    const { rerender } = render(<ErrorSummary error={payrollError(403, { detail: "Only a signatory…", code: "FUNDING_SIGNATORY" })} />);
    expect(screen.getByText("Not a signatory of the funding account")).toBeInTheDocument();
    rerender(<ErrorSummary error={payrollError(400, { detail: "The value date is in the past.", code: "VALUE_DATE_IN_PAST" })} />);
    expect(screen.getByText("Value date is in the past")).toBeInTheDocument();
    expect(screen.getByText("Choose today or a later business day as the value date.")).toBeInTheDocument();
  });

  it("leaves conflicts to the banner and shows field errors first", () => {
    const { container, rerender } = render(<ErrorSummary error={conflict("RUN_FINALIZED")} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ErrorSummary error={payrollError(400, { detail: "x", code: "VALUE_DATE_IN_PAST" })} fields={{ value_date: "Pick a date." }} />);
    expect(screen.getByText("Some fields need attention.")).toBeInTheDocument();
    expect(screen.queryByText("Value date is in the past")).not.toBeInTheDocument();
  });

  it("keeps the server message for unknown codes", () => {
    render(<ErrorSummary error={payrollError(400, { detail: "Pay group is archived.", code: "PAY_GROUP_ARCHIVED" })} />);
    expect(screen.getByText("Pay group is archived.")).toBeInTheDocument();
  });
});

describe("PaymentErrorBanner reuses the shared wording", () => {
  it("keeps the payment texts identical to the shared ones", () => {
    for (const code of ["FX_QUOTE_EXPIRED", "FUNDING_SIGNATORY", "NOT_A_SIGNATORY", "FX_RATE_MISSING"]) {
      expect(PAYMENT_ERROR_TEXT[code]).toBe(PAYROLL_ERROR_WORDING[code].text);
    }
  });

  it("titles each refusal by its own code (an FX rate gap is not a signatory problem)", () => {
    const { rerender } = render(<PaymentErrorBanner error={conflict("FX_RATE_MISSING")} />);
    expect(screen.getByText("No exchange rate available")).toBeInTheDocument();
    expect(screen.queryByText("Not a signatory of the funding account")).not.toBeInTheDocument();
    rerender(<PaymentErrorBanner error={conflict("REVERSAL_HOLD")} />);
    expect(screen.getByText("Held by a run reversal")).toBeInTheDocument();
    rerender(<PaymentErrorBanner error={payrollError(403, { detail: "No.", code: "NOT_A_SIGNATORY" })} />);
    expect(screen.getByText("Not a signatory of the funding account")).toBeInTheDocument();
  });

  it("falls back to the conflict banner for a stale version", () => {
    render(<PaymentErrorBanner error={conflict("ROW_VERSION_CONFLICT", "The payment batch was changed by someone else.")} onReload={jest.fn()} />);
    expect(screen.getByText("Someone else changed this")).toBeInTheDocument();
    expect(screen.getByText("The payment batch was changed by someone else.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reload/ })).toBeInTheDocument();
  });
});
