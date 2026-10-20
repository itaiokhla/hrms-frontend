import type { CaptureOptions, LocationAttempt } from "@/lib/geolocation";
import type { TrackingStatus } from "@/lib/types";

import { decide, MAX_WAIT_MS, remember, type SlotMemory } from "./schedule";

/**
 * Best-effort periodic location during an active shift, in a web page.
 *
 * One controller runs per tab (mounted once at the app root, so it survives
 * route changes). Tabs elect a single leader with the Web Locks API; only the
 * leader keeps a timer. Any tab re-syncs when it becomes visible, regains focus
 * or comes back online, and may then take a due reading itself (a capture lock
 * keeps two tabs from doing it at once; the server keeps one reading per slot
 * regardless). Browsers throttle or freeze hidden tabs and nothing runs once
 * the page is closed or navigated away, so the server records such slots as
 * MISSED and this controller takes one current reading when it can run again.
 * It never fills in the gap.
 */

export interface SampleBody {
  idempotency_key: string;
  attendance_id: number;
  location: LocationAttempt;
  client_sent_at: string;
}

export interface TrackerDeps {
  fetchStatus(): Promise<TrackingStatus>;
  submit(body: SampleBody): Promise<TrackingStatus>;
  capture(options: CaptureOptions): Promise<LocationAttempt>;
  newKey(): string;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  events: Pick<Window, "addEventListener" | "removeEventListener">;
  document: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
  isOnline(): boolean;
  locks?: Pick<LockManager, "request">;
  channel?: () => Pick<BroadcastChannel, "postMessage" | "close" | "addEventListener" | "removeEventListener">;
  lockName: string;
  onStatus(status: TrackingStatus | null): void;
  onPhase(phase: "idle" | "capturing" | "uploading"): void;
  onLeader(leader: boolean): void;
  onError(error: { code?: string; status?: number; message: string } | null): void;
  /** The server refused this session's access (401/403): stop for good. */
  onRevoked(status: number): void;
}

interface ApiLikeError {
  status?: number;
  code?: string;
  message?: string;
}

const RESYNC_CODES = new Set(["NOT_DUE", "TRACKING_NOT_ACTIVE", "SESSION_NOT_ACTIVE", "IDEMPOTENCY_CONFLICT"]);
const UPLOAD_BACKOFF_MS = [2_000, 8_000, 20_000];
const VISIBLE_REFRESH_MS = MAX_WAIT_MS;

export class TrackingController {
  private stopped = false;
  private leader = false;
  private status: TrackingStatus | null = null;
  private fetchedAt = 0;
  private timer: unknown = null;
  private refreshTimer: unknown = null;
  private syncTimer: unknown = null;
  private capturing = false;
  private memory: SlotMemory = { slot: null, attempts: 0, lastFailureAt: null };
  private pending: SampleBody | null = null;
  private abort = new AbortController();
  private releaseLeader: (() => void) | null = null;
  private channel: ReturnType<NonNullable<TrackerDeps["channel"]>> | null = null;

  constructor(private readonly deps: TrackerDeps) {}

  start(): void {
    const { deps } = this;
    deps.document.addEventListener("visibilitychange", this.onVisibility);
    deps.document.addEventListener("resume", this.onResume); // Page Lifecycle: a frozen tab was thawed
    deps.events.addEventListener("focus", this.onResume);
    deps.events.addEventListener("online", this.onOnline);
    deps.events.addEventListener("pageshow", this.onResume);
    if (deps.channel) {
      this.channel = deps.channel();
      this.channel.addEventListener("message", this.onMessage as EventListener);
    }
    if (deps.locks) {
      deps.locks
        .request(deps.lockName, { signal: this.abort.signal }, () => {
          if (this.stopped) return Promise.resolve();
          this.setLeader(true);
          return new Promise<void>((resolve) => {
            this.releaseLeader = resolve;
          });
        })
        .catch(() => undefined); // aborted on stop
    } else {
      this.setLeader(true); // no Web Locks: every tab schedules, the server de-duplicates
    }
    this.refreshWhileVisible();
    void this.sync("start");
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    const { deps } = this;
    this.abort.abort();
    this.releaseLeader?.();
    for (const handle of [this.timer, this.refreshTimer, this.syncTimer]) if (handle) deps.clearTimer(handle);
    deps.document.removeEventListener("visibilitychange", this.onVisibility);
    deps.document.removeEventListener("resume", this.onResume);
    deps.events.removeEventListener("focus", this.onResume);
    deps.events.removeEventListener("online", this.onOnline);
    deps.events.removeEventListener("pageshow", this.onResume);
    if (this.channel) {
      this.channel.removeEventListener("message", this.onMessage as EventListener);
      this.channel.close();
    }
    this.pending = null;
  }

  /** Ask this tab (and the others) to re-read the server's schedule, e.g. after a punch or lunch action. */
  requestSync(broadcast = true): void {
    if (broadcast) this.channel?.postMessage({ type: "sync" });
    this.queueSync("request", 0);
  }

  /** Apply a status the page already received (punch/lunch responses carry it). */
  ingest(status: TrackingStatus): void {
    this.apply(status, true);
  }

  /** User-initiated reading (e.g. after granting permission): may show the permission prompt. */
  async captureNow(): Promise<void> {
    await this.capture(true);
  }

  // ------------------------------------------------------------------ internals
  private setLeader(value: boolean) {
    this.leader = value;
    this.deps.onLeader(value);
    if (value) this.schedule();
  }

  private onVisibility = () => {
    if (this.deps.document.visibilityState === "visible") this.queueSync("visible", 250);
  };

  private onResume = () => this.queueSync("resume", 250);

  private onOnline = () => {
    if (this.pending) void this.upload(this.pending, this.maxFixAgeMs());
    this.queueSync("online", 250);
  };

  private maxFixAgeMs() {
    return (this.status?.capture.max_fix_age_seconds ?? 120) * 1000;
  }

  private onMessage = (event: MessageEvent) => {
    const data = event.data as { type?: string; status?: TrackingStatus };
    if (data?.type === "status" && data.status) this.apply(data.status, false);
    if (data?.type === "sync") this.queueSync("peer", 100);
  };

  private queueSync(reason: string, delay: number) {
    if (this.stopped) return;
    if (this.syncTimer) this.deps.clearTimer(this.syncTimer);
    // Several events fire together on a tab switch (focus + visibilitychange): sync once.
    this.syncTimer = this.deps.setTimer(() => {
      this.syncTimer = null;
      void this.sync(reason);
    }, delay);
  }

  private refreshWhileVisible() {
    if (this.stopped) return;
    this.refreshTimer = this.deps.setTimer(() => {
      // Picks up policy changes (interval, pause, disable) without polling hidden tabs.
      if (this.leader && this.deps.document.visibilityState === "visible" && this.status?.state === "ACTIVE") {
        void this.sync("refresh");
      }
      this.refreshWhileVisible();
    }, VISIBLE_REFRESH_MS);
  }

  private async sync(reason: string): Promise<void> {
    if (this.stopped) return;
    try {
      const status = await this.deps.fetchStatus();
      if (this.stopped) return;
      this.apply(status, true);
      const resumed = reason !== "start" && reason !== "refresh" && reason !== "peer";
      if (resumed && !this.leader && decide(status, this.fetchedAt, this.deps.now(), this.memory).kind === "capture") {
        void this.capture(false); // a visible follower takes the due reading if the leader is throttled
      }
    } catch (error) {
      this.handleError(error as ApiLikeError);
    }
  }

  private apply(status: TrackingStatus, broadcast: boolean) {
    if (this.stopped) return;
    this.status = status;
    this.fetchedAt = this.deps.now();
    this.deps.onStatus(status);
    if (broadcast) this.channel?.postMessage({ type: "status", status });
    this.schedule();
  }

  private schedule() {
    if (this.timer) {
      this.deps.clearTimer(this.timer);
      this.timer = null;
    }
    if (this.stopped || !this.leader) return;
    const decision = decide(this.status, this.fetchedAt, this.deps.now(), this.memory);
    if (decision.kind === "capture") void this.capture(false);
    else if (decision.kind === "wait") this.timer = this.deps.setTimer(() => this.schedule(), decision.delayMs);
  }

  private async capture(userInitiated: boolean): Promise<void> {
    const status = this.status;
    if (this.stopped || this.capturing || !status || status.state !== "ACTIVE" || status.attendance_id === null) return;
    const run = async () => {
      this.capturing = true;
      this.deps.onPhase("capturing");
      const slot = status.next_due_at;
      try {
        const attempt = await this.deps.capture({
          timeoutMs: status.capture.timeout_ms,
          maxAttempts: status.capture.max_attempts,
          acceptableAccuracyM: status.capture.acceptable_accuracy_m,
          maxFixAgeSeconds: status.capture.max_fix_age_seconds,
          allowPrompt: userInitiated,
        });
        if (this.stopped) return;
        this.memory = remember(this.memory, slot, attempt.status !== "CAPTURED", this.deps.now());
        await this.upload(
          {
            idempotency_key: this.deps.newKey(),
            attendance_id: status.attendance_id!,
            location: attempt,
            client_sent_at: new Date(this.deps.now()).toISOString(),
          },
          status.capture.max_fix_age_seconds * 1000,
        );
      } finally {
        this.capturing = false;
        this.deps.onPhase("idle");
        this.schedule();
      }
    };
    if (this.deps.locks) {
      await this.deps.locks
        .request(`${this.deps.lockName}:capture`, { ifAvailable: true }, async (lock) => {
          if (lock) {
            await run();
          } else if (!this.stopped) {
            // Another tab is taking this reading; its result arrives by broadcast. Check again later regardless.
            this.timer = this.deps.setTimer(() => this.schedule(), 30_000);
          }
        })
        .catch((error) => this.handleError(error as ApiLikeError));
    } else {
      await run().catch((error) => this.handleError(error as ApiLikeError));
    }
  }

  private async upload(body: SampleBody, maxAgeMs: number, attempt = 0): Promise<void> {
    if (this.stopped) return;
    const capturedAt = body.location.captured_at ? Date.parse(body.location.captured_at) : null;
    if (capturedAt !== null && this.deps.now() - capturedAt > maxAgeMs) {
      // Too old to describe "now": drop it rather than present an old position as current.
      this.pending = null;
      this.deps.onError({ code: "EXPIRED", message: "A location reading expired before it could be sent; a fresh one will be taken." });
      return;
    }
    this.deps.onPhase("uploading");
    try {
      // Stamped at the actual send, so the server's freshness check sees how long the reading waited.
      const status = await this.deps.submit({ ...body, client_sent_at: new Date(this.deps.now()).toISOString() });
      this.pending = null;
      this.deps.onError(null);
      this.apply(status, true);
    } catch (error) {
      const err = error as ApiLikeError;
      if ((err.status ?? 0) === 0 && attempt < UPLOAD_BACKOFF_MS.length) {
        // Offline or the network dropped: retry the same reading with the same request id.
        this.pending = body;
        this.deps.onError({ code: "NETWORK", message: "Offline: the location reading will be sent when you reconnect." });
        await new Promise<void>((resolve) => this.deps.setTimer(() => resolve(), UPLOAD_BACKOFF_MS[attempt]));
        if (!this.stopped && this.deps.isOnline()) return this.upload(body, maxAgeMs, attempt + 1);
        return;
      }
      this.pending = null;
      this.handleError(err);
    }
  }

  private handleError(error: ApiLikeError) {
    if (this.stopped) return;
    const status = error?.status ?? 0;
    if (status === 401 || status === 403) {
      this.deps.onRevoked(status);
      this.stop();
      return;
    }
    if (error?.code && RESYNC_CODES.has(error.code)) {
      this.queueSync("conflict", 500);
      return;
    }
    this.deps.onError({ code: error?.code, status, message: error?.message ?? "Location check failed" });
  }
}
