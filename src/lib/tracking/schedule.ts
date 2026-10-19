import type { TrackingStatus } from "@/lib/types";

/** Never sleep longer than this between checks, so device sleep or clock jumps are noticed. */
export const MAX_WAIT_MS = 5 * 60_000;
/** After a failed attempt (permission, timeout), wait before retrying the same slot. */
export const RETRY_AFTER_FAILURE_MS = 5 * 60_000;
/** Attempts per scheduled slot from this tab; the server keeps one outcome per slot anyway. */
export const MAX_ATTEMPTS_PER_SLOT = 3;

export interface SlotMemory {
  slot: string | null;
  attempts: number;
  lastFailureAt: number | null;
}

export type Decision = { kind: "idle"; reason: string } | { kind: "capture" } | { kind: "wait"; delayMs: number };

/** Server time now, from the status's server_now plus the time elapsed since it was fetched. */
export function serverNow(status: TrackingStatus, fetchedAt: number, now: number): number {
  return Date.parse(status.server_now) + Math.max(0, now - fetchedAt);
}

/**
 * What the browser should do next. The server owns the schedule (next_due_at);
 * this only turns it into "capture now", "wait N ms" or "nothing to do".
 */
export function decide(status: TrackingStatus | null, fetchedAt: number, now: number, memory: SlotMemory): Decision {
  if (!status || status.state !== "ACTIVE" || !status.next_due_at) return { kind: "idle", reason: status?.state ?? "NO_STATUS" };
  const slot = status.next_due_at;
  const sameSlot = memory.slot === slot;
  if (sameSlot && memory.attempts >= MAX_ATTEMPTS_PER_SLOT) return { kind: "idle", reason: "SLOT_ATTEMPTS_EXHAUSTED" };
  if (sameSlot && memory.lastFailureAt !== null && now - memory.lastFailureAt < RETRY_AFTER_FAILURE_MS) {
    return { kind: "wait", delayMs: RETRY_AFTER_FAILURE_MS - (now - memory.lastFailureAt) };
  }
  if (status.schedule_state === "DUE" || status.schedule_state === "OVERDUE") return { kind: "capture" };
  const remaining = Date.parse(slot) - serverNow(status, fetchedAt, now);
  if (remaining <= 0) return { kind: "capture" };
  return { kind: "wait", delayMs: Math.min(remaining, MAX_WAIT_MS) };
}

export function remember(memory: SlotMemory, slot: string | null, failed: boolean, now: number): SlotMemory {
  const attempts = memory.slot === slot ? memory.attempts + 1 : 1;
  return { slot, attempts, lastFailureAt: failed ? now : null };
}
