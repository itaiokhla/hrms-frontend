import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { ApiError } from "@/lib/api";
import type { JobDto } from "@/lib/payroll/api";

import { JobProgress } from "../JobProgress";

const getWithEtag = jest.fn();
jest.mock("@/lib/payroll/api", () => {
  const actual = jest.requireActual("@/lib/payroll/api");
  return { ...actual, getWithEtag: (...args: unknown[]) => getWithEtag(...args) };
});
const toastPlain = jest.fn();
const toastSuccess = jest.fn();
const toastError = jest.fn();
jest.mock("react-hot-toast", () => ({
  __esModule: true,
  default: Object.assign((...a: unknown[]) => toastPlain(...a), {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  }),
}));

const job = (overrides: Partial<JobDto> = {}): JobDto => ({
  id: 5,
  type: "payroll.calculate",
  status: "RUNNING",
  progress: { done: 10, total: 40, percent: 25 },
  attempts: 1,
  max_attempts: 3,
  run_at: null,
  created_at: "2026-11-26T10:00:00Z",
  updated_at: "2026-11-26T10:00:05Z",
  finished: false,
  result: null,
  error: null,
  ...overrides,
});

const flush = async (ms = 0) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  getWithEtag.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});
afterEach(() => jest.useRealTimers());

describe("JobProgress", () => {
  it("polls with ETags, shows progress and announces completion through a toast", async () => {
    getWithEtag
      .mockResolvedValueOnce({ notModified: false, data: job(), etag: '"a"' })
      .mockResolvedValueOnce({ notModified: true, etag: '"a"' })
      .mockResolvedValueOnce({
        notModified: false,
        data: job({ status: "SUCCEEDED", finished: true, progress: { done: 40, total: 40, percent: 100 } }),
        etag: '"b"',
      });
    const onFinished = jest.fn();
    render(<JobProgress jobId={5} title="Calculating 40 employees" successMessage="Calculation finished — review the results" onFinished={onFinished} intervalMs={1000} />);
    await flush();
    const bar = screen.getByRole("progressbar", { name: "Calculating 40 employees" });
    expect(bar).toHaveAttribute("aria-valuenow", "25");
    expect(bar).toHaveAttribute("aria-valuetext", "25%, 10 of 40");
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(getWithEtag).toHaveBeenLastCalledWith("/jobs/5", null, expect.anything());
    await flush(1000);
    expect(getWithEtag).toHaveBeenLastCalledWith("/jobs/5", '"a"', expect.anything());
    expect(bar).toHaveAttribute("aria-valuenow", "25");
    await flush(1000);
    // The chip cross-fades its label; its status attribute changes at once.
    expect(document.querySelector('[data-status="SUCCEEDED"]')).not.toBeNull();
    expect(toastSuccess).toHaveBeenCalledWith("Calculation finished — review the results");
    expect(onFinished).toHaveBeenCalledTimes(1);
    await flush(5000);
    expect(getWithEtag).toHaveBeenCalledTimes(3);
  });

  it("shows a failed job with its error and a Retry action", async () => {
    getWithEtag.mockResolvedValueOnce({ notModified: false, data: job({ status: "FAILED", finished: true, error: "Pack version expired" }), etag: null });
    const onRetry = jest.fn();
    render(<JobProgress jobId={5} title="Generating payslips" onRetry={onRetry} />);
    await flush();
    expect(screen.getByText("Pack version expired")).toBeInTheDocument();
    expect(toastError).toHaveBeenCalledWith("Generating payslips: failed");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("stops after repeated request errors and resumes on Try again", async () => {
    getWithEtag.mockRejectedValue(new ApiError(0, "We couldn't reach the server.", "NETWORK"));
    render(<JobProgress jobId={9} title="Importing" intervalMs={100} />);
    await flush();
    await flush(200);
    await flush(400);
    expect(screen.getByText(/We couldn't check progress/)).toBeInTheDocument();
    expect(getWithEtag).toHaveBeenCalledTimes(3);
    getWithEtag.mockResolvedValueOnce({ notModified: false, data: job({ id: 9 }), etag: null });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await flush();
    expect(screen.queryByText(/We couldn't check progress/)).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
  });

  it("renders nothing without a job", () => {
    const { container } = render(<JobProgress jobId={null} title="x" />);
    expect(container).toBeEmptyDOMElement();
  });
});
