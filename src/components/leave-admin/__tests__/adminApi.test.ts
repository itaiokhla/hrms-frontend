/**
 * The leave admin API client: structured errors (`detail` objects, plan validation `details.errors[]`, top-level
 * `issues`), If-Match as a bare integer, and the step-up retry on 403 STEP_UP_REQUIRED.
 */
import { ApiError, http } from "@/lib/api";
import { leaveAdminApi, leaveError } from "@/lib/leave/adminApi";
import { setStepUpHandler } from "@/lib/payroll/api";

jest.mock("@/lib/api", () => {
  const actual = jest.requireActual("@/lib/api");
  return { ...actual, http: { ...actual.http, request: jest.fn() } };
});

const request = http.request as unknown as jest.Mock;

beforeEach(() => request.mockReset());

describe("leaveError", () => {
  it("turns plan validation errors into field issues", () => {
    const error = leaveError(400, {
      code: "INVALID_FIELDS",
      detail: {
        message: "Leave plan: types[0].entitlement: PERIODIC needs frequency and post_at",
        field: "types[0].entitlement",
        details: { errors: [{ field: "types[0].entitlement", message: "PERIODIC needs frequency and post_at" }] },
      },
    });
    expect(error.code).toBe("INVALID_FIELDS");
    expect(error.field).toBe("types[0].entitlement");
    expect(error.issues).toEqual([{ code: "INVALID_FIELDS", field: "types[0].entitlement", message: "PERIODIC needs frequency and post_at", severity: "ERROR" }]);
  });

  it("keeps reference problems (`detail.issues`) and request validation errors", () => {
    const refs = leaveError(409, {
      code: "PLAN_CONFLICT",
      detail: { message: "Hourly leave is turned off.", field: "types[1].leave_type_code", issues: [{ code: "PLAN_CONFLICT", field: "types[1].leave_type_code", message: "Hourly leave is turned off." }] },
    });
    expect(refs.issues).toHaveLength(1);
    expect(refs.message).toBe("Hourly leave is turned off.");
    const fields = leaveError(422, { code: "VALIDATION_ERROR", detail: [{ field: "rules.0.priority", msg: "Input should be less than or equal to 1000" }] });
    expect(fields.issues[0]).toMatchObject({ field: "rules.0.priority" });
    expect(leaveError(404, {}).message).toMatch(/Not found/);
  });
});

describe("requests", () => {
  it("sends If-Match as the bare row version on type updates", async () => {
    request.mockResolvedValue({ status: 200, data: { id: 3 } });
    await leaveAdminApi.updateType(3, { code: "casual" } as never, 12);
    const config = request.mock.calls[0][0];
    expect(config.method).toBe("put");
    expect(config.url).toBe("/leaves/v2/types/3");
    expect(config.headers["If-Match"]).toBe("12");
    expect(config.headers["Idempotency-Key"]).toBeTruthy();
  });

  it("throws a structured error for 409 bodies", async () => {
    request.mockResolvedValue({ status: 409, data: { code: "ROW_VERSION_CONFLICT", detail: "Changed by someone else." } });
    await expect(leaveAdminApi.updateType(3, { code: "casual" } as never, 1)).rejects.toMatchObject({ status: 409, code: "ROW_VERSION_CONFLICT" });
  });

  it("retries go-live once after the step-up prompt, with the same idempotency key", async () => {
    const handler = jest.fn().mockResolvedValue(true);
    const release = setStepUpHandler(handler);
    request
      .mockRejectedValueOnce(new ApiError(403, "Confirm it's you to continue.", "STEP_UP_REQUIRED"))
      .mockResolvedValueOnce({ status: 200, data: { status: "V2_ACTIVE", grants_posted: 1, report: {} } });
    const result = await leaveAdminApi.goLive("GO LIVE");
    expect(result.status).toBe("V2_ACTIVE");
    expect(handler).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][0].headers["Idempotency-Key"]).toBe(request.mock.calls[1][0].headers["Idempotency-Key"]);
    expect(request.mock.calls[1][0].data).toEqual({ confirm: "GO LIVE" });
    release();
  });

  it("sends the import file as multipart with its kind", async () => {
    request.mockResolvedValue({ status: 201, data: { id: 5 } });
    const file = new File(["employee_code,leave_type,units,effective_date\n"], "open.csv", { type: "text/csv" });
    await leaveAdminApi.importUpload(file, "BALANCE_ADJUSTMENTS");
    const body = request.mock.calls[0][0].data as FormData;
    expect(body.get("kind")).toBe("BALANCE_ADJUSTMENTS");
    expect((body.get("file") as File).name).toBe("open.csv");
  });
});
