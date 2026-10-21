import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";

import { ApiError } from "@/lib/api";
import { payrollApi } from "@/lib/payroll/api";

import { ChecklistEmptyState } from "../ChecklistEmptyState";
import { StepUpAuthModal, StepUpProvider } from "../StepUpAuthModal";
import { TypedConfirmModal, useTypedConfirm } from "../TypedConfirmModal";

const status = jest.fn();
const emailCode = jest.fn();
const verify = jest.fn();
jest.mock("@/lib/payroll/api", () => {
  const actual = jest.requireActual("@/lib/payroll/api");
  return {
    ...actual,
    stepUpApi: {
      status: (...a: unknown[]) => status(...a),
      emailCode: (...a: unknown[]) => emailCode(...a),
      verify: (...a: unknown[]) => verify(...a),
    },
  };
});

beforeEach(() => {
  status.mockReset();
  emailCode.mockReset();
  verify.mockReset();
});

describe("TypedConfirmModal", () => {
  it("enables confirm only when the label is typed exactly", async () => {
    const onConfirm = jest.fn().mockResolvedValue(undefined);
    const onOpenChange = jest.fn();
    render(
      <TypedConfirmModal
        open
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
        title="Finalize run?"
        message="Finalizing locks this run."
        consequences={["Payslips will be generated", "Nothing in this run can be edited"]}
        confirmText="Nov 2026 · Staff Monthly"
        confirmLabel="Finalize"
      />,
    );
    expect(screen.getByText("Payslips will be generated")).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "Finalize" });
    expect(confirm).toBeDisabled();
    const input = screen.getByLabelText("Type “Nov 2026 · Staff Monthly” to confirm");
    fireEvent.change(input, { target: { value: "Nov 2026" } });
    expect(confirm).toBeDisabled();
    expect(screen.getByText("The text doesn't match yet.")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: " Nov 2026 · Staff Monthly " } });
    expect(confirm).toBeEnabled();
    await act(async () => {
      fireEvent.click(confirm);
    });
    expect(onConfirm).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("offers a promise API", async () => {
    let result: boolean | undefined;
    function Page() {
      const { confirmTyped, modal } = useTypedConfirm();
      return (
        <>
          <button type="button" onClick={async () => (result = await confirmTyped({ title: "Release batch?", message: "Money will leave the account.", confirmText: "PB-7" }))}>
            go
          </button>
          {modal}
        </>
      );
    }
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "go" }));
    fireEvent.change(await screen.findByLabelText("Type “PB-7” to confirm"), { target: { value: "PB-7" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    });
    expect(result).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "go" }));
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    });
    expect(result).toBe(false);
  });
});

describe("StepUpAuthModal", () => {
  it("verifies an authenticator code and resolves only on 200", async () => {
    status.mockResolvedValue({ active: false, available_methods: ["TOTP"] });
    verify.mockRejectedValueOnce(new ApiError(400, "That code is not valid. Check it and try again.", "STEP_UP_INVALID")).mockResolvedValueOnce({ method: "TOTP" });
    const onVerified = jest.fn();
    render(<StepUpAuthModal open onOpenChange={jest.fn()} onVerified={onVerified} />);
    const input = await screen.findByLabelText("Authenticator code");
    fireEvent.change(input, { target: { value: "12 34 56" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    });
    expect(verify).toHaveBeenCalledWith("123456");
    expect(onVerified).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("That code is not valid");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    });
    expect(onVerified).toHaveBeenCalled();
  });

  it("e-mails a code first for people without MFA", async () => {
    status.mockResolvedValue({ active: false, available_methods: ["EMAIL_OTP"] });
    emailCode.mockResolvedValue({ sent: true, expires_in_seconds: 600 });
    verify.mockResolvedValue({ method: "EMAIL_OTP" });
    const onVerified = jest.fn();
    render(<StepUpAuthModal open onOpenChange={jest.fn()} onVerified={onVerified} />);
    const send = await screen.findByRole("button", { name: "E-mail me a code" });
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
    await act(async () => {
      fireEvent.click(send);
    });
    expect(emailCode).toHaveBeenCalled();
    expect(screen.getByText("Code sent. It expires in 10 min.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Code from the e-mail"), { target: { value: "654321" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    });
    expect(onVerified).toHaveBeenCalled();
  });

  it("handles STEP_UP_REQUIRED from a payroll request and retries it", async () => {
    status.mockResolvedValue({ active: false, available_methods: ["TOTP"] });
    verify.mockResolvedValue({ method: "TOTP" });
    const http = jest.requireActual("@/lib/api").http;
    let calls = 0;
    http.defaults.adapter = async (config: { validateStatus?: (s: number) => boolean }) => {
      calls += 1;
      if (calls === 1) {
        const response = { status: 403, data: { detail: "Confirm it's you to continue.", code: "STEP_UP_REQUIRED" }, headers: {}, config, statusText: "", request: {} };
        throw Object.assign(new Error("403"), { config, response, isAxiosError: true });
      }
      return { status: 200, data: { ok: true }, headers: {}, config, statusText: "", request: {} };
    };
    function Page() {
      const [result, setResult] = useState("");
      return (
        <button type="button" onClick={() => payrollApi.post<{ ok: boolean }>("/payroll/batches/1/release", {}).then((r) => setResult(r.ok ? "released" : "no"))}>
          {result || "release"}
        </button>
      );
    }
    render(
      <StepUpProvider>
        <Page />
      </StepUpProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "release" }));
    const dialog = await screen.findByRole("dialog", { name: "Confirm it's you" });
    expect(dialog).toHaveTextContent("Confirm it's you to continue.");
    fireEvent.change(await screen.findByLabelText("Authenticator code"), { target: { value: "123456" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "released" })).toBeInTheDocument());
    expect(calls).toBe(2);
  });
});

describe("ChecklistEmptyState", () => {
  it("lists steps with deep links and marks the next one", () => {
    render(
      <ChecklistEmptyState
        title="3 employees · 0 salaries"
        description="Processing is disabled until salaries are assigned."
        steps={[
          { id: "structure", label: "Create a salary structure", href: "/payroll/structures", done: true },
          { id: "assign", label: "Assign salaries", href: "/payroll/compensation?filter=without" },
          { id: "bank", label: "Add bank accounts", href: "/payroll/bank-details" },
          { id: "run", label: "Create your first pay run", blockedReason: "Needs salaries first." },
        ]}
      />,
    );
    expect(screen.getByText("1 of 4 done")).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items[1]).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("link", { name: /Start: Assign salaries/ })).toHaveAttribute("href", "/payroll/compensation?filter=without");
    expect(screen.getByRole("link", { name: /Open: Add bank accounts/ })).toBeInTheDocument();
    expect(screen.getByText("Needs salaries first.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Create your first pay run/ })).not.toBeInTheDocument();
  });
});
