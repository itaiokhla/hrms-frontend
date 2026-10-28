/**
 * The kiosk device calls (AS 09-ui-ux/02 §13; backend app/routes/attendance_capture.py). The device has no user
 * session: its principal is the HttpOnly device-token cookie (Path=/api/v1/attendance/kiosk) set by `pair`. These
 * calls use plain `fetch`, never the session client, so a 401 (unpaired kiosk) never triggers a session refresh or
 * the "session expired" redirect. The page holds no token (A-22).
 */

import type { Direction } from "./captureModel";

export class KioskError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface PairResult {
  device: { id: number; code: string; name: string; timezone: string | null };
  token_expires_at: string;
}

export type IdentifyResult =
  | { recognised: false; message: string }
  | {
      recognised: true;
      kiosk_ticket: string;
      expires_at: string;
      employee: { display_name: string; initials: string };
      allowed_actions: Direction[];
      photo_allowed: boolean;
      method: string;
    };

export interface KioskPunchResult {
  success: boolean;
  direction: Direction;
  employee_name: string;
  session_id: number;
  shift_date: string;
  session_seq: number | null;
  punch_id: number | null;
  local_time: string;
  replayed?: boolean;
}

async function send<T>(path: string, init: RequestInit): Promise<{ data: T; serverDate: number | null }> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/attendance/kiosk/${path}`, { credentials: "include", ...init });
  } catch {
    throw new KioskError(0, "No connection.", "NETWORK");
  }
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = {};
  }
  if (!response.ok) {
    const detail = body.detail;
    const message = typeof detail === "string" ? detail
      : Array.isArray(detail) ? detail.map((d) => (d as { msg?: string }).msg ?? "").filter(Boolean).join(". ")
        : "The kiosk couldn't do that.";
    throw new KioskError(response.status, message || "The kiosk couldn't do that.", body.code as string | undefined);
  }
  const date = response.headers.get("date");
  return { data: body as T, serverDate: date ? new Date(date).getTime() : null };
}

export const kioskApi = {
  /** The one unauthenticated attendance call: device code + one-time claim code → device-token cookie. */
  pair: (deviceCode: string, claimCode: string) =>
    send<PairResult>("pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_code: deviceCode.trim().toUpperCase(), claim_code: claimCode.trim() }),
    }).then((r) => r.data),
  /** PIN / QR / CARD identification → a 60 s ticket (no login). */
  identify: (method: "PIN" | "QR" | "CARD" | "FACE", value?: string, image?: Blob | null) => {
    const form = new FormData();
    form.append("method", method);
    if (value) form.append("value", value);
    if (image) form.append("file", image, "capture.jpg");
    return send<IdentifyResult>("identify", { method: "POST", body: form });
  },
  /** The explicit direction of the ticket's person (never toggle-on-scan, BUG-AS-06). */
  punch: (ticket: string, direction: Direction) =>
    send<KioskPunchResult>("punch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kiosk_ticket: ticket, direction }),
    }).then((r) => r.data),
};

/** Non-secret device facts kept in this browser after pairing (name and zone for the screen header). */
export const KIOSK_DEVICE_KEY = "hrms-kiosk-device";

export function rememberDevice(device: PairResult["device"]): void {
  try {
    localStorage.setItem(KIOSK_DEVICE_KEY, JSON.stringify(device));
  } catch {
    /* private mode: the header shows a generic title */
  }
}

export function rememberedDevice(): PairResult["device"] | null {
  try {
    const raw = localStorage.getItem(KIOSK_DEVICE_KEY);
    return raw ? (JSON.parse(raw) as PairResult["device"]) : null;
  } catch {
    return null;
  }
}
