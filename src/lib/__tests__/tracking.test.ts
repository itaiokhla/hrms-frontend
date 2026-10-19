import { liveHours } from "../attendance";
import type { LocationAttempt } from "../geolocation";
import { TrackingController, type TrackerDeps } from "../tracking/controller";
import { decide, MAX_WAIT_MS, RETRY_AFTER_FAILURE_MS } from "../tracking/schedule";
import type { TrackingStatus } from "../types";

const T0 = Date.parse("2026-10-19T03:30:00Z"); // 09:00 IST

function status(overrides: Partial<TrackingStatus> = {}): TrackingStatus {
  return {
    attendance_id: 7,
    state: "ACTIVE",
    stop_reason: null,
    schedule_state: "SCHEDULED",
    next_due_at: new Date(T0 + 120 * 60_000).toISOString(),
    grace_until: null,
    overdue_since: null,
    interval_minutes: 120,
    grace_minutes: 15,
    missed_count: 0,
    pending_missed: 0,
    last_capture: null,
    last_attempt: null,
    policy_version: "v1",
    capture: {
      punch: "REQUIRED", lunch: "OPTIONAL", exception: "ALLOW_WITH_REASON", reject_low_accuracy: false,
      preferred_accuracy_m: 50, acceptable_accuracy_m: 100, timeout_ms: 20_000, max_attempts: 3, max_fix_age_seconds: 120,
      retention_days: 90,
    },
    server_now: new Date(T0).toISOString(),
    ...overrides,
  };
}

const fresh = { slot: null, attempts: 0, lastFailureAt: null };

describe("decide", () => {
  it("does nothing without an active schedule", () => {
    for (const state of ["NO_SESSION", "PAUSED", "STOPPED", "NOT_APPLICABLE"] as const) {
      expect(decide(status({ state, next_due_at: null }), T0, T0, fresh).kind).toBe("idle");
    }
    expect(decide(null, T0, T0, fresh).kind).toBe("idle");
  });

  it("waits for the server's due time, in steps of at most five minutes", () => {
    expect(decide(status(), T0, T0, fresh)).toEqual({ kind: "wait", delayMs: MAX_WAIT_MS });
    const nearlyDue = T0 + 118 * 60_000;
    expect(decide(status(), T0, nearlyDue, fresh)).toEqual({ kind: "wait", delayMs: 2 * 60_000 });
    expect(decide(status(), T0, T0 + 120 * 60_000, fresh)).toEqual({ kind: "capture" });
  });

  it("uses server time, not the device clock", () => {
    // The device clock is 3 hours behind: elapsed time since the fetch is what counts.
    const fetchedAt = T0 - 3 * 3600_000;
    expect(decide(status(), fetchedAt, fetchedAt + 60_000, fresh)).toEqual({ kind: "wait", delayMs: MAX_WAIT_MS });
  });

  it("captures at once when due or overdue (one recovery reading after a gap)", () => {
    expect(decide(status({ schedule_state: "DUE" }), T0, T0, fresh)).toEqual({ kind: "capture" });
    expect(decide(status({ schedule_state: "OVERDUE" }), T0, T0, fresh)).toEqual({ kind: "capture" });
  });

  it("backs off after a failed attempt and gives up on the slot after three", () => {
    const slot = status({ schedule_state: "DUE" });
    const failed = { slot: slot.next_due_at, attempts: 1, lastFailureAt: T0 };
    expect(decide(slot, T0, T0 + 1000, failed)).toEqual({ kind: "wait", delayMs: RETRY_AFTER_FAILURE_MS - 1000 });
    expect(decide(slot, T0, T0 + RETRY_AFTER_FAILURE_MS, failed)).toEqual({ kind: "capture" });
    expect(decide(slot, T0, T0, { ...failed, attempts: 3 }).kind).toBe("idle");
  });
});

describe("liveHours", () => {
  const base = { gross_seconds: 3600, lunch_seconds: 600, break_seconds: 600, excluded_seconds: 600, net_seconds: 3000,
    provisional: true, complete: true, issues: [] };
  it("advances net while working and lunch while on an unpaid lunch", () => {
    expect(liveHours(base, "WORKING", false, 60)).toMatchObject({ gross: 3660, lunch: 600, net: 3060 });
    expect(liveHours(base, "ON_LUNCH", false, 60)).toMatchObject({ gross: 3660, lunch: 660, net: 3000 });
    expect(liveHours(base, "ON_LUNCH", true, 60)).toMatchObject({ net: 3060 });
    expect(liveHours({ ...base, provisional: false }, "PUNCHED_OUT", false, 500)).toMatchObject({ gross: 3600, net: 3000 });
  });
});

/* ------------------------------------------------------------- controller */
class FakeLocks {
  private held = new Map<string, Promise<void>>();
  request(name: string, options: { signal?: AbortSignal; ifAvailable?: boolean }, fn: (lock: unknown) => Promise<unknown>) {
    if (options.ifAvailable) {
      if (this.held.has(name)) return Promise.resolve(fn(null));
      const run = Promise.resolve(fn({ name })).finally(() => this.held.delete(name));
      this.held.set(name, run.then(() => undefined));
      return run;
    }
    const acquire = async (): Promise<unknown> => {
      while (this.held.has(name)) {
        await this.held.get(name);
        if (options.signal?.aborted) throw new Error("AbortError");
      }
      if (options.signal?.aborted) throw new Error("AbortError");
      const run = Promise.resolve(fn({ name }));
      this.held.set(name, run.then(() => undefined));
      return run.finally(() => this.held.delete(name));
    };
    return acquire();
  }
}

function harness(overrides: Partial<TrackerDeps> = {}, shared?: { locks: FakeLocks; channel: EventTarget }) {
  const listeners = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" as DocumentVisibilityState });
  let now = T0 + 121 * 60_000; // the 11:00 slot is due
  const submitted: unknown[] = [];
  const statuses: Array<TrackingStatus | null> = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const captured: LocationAttempt = { status: "CAPTURED", latitude: 12.97, longitude: 77.59, accuracy_m: 15,
    captured_at: new Date(now).toISOString(), attempts: 1 };
  const deps: TrackerDeps = {
    fetchStatus: jest.fn(async () => status({ schedule_state: "DUE", server_now: new Date(now).toISOString() })),
    submit: jest.fn(async (body) => {
      submitted.push(body);
      return status({ next_due_at: new Date(now + 120 * 60_000).toISOString(), server_now: new Date(now).toISOString() });
    }),
    capture: jest.fn(async () => captured),
    newKey: () => `key-${submitted.length}-${Math.random().toString(16).slice(2)}`,
    now: () => now,
    setTimer: (fn, ms) => {
      const handle = setTimeout(() => {
        timers.delete(handle);
        fn();
      }, ms);
      timers.add(handle);
      return handle;
    },
    clearTimer: (handle) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
      timers.delete(handle as ReturnType<typeof setTimeout>);
    },
    events: listeners as unknown as Window,
    document: doc as unknown as Document,
    isOnline: () => true,
    locks: shared?.locks as unknown as LockManager,
    channel: shared
      ? () => {
        const port = new EventTarget();
        const relay = (event: Event) => port.dispatchEvent(new MessageEvent("message", { data: (event as MessageEvent).data }));
        shared.channel.addEventListener("message", relay);
        return {
          postMessage: (data: unknown) => {
            shared.channel.removeEventListener("message", relay);
            shared.channel.dispatchEvent(new MessageEvent("message", { data }));
            shared.channel.addEventListener("message", relay);
          },
          close: () => shared.channel.removeEventListener("message", relay),
          addEventListener: port.addEventListener.bind(port),
          removeEventListener: port.removeEventListener.bind(port),
        } as unknown as BroadcastChannel;
      }
      : undefined,
    lockName: "hrms-location-1-1",
    onStatus: (s) => statuses.push(s),
    onPhase: () => undefined,
    onLeader: () => undefined,
    onError: () => undefined,
    onRevoked: jest.fn(),
    ...overrides,
  };
  return { deps, submitted, statuses, timers, setNow: (value: number) => (now = value), doc };
}

const flush = async (rounds = 10) => {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
};

describe("TrackingController", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("takes one reading when the slot is due and then waits for the next", async () => {
    const h = harness();
    const controller = new TrackingController(h.deps);
    controller.start();
    await flush(30);
    expect(h.deps.capture).toHaveBeenCalledTimes(1);
    expect(h.submitted).toHaveLength(1);
    expect(h.timers.size).toBeGreaterThan(0); // waiting for the next slot
    controller.stop();
    expect(h.timers.size).toBe(0); // nothing keeps running after stop
  });

  it("survives a Strict Mode double mount with exactly one running controller", async () => {
    const h = harness();
    const first = new TrackingController(h.deps);
    first.start();
    first.stop(); // React's development re-mount
    const second = new TrackingController(h.deps);
    second.start();
    await flush(30);
    expect(h.deps.capture).toHaveBeenCalledTimes(1);
    second.stop();
    expect(h.timers.size).toBe(0);
  });

  it("lets only one of several tabs take the reading", async () => {
    const shared = { locks: new FakeLocks(), channel: new EventTarget() };
    const a = harness({}, shared);
    const b = harness({}, shared);
    const tabA = new TrackingController(a.deps);
    const tabB = new TrackingController(b.deps);
    tabA.start();
    tabB.start();
    await flush(40);
    expect(a.submitted.length + b.submitted.length).toBe(1);
    tabA.stop();
    tabB.stop();
  });

  it("stops for good when the server revokes the session", async () => {
    const error = Object.assign(new Error("Session expired"), { status: 401, code: "SESSION_EXPIRED" });
    const h = harness({ fetchStatus: jest.fn(async () => { throw error; }) });
    const controller = new TrackingController(h.deps);
    controller.start();
    await flush(10);
    expect(h.deps.onRevoked).toHaveBeenCalledWith(401);
    expect(h.deps.capture).not.toHaveBeenCalled();
    expect(h.timers.size).toBe(0);
  });

  it("retries an upload after a network drop with a fresh send time and the same request id", async () => {
    let calls = 0;
    const bodies: Array<{ idempotency_key: string; client_sent_at: string }> = [];
    const h = harness({
      submit: jest.fn(async (body) => {
        bodies.push(body);
        calls += 1;
        if (calls === 1) throw Object.assign(new Error("offline"), { status: 0 });
        return status({ next_due_at: new Date(T0 + 400 * 60_000).toISOString() });
      }),
    });
    const controller = new TrackingController(h.deps);
    controller.start();
    await flush(30);
    h.setNow(T0 + 121 * 60_000 + 2_000);
    jest.advanceTimersByTime(2_000);
    await flush(30);
    expect(bodies).toHaveLength(2);
    expect(bodies[1].idempotency_key).toBe(bodies[0].idempotency_key);
    expect(Date.parse(bodies[1].client_sent_at)).toBeGreaterThan(Date.parse(bodies[0].client_sent_at));
    controller.stop();
  });

  it("drops a reading that waited longer than the company's maximum age instead of sending it as current", async () => {
    const h = harness({
      submit: jest.fn(async () => {
        throw Object.assign(new Error("offline"), { status: 0 });
      }),
      isOnline: () => false,
    });
    const controller = new TrackingController(h.deps);
    controller.start();
    await flush(30);
    expect(h.deps.submit).toHaveBeenCalledTimes(1);
    h.setNow(T0 + 121 * 60_000 + 10 * 60_000); // back online ten minutes later
    (h.deps.events as unknown as EventTarget).dispatchEvent(new Event("online"));
    await flush(30);
    expect(h.deps.submit).toHaveBeenCalledTimes(1); // the stale reading was not re-sent
    controller.stop();
  });
});
