/**
 * Typed helpers for payroll v2 requests (3.9 §4, 3.8 §8).
 *
 * Built on the shared axios client (`@/lib/api`: CSRF, 401 refresh, session events) and adds:
 *
 * - `Idempotency-Key` on every state-changing request (one key per logical action, reused when the
 *   request is retried after a step-up);
 * - `row_version` / `If-Match` for optimistic concurrency, and structured `409` conflicts
 *   (`PayrollApiError.current`, `.diff`) so the UI can show "Someone else changed this" with Reload;
 * - structured error bodies: payroll errors may carry `detail` as an object
 *   (`{message, key, details, current}`), which the shared `toApiError` would flatten;
 * - `STEP_UP_REQUIRED` (403) handling: when a step-up handler is registered (`StepUpProvider`),
 *   the request waits for the person to confirm it's them, then retries once.
 */

import type { AxiosRequestConfig, AxiosResponse, Method } from "axios";

import { ApiError, http, toApiError } from "@/lib/api";
import type { Money } from "@/lib/money";

/** `{"amount": "<decimal string>", "currency": "XXX"}`: amounts are never JSON numbers (EC-MON-15). */
export type MoneyDto = Money;

export const IDEMPOTENCY_HEADER = "Idempotency-Key";
export const STEP_UP_REQUIRED = "STEP_UP_REQUIRED";

/* ------------------------------------------------------------------ errors */

export interface FieldError {
  field: string;
  msg: string;
}

/** An API error that keeps the structured body payroll endpoints send. */
export class PayrollApiError extends ApiError {
  /** The raw `detail` (string, field list or object). */
  detail: unknown;
  /** 409 conflicts: the server's current state of the object (value, level, row_version…). */
  current?: Record<string, unknown>;
  /** 409 conflicts: an optional server-computed diff. */
  diff?: unknown;
  /** Extra details (validation codes such as V-01…V-16). */
  details?: unknown;

  constructor(status: number, message: string, code: string | undefined, fields: FieldError[] | undefined, detail: unknown) {
    super(status, message, code, fields);
    this.detail = detail;
    if (detail && typeof detail === "object" && !Array.isArray(detail)) {
      const d = detail as Record<string, unknown>;
      if (d.current && typeof d.current === "object") this.current = d.current as Record<string, unknown>;
      if ("diff" in d) this.diff = d.diff;
      if ("details" in d) this.details = d.details;
    }
  }
}

const FALLBACK: Record<number, string> = {
  400: "Request failed.",
  404: "Not found.",
  409: "Someone else changed this. Reload to see the latest version.",
  412: "This changed since you opened it. Reload to see the latest version.",
  422: "Some fields need attention.",
  428: "Reload this page and try again.",
};

/** Build a `PayrollApiError` from a status and a FastAPI error body `{detail, code}`. */
export function payrollError(status: number, body: unknown): PayrollApiError {
  const data = (body && typeof body === "object" ? body : {}) as { detail?: unknown; code?: string };
  const detail = data.detail;
  const fallback = FALLBACK[status] ?? (status >= 500 ? "Something went wrong. Please try again." : "Request failed.");
  if (Array.isArray(detail)) {
    const fields = detail.filter((f): f is FieldError => !!f && typeof f === "object" && "msg" in f) as FieldError[];
    return new PayrollApiError(status, fields.map((f) => f.msg).join(". ") || fallback, data.code, fields, detail);
  }
  if (typeof detail === "string") return new PayrollApiError(status, detail || fallback, data.code, undefined, detail);
  if (detail && typeof detail === "object") {
    const message = (detail as { message?: unknown }).message;
    return new PayrollApiError(status, typeof message === "string" && message ? message : fallback, data.code, undefined, detail);
  }
  return new PayrollApiError(status, fallback, data.code, undefined, detail);
}

export function isConflict(error: unknown): error is ApiError {
  return error instanceof ApiError && (error.status === 409 || error.status === 412);
}

/** A stale `row_version` (the object changed in another tab or by another person, EC-UX-04). */
export function isStaleVersion(error: unknown): error is PayrollApiError {
  return isConflict(error) && (error.code === "STALE_ROW_VERSION" || error.status === 412 || !!(error as PayrollApiError).current);
}

export function isStepUpRequired(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403 && error.code === STEP_UP_REQUIRED;
}

/* ------------------------------------------------------------------ idempotency and versions */

/** A fresh idempotency key (UUID v4). */
export function newIdempotencyKey(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function mergeHeaders(config: AxiosRequestConfig | undefined, headers: Record<string, string>): AxiosRequestConfig {
  return { ...config, headers: { ...((config?.headers as Record<string, string> | undefined) ?? {}), ...headers } };
}

/** Request config carrying an `Idempotency-Key` (a new one when `key` is omitted). */
export function withIdempotency(key: string = newIdempotencyKey(), config?: AxiosRequestConfig): AxiosRequestConfig {
  return mergeHeaders(config, { [IDEMPOTENCY_HEADER]: key });
}

/** Request config carrying `If-Match` for a row version (quoted, as an entity tag). */
export function ifMatch(rowVersion: number | string, config?: AxiosRequestConfig): AxiosRequestConfig {
  const tag = String(rowVersion);
  return mergeHeaders(config, { "If-Match": tag.startsWith('"') || tag.startsWith("W/") ? tag : `"${tag}"` });
}

/** Add `row_version` to a request body (endpoints that take it in the body, like settings saves). */
export function withRowVersion<T extends object>(body: T, rowVersion: number | null | undefined): T & { row_version?: number } {
  return rowVersion === null || rowVersion === undefined ? body : { ...body, row_version: rowVersion };
}

/** The row version of an object returned by the API, if it has one. */
export function rowVersionOf(value: unknown): number | undefined {
  const v = value && typeof value === "object" ? (value as { row_version?: unknown }).row_version : undefined;
  return typeof v === "number" ? v : undefined;
}

/* ------------------------------------------------------------------ step-up */

type StepUpHandler = (reason?: string) => Promise<boolean>;
let stepUpHandler: StepUpHandler | null = null;

/** Registered by `StepUpProvider`; resolves `true` once the backend confirmed the step-up. */
export function setStepUpHandler(handler: StepUpHandler | null): () => void {
  stepUpHandler = handler;
  return () => {
    if (stepUpHandler === handler) stepUpHandler = null;
  };
}

export function hasStepUpHandler(): boolean {
  return stepUpHandler !== null;
}

/**
 * Run `fn`; if it fails with `STEP_UP_REQUIRED`, ask the person to confirm it's them and run it once
 * more. Without a handler, or if they cancel, the original error is thrown.
 */
export async function withStepUp<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!isStepUpRequired(error) || !stepUpHandler) throw error;
    const confirmed = await stepUpHandler((error as ApiError).message);
    if (!confirmed) throw error;
    return fn();
  }
}

/* ------------------------------------------------------------------ requests */

/** Statuses whose body we parse ourselves; 401/402/403 stay with the shared interceptor (refresh, session events). */
const STRUCTURED = new Set([400, 404, 409, 412, 422, 428]);

export interface PayrollRequestOptions {
  params?: Record<string, unknown>;
  /** Defaults to a new key for POST/PUT/PATCH/DELETE; pass one to make a retried action idempotent. */
  idempotencyKey?: string | false;
  /** Sent as `If-Match`. */
  rowVersion?: number | string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Set false to surface STEP_UP_REQUIRED instead of prompting. */
  stepUp?: boolean;
  config?: AxiosRequestConfig;
}

const UNSAFE = new Set(["post", "put", "patch", "delete"]);

export async function payrollRequest<T>(method: Method, url: string, body?: unknown, options: PayrollRequestOptions = {}): Promise<T> {
  const verb = method.toLowerCase();
  const headers: Record<string, string> = { ...options.headers };
  const key = options.idempotencyKey === false ? undefined : options.idempotencyKey ?? (UNSAFE.has(verb) ? newIdempotencyKey() : undefined);
  if (key) headers[IDEMPOTENCY_HEADER] = key;
  let config: AxiosRequestConfig = mergeHeaders(options.config, headers);
  if (options.rowVersion !== undefined) config = ifMatch(options.rowVersion, config);
  const send = async () => {
    let response: AxiosResponse<T>;
    try {
      response = await http.request<T>({
        ...config,
        method,
        url,
        data: body,
        params: options.params ?? config.params,
        signal: options.signal,
        validateStatus: (s) => (s >= 200 && s < 300) || STRUCTURED.has(s),
      });
    } catch (error) {
      throw toApiError(error);
    }
    if (response.status >= 300) throw payrollError(response.status, response.data);
    return response.data;
  };
  return options.stepUp === false ? send() : withStepUp(send);
}

export const payrollApi = {
  get: <T>(url: string, options?: PayrollRequestOptions) => payrollRequest<T>("get", url, undefined, options),
  post: <T>(url: string, body?: unknown, options?: PayrollRequestOptions) => payrollRequest<T>("post", url, body, options),
  put: <T>(url: string, body?: unknown, options?: PayrollRequestOptions) => payrollRequest<T>("put", url, body, options),
  patch: <T>(url: string, body?: unknown, options?: PayrollRequestOptions) => payrollRequest<T>("patch", url, body, options),
  delete: <T>(url: string, options?: PayrollRequestOptions) => payrollRequest<T>("delete", url, undefined, options),
};

/* ------------------------------------------------------------------ conditional GET (ETag) */

export type EtagResult<T> = { notModified: true; etag: string | null } | { notModified: false; data: T; etag: string | null };

/** GET with `If-None-Match`; a `304` returns `{notModified: true}` so polling keeps its data. */
export async function getWithEtag<T>(url: string, etag?: string | null, options: { signal?: AbortSignal; params?: Record<string, unknown> } = {}): Promise<EtagResult<T>> {
  let response: AxiosResponse<T>;
  try {
    response = await http.get<T>(url, {
      params: options.params,
      signal: options.signal,
      headers: etag ? { "If-None-Match": etag } : undefined,
      validateStatus: (s) => (s >= 200 && s < 300) || s === 304 || STRUCTURED.has(s),
    });
  } catch (error) {
    throw toApiError(error);
  }
  const next = (response.headers?.etag as string | undefined) ?? etag ?? null;
  if (response.status === 304) return { notModified: true, etag: next };
  if (response.status >= 300) throw payrollError(response.status, response.data);
  return { notModified: false, data: response.data, etag: (response.headers?.etag as string | undefined) ?? null };
}

/* ------------------------------------------------------------------ jobs (GET /api/v1/jobs/{id}) */

export type JobStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "DEAD" | "CANCELLED";

export interface JobDto {
  id: number;
  type: string;
  status: JobStatus;
  progress: { done: number; total: number | null; percent: number | null };
  attempts: number;
  max_attempts: number;
  run_at: string | null;
  created_at: string;
  updated_at: string;
  finished: boolean;
  result: Record<string, unknown> | null;
  error: string | Record<string, unknown> | null;
}

export const jobUrl = (id: number | string) => `/jobs/${encodeURIComponent(String(id))}`;

/* ------------------------------------------------------------------ step-up endpoints */

export interface StepUpStatus {
  active: boolean;
  method: string | null;
  verified_at: string | null;
  expires_at: string | null;
  available_methods: ("TOTP" | "EMAIL_OTP" | string)[];
}

export const stepUpApi = {
  status: () => payrollApi.get<StepUpStatus>("/payroll/step-up", { stepUp: false }),
  emailCode: () => payrollApi.post<{ sent: boolean; expires_in_seconds: number }>("/payroll/step-up/email-code", {}, { stepUp: false }),
  verify: (code: string) =>
    payrollApi.post<{ method: string; verified_at: string; expires_at: string }>("/payroll/step-up", { code }, { stepUp: false }),
};
