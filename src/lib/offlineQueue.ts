/**
 * Offline punch queue of the /punch PWA (AS-M12; 04-attendance/01 §6.2 O-1..O-10).
 *
 * A punch made without network is kept on this phone with the server time of the last successful sync and the
 * monotonic time since then (`performance.now()`), so the server reconstructs the capture instant even when the
 * phone's own clock is wrong (O-2). After a page reload the monotonic clock restarts: only the wall clock is sent and
 * the server flags the item `CLOCK_SKEW`. No photo, face image or QR code is ever queued.
 *
 * `flush()` uploads the queue (≤ 50 per request) to `POST /attendance/me/offline-punches`; every item comes back with
 * its own result: accepted items leave the queue, refused ones (too old, future, state conflicts) move to the failed
 * list with the next action (e.g. "Raise a missed-punch request"). Each item keeps its idempotency key, so an upload
 * cut off half-way is simply sent again (O-8).
 */
import { http, toApiError } from "./api";

export interface QueuedPunch {
  idempotency_key: string;
  direction: "IN" | "OUT" | "BREAK_START" | "BREAK_END";
  capture_source: "WEB" | "MOBILE";
  work_location_choice?: "ON_SITE" | "REMOTE" | "FIELD" | null;
  server_time_at_sync?: string | null;
  monotonic_elapsed_ms?: number | null;
  device_wall_clock_at_capture: string;
  location?: Record<string, unknown> | null;
  location_consent?: boolean;
  exception_reason?: string | null;
  page_load?: string;
}

export interface FailedPunch {
  idempotency_key: string;
  direction: string;
  captured_at: string | null;
  code: string;
  message: string;
  next_action?: { kind: string; shift_date: string; direction: string } | null;
}

export interface UploadResult {
  received_at: string;
  accepted: number;
  failed: number;
  items: ({ ok: boolean; idempotency_key: string; direction: string; captured_at: string | null; flags: string[]; code?: string;
    message?: string; next_action?: FailedPunch["next_action"] })[];
}

const QUEUE = "hrms.offline.punches.v1";
const FAILED = "hrms.offline.failed.v1";
const PAGE_LOAD = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
let sync: { server: number; perf: number } | null = null;
const listeners = new Set<() => void>();

function read<T>(key: string): T[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function write<T>(key: string, value: T[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
  listeners.forEach((fn) => fn());
}

/** Remember the server's time (from any successful response carrying `server_now`). */
export function recordServerTime(serverNow: string | null | undefined): void {
  const at = serverNow ? Date.parse(serverNow) : NaN;
  if (!Number.isNaN(at) && typeof performance !== "undefined") sync = { server: at, perf: performance.now() };
}

export function queued(): QueuedPunch[] {
  return read<QueuedPunch>(QUEUE);
}

export function failed(): FailedPunch[] {
  return read<FailedPunch>(FAILED);
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Keep one punch on this phone (O-2). */
export function enqueue(item: Omit<QueuedPunch, "server_time_at_sync" | "monotonic_elapsed_ms" | "device_wall_clock_at_capture" | "page_load">): QueuedPunch {
  const now = new Date();
  const entry: QueuedPunch = {
    ...item,
    device_wall_clock_at_capture: now.toISOString(),
    server_time_at_sync: sync ? new Date(sync.server).toISOString() : null,
    monotonic_elapsed_ms: sync && typeof performance !== "undefined" ? Math.max(0, Math.round(performance.now() - sync.perf)) : null,
    page_load: PAGE_LOAD,
  };
  write(QUEUE, [...queued().filter((q) => q.idempotency_key !== entry.idempotency_key), entry]);
  return entry;
}

/** The body item: a monotonic reconstruction is only valid inside the page load that measured it. */
function bodyItem(q: QueuedPunch) {
  const sameLoad = q.page_load === PAGE_LOAD;
  return {
    idempotency_key: q.idempotency_key, direction: q.direction, capture_source: q.capture_source,
    work_location_choice: q.work_location_choice ?? null,
    server_time_at_sync: sameLoad ? q.server_time_at_sync ?? null : null,
    monotonic_elapsed_ms: sameLoad ? q.monotonic_elapsed_ms ?? null : null,
    device_wall_clock_at_capture: q.device_wall_clock_at_capture, location: q.location ?? null,
    location_consent: q.location_consent ?? true, exception_reason: q.exception_reason ?? null,
  };
}

let flushing: Promise<UploadResult | null> | null = null;

/** Upload the queue; resolves null when there is nothing to send or the network is still down. */
export function flush(): Promise<UploadResult | null> {
  if (flushing) return flushing;
  const items = queued().slice(0, 50);
  if (!items.length) return Promise.resolve(null);
  flushing = (async () => {
    try {
      const response = await http.post<UploadResult>("/attendance/me/offline-punches",
        { items: items.map(bodyItem), client_sent_at: new Date().toISOString() });
      const result = response.data;
      recordServerTime(result.received_at);
      const done = new Set(result.items.map((r) => r.idempotency_key));
      const refused: FailedPunch[] = result.items.filter((r) => !r.ok).map((r) => ({
        idempotency_key: r.idempotency_key, direction: r.direction, captured_at: r.captured_at,
        code: r.code ?? "REFUSED", message: r.message ?? "Refused", next_action: r.next_action ?? null,
      }));
      write(QUEUE, queued().filter((q) => !done.has(q.idempotency_key)));
      if (refused.length) write(FAILED, [...failed(), ...refused]);
      return result;
    } catch (error) {
      const err = toApiError(error);
      if (err.status === 0) return null; // still offline: keep everything
      if (err.status === 422 && err.code === "OFFLINE_PUNCHES_DISABLED") {
        write(FAILED, [...failed(), ...items.map((q) => ({ idempotency_key: q.idempotency_key, direction: q.direction,
          captured_at: q.device_wall_clock_at_capture, code: err.code ?? "OFFLINE_PUNCHES_DISABLED", message: err.message }))]);
        write(QUEUE, queued().filter((q) => !items.some((i) => i.idempotency_key === q.idempotency_key)));
      }
      throw err;
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

export function dismissFailed(key: string): void {
  write(FAILED, failed().filter((f) => f.idempotency_key !== key));
}

/** A network failure (no response at all), as opposed to a refusal the server answered. */
export function isNetworkError(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  return status === 0 || status === undefined || (typeof navigator !== "undefined" && navigator.onLine === false);
}
