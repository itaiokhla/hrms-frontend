import type { AxiosRequestConfig } from "axios";

import { http } from "@/lib/api";
import { setStepUpHandler } from "@/lib/payroll/api";

import { partnerAccessApi } from "../api";

type Reply = { status: number; data?: unknown };

function mockAdapter(replies: Reply[]) {
  const seen: AxiosRequestConfig[] = [];
  http.defaults.adapter = async (config) => {
    seen.push(config);
    const reply = replies.shift() ?? { status: 200, data: {} };
    const response = { data: reply.data, status: reply.status, statusText: "", headers: {}, config, request: {} };
    if (reply.status < 300) return response;
    throw Object.assign(new Error(`Request failed with status ${reply.status}`), { config, response, isAxiosError: true });
  };
  return seen;
}

const INPUT = { permission_codes: ["employee:read"], legal_entity_ids: [], pay_group_ids: [], expires_at: "2026-10-31T08:00:00Z", reason: "Month-end bureau review" };

afterEach(() => setStepUpHandler(null));

describe("partner access API", () => {
  it("uses the tenant-side paths", async () => {
    const seen = mockAdapter([{ status: 200, data: { items: [] } }, { status: 200, data: { items: [{ id: 1 }] } }, { status: 200, data: {} }]);
    await partnerAccessApi.overview();
    expect(await partnerAccessApi.activity(5)).toEqual([{ id: 1 }]);
    await partnerAccessApi.revoke(5, "Done");
    expect(seen.map((c) => `${c.method} ${c.url}`)).toEqual(["get /partner-access", "get /partner-access/5/activity", "post /partner-access/5/revoke"]);
    expect(JSON.parse(String(seen[2].data))).toEqual({ reason: "Done" });
  });

  it("prompts for a step-up when granting and retries the same grant once", async () => {
    const seen = mockAdapter([
      { status: 403, data: { detail: "Confirm it's you to continue.", code: "STEP_UP_REQUIRED" } },
      { status: 200, data: { id: 9 } },
    ]);
    const handler = jest.fn().mockResolvedValue(true);
    setStepUpHandler(handler);
    expect(await partnerAccessApi.grant(INPUT)).toEqual({ id: 9 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(2);
    expect(JSON.parse(String(seen[0].data))).toEqual(JSON.parse(String(seen[1].data)));
  });

  it("surfaces the refusal when the step-up is cancelled, and never retries other errors", async () => {
    mockAdapter([{ status: 403, data: { detail: "Confirm it's you to continue.", code: "STEP_UP_REQUIRED" } }]);
    setStepUpHandler(jest.fn().mockResolvedValue(false));
    await expect(partnerAccessApi.grant(INPUT)).rejects.toMatchObject({ status: 403, code: "STEP_UP_REQUIRED" });
    const seen = mockAdapter([{ status: 422, data: { detail: "no", code: "NOT_DELEGABLE" } }]);
    const handler = jest.fn().mockResolvedValue(true);
    setStepUpHandler(handler);
    await expect(partnerAccessApi.grant(INPUT)).rejects.toMatchObject({ status: 422, code: "NOT_DELEGABLE" });
    expect(handler).not.toHaveBeenCalled();
    expect(seen).toHaveLength(1);
  });

  it("ending access never asks for a step-up", async () => {
    mockAdapter([{ status: 403, data: { detail: "Confirm it's you to continue.", code: "STEP_UP_REQUIRED" } }]);
    const handler = jest.fn().mockResolvedValue(true);
    setStepUpHandler(handler);
    await expect(partnerAccessApi.revoke(5, "Done")).rejects.toMatchObject({ code: "STEP_UP_REQUIRED" });
    expect(handler).not.toHaveBeenCalled();
  });
});
