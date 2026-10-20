import { captureLocation, type GeoEnv } from "../geolocation";

const NOW = Date.parse("2026-10-19T09:00:00Z");

function position(latitude: number, longitude: number, accuracy: number, ageMs = 0) {
  return { coords: { latitude, longitude, accuracy }, timestamp: NOW - ageMs } as unknown as GeolocationPosition;
}

/** A scripted browser: each getCurrentPosition call returns the next result. */
function env(results: Array<GeolocationPosition | { code: number; message: string }>, permission: PermissionState = "granted", secure = true) {
  const calls: PositionOptions[] = [];
  const e: GeoEnv & { calls: PositionOptions[] } = {
    isSecureContext: secure,
    calls,
    now: () => NOW,
    permissions: { query: async () => ({ state: permission }) },
    geolocation: {
      getCurrentPosition(ok, fail, options) {
        calls.push(options!);
        const next = results.shift();
        if (!next) throw new Error("unexpected extra call");
        if ("coords" in next) ok(next);
        else fail!(next as GeolocationPositionError);
      },
    },
  };
  return e;
}

const OPTIONS = { timeoutMs: 20_000, maxAttempts: 3, acceptableAccuracyM: 100, maxFixAgeSeconds: 120, allowPrompt: true };

describe("captureLocation", () => {
  it("asks for a fresh high-accuracy fix and stops once it is acceptable", async () => {
    const e = env([position(12.97, 77.59, 18)]);
    const result = await captureLocation(OPTIONS, e);
    expect(result).toMatchObject({ status: "CAPTURED", latitude: 12.97, longitude: 77.59, accuracy_m: 18, attempts: 1 });
    expect(result.captured_at).toBe("2026-10-19T09:00:00.000Z");
    expect(e.calls).toEqual([{ enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 }]);
  });

  it("retries while the fix is coarse and keeps the most accurate reading", async () => {
    const e = env([position(12.9, 77.5, 2500), position(12.97, 77.59, 400), position(12.971, 77.591, 900)]);
    const result = await captureLocation(OPTIONS, e);
    expect(result).toMatchObject({ status: "CAPTURED", accuracy_m: 400, latitude: 12.97, attempts: 3 });
  });

  it("never invents a position when every attempt fails", async () => {
    const e = env([{ code: 3, message: "Timeout expired" }, { code: 2, message: "Position unavailable" }, { code: 3, message: "Timeout expired" }]);
    const result = await captureLocation(OPTIONS, e);
    expect(result).toEqual({ status: "TIMEOUT", attempts: 3, error_message: "Timeout expired" });
    expect(result).not.toHaveProperty("latitude");
  });

  it("stops at once when permission is denied", async () => {
    expect(await captureLocation(OPTIONS, env([{ code: 1, message: "User denied Geolocation" }]))).toMatchObject({
      status: "PERMISSION_DENIED", attempts: 1,
    });
    expect(await captureLocation(OPTIONS, env([], "denied"))).toMatchObject({ status: "PERMISSION_DENIED", attempts: 0 });
  });

  it("does not open a permission prompt from a background check", async () => {
    const e = env([], "prompt");
    expect(await captureLocation({ ...OPTIONS, allowPrompt: false }, e)).toMatchObject({ status: "PERMISSION_DENIED", attempts: 0 });
    expect(e.calls).toHaveLength(0);
  });

  it("refuses stale, placeholder and non-finite readings", async () => {
    const e = env([position(12.97, 77.59, 10, 10 * 60_000), position(0, 0, 10), position(Number.NaN, 77.59, 10)]);
    expect(await captureLocation(OPTIONS, e)).toMatchObject({ status: "ERROR", attempts: 3 });
  });

  it("reports insecure pages and missing support honestly", async () => {
    expect(await captureLocation(OPTIONS, env([], "granted", false))).toMatchObject({ status: "INSECURE_CONTEXT" });
    expect(await captureLocation(OPTIONS, { isSecureContext: true, now: () => NOW })).toMatchObject({ status: "UNSUPPORTED" });
  });
});
