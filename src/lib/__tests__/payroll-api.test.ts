import type { AxiosRequestConfig } from "axios";

import { ApiError, http } from "../api";
import {
  IDEMPOTENCY_HEADER,
  PayrollApiError,
  getWithEtag,
  ifMatch,
  isConflict,
  isStaleVersion,
  isStepUpRequired,
  newIdempotencyKey,
  payrollApi,
  payrollError,
  rowVersionOf,
  setStepUpHandler,
  withIdempotency,
  withRowVersion,
  withStepUp,
} from "../payroll/api";

type Reply = { status: number; data?: unknown; headers?: Record<string, string> };

/** Replace the axios adapter so requests never leave the test; records each request config. */
function mockAdapter(replies: Reply[]) {
  const seen: AxiosRequestConfig[] = [];
  http.defaults.adapter = async (config) => {
    seen.push(config);
    const reply = replies.shift() ?? { status: 200, data: {} };
    const response = { data: reply.data, status: reply.status, statusText: "", headers: reply.headers ?? {}, config, request: {} };
    const valid = config.validateStatus ? config.validateStatus(reply.status) : reply.status < 300;
    if (valid) return response;
    const error = Object.assign(new Error(`Request failed with status ${reply.status}`), { config, response, isAxiosError: true });
    throw error;
  };
  return seen;
}

const header = (config: AxiosRequestConfig, name: string) => {
  const h = config.headers as Record<string, string> | { get?: (n: string) => string } | undefined;
  if (h && typeof (h as { get?: unknown }).get === "function") return (h as { get: (n: string) => string }).get(name);
  return (h as Record<string, string> | undefined)?.[name];
};

describe("payroll api helpers", () => {
  afterEach(() => setStepUpHandler(null));

  it("creates idempotency keys and request headers", () => {
    const key = newIdempotencyKey();
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newIdempotencyKey()).not.toBe(key);
    expect(withIdempotency("k-1", { headers: { A: "b" } }).headers).toEqual({ A: "b", [IDEMPOTENCY_HEADER]: "k-1" });
    expect(ifMatch(7).headers).toEqual({ "If-Match": '"7"' });
    expect(ifMatch('W/"x"').headers).toEqual({ "If-Match": 'W/"x"' });
    expect(withRowVersion({ a: 1 }, 3)).toEqual({ a: 1, row_version: 3 });
    expect(withRowVersion({ a: 1 }, null)).toEqual({ a: 1 });
    expect(rowVersionOf({ row_version: 4 })).toBe(4);
    expect(rowVersionOf({})).toBeUndefined();
  });

  it("parses structured error bodies, including 409 conflicts with the current state", () => {
    const conflict = payrollError(409, {
      detail: { message: "Someone else changed this setting.", key: "payroll.enabled", current: { value: true, row_version: 5 } },
      code: "STALE_ROW_VERSION",
    });
    expect(conflict).toBeInstanceOf(PayrollApiError);
    expect(conflict).toBeInstanceOf(ApiError);
    expect(conflict.message).toBe("Someone else changed this setting.");
    expect(conflict.current).toEqual({ value: true, row_version: 5 });
    expect(isConflict(conflict)).toBe(true);
    expect(isStaleVersion(conflict)).toBe(true);

    const fields = payrollError(422, { detail: [{ field: "amount", msg: "Money must be a string" }] });
    expect(fields.fields).toEqual([{ field: "amount", msg: "Money must be a string" }]);
    expect(fields.message).toBe("Money must be a string");
    expect(payrollError(404, {}).message).toBe("Not found.");
    expect(payrollError(409, { detail: "Already decided", code: "ALREADY_DECIDED" }).code).toBe("ALREADY_DECIDED");
    expect(isStaleVersion(payrollError(409, { detail: "x", code: "ALREADY_DECIDED" }))).toBe(false);
  });

  it("sends an Idempotency-Key on writes and If-Match for a row version", async () => {
    const seen = mockAdapter([{ status: 200, data: { ok: true } }, { status: 200, data: [] }]);
    await expect(payrollApi.post("/payroll/runs", { a: 1 }, { rowVersion: 2 })).resolves.toEqual({ ok: true });
    await payrollApi.get("/payroll/runs");
    expect(header(seen[0], IDEMPOTENCY_HEADER)).toMatch(/^[0-9a-f-]{36}$/);
    expect(header(seen[0], "If-Match")).toBe('"2"');
    expect(header(seen[1], IDEMPOTENCY_HEADER)).toBeUndefined();
  });

  it("keeps the 409 body that the shared client would flatten", async () => {
    mockAdapter([{ status: 409, data: { detail: { message: "Changed", current: { row_version: 9 } }, code: "STALE_ROW_VERSION" } }]);
    const error = (await payrollApi.put("/payroll/settings/x", {}).catch((e: unknown) => e)) as PayrollApiError;
    expect(error).toBeInstanceOf(PayrollApiError);
    expect(error.current).toEqual({ row_version: 9 });
  });

  it("asks for step-up on STEP_UP_REQUIRED and retries once with the same idempotency key", async () => {
    const seen = mockAdapter([
      { status: 403, data: { detail: "Confirm it's you to continue.", code: "STEP_UP_REQUIRED" } },
      { status: 200, data: { released: true } },
    ]);
    const handler = jest.fn().mockResolvedValue(true);
    setStepUpHandler(handler);
    await expect(payrollApi.post("/payroll/batches/1/release", {})).resolves.toEqual({ released: true });
    expect(handler).toHaveBeenCalledWith("Confirm it's you to continue.");
    expect(seen).toHaveLength(2);
    expect(header(seen[1], IDEMPOTENCY_HEADER)).toBe(header(seen[0], IDEMPOTENCY_HEADER));
  });

  it("surfaces STEP_UP_REQUIRED when cancelled or no handler is registered", async () => {
    mockAdapter([{ status: 403, data: { detail: "Confirm it's you.", code: "STEP_UP_REQUIRED" } }]);
    const error = await payrollApi.post("/x", {}).catch((e) => e);
    expect(isStepUpRequired(error)).toBe(true);

    setStepUpHandler(jest.fn().mockResolvedValue(false));
    const fn = jest.fn().mockRejectedValue(new ApiError(403, "Confirm", "STEP_UP_REQUIRED"));
    await expect(withStepUp(fn)).rejects.toBeInstanceOf(ApiError);
    expect(fn).toHaveBeenCalledTimes(1);
    await expect(withStepUp(() => Promise.reject(new ApiError(403, "No", "FORBIDDEN")))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("handles conditional GETs with ETags", async () => {
    const seen = mockAdapter([
      { status: 200, data: { id: 1 }, headers: { etag: '"v1"' } },
      { status: 304, headers: {} },
    ]);
    await expect(getWithEtag("/jobs/1")).resolves.toEqual({ notModified: false, data: { id: 1 }, etag: '"v1"' });
    await expect(getWithEtag("/jobs/1", '"v1"')).resolves.toEqual({ notModified: true, etag: '"v1"' });
    expect(header(seen[1], "If-None-Match")).toBe('"v1"');
  });
});
