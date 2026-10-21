import axios, { AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from "axios";

/**
 * Browser API client.
 *
 * - Same-origin requests to /api/v1 (proxied to FastAPI by next.config.ts),
 *   so the HttpOnly session cookies are sent automatically.
 * - Adds the double-submit CSRF header on state-changing requests.
 * - On 401 it refreshes the session once (single flight) and retries.
 * - Tokens are never readable or stored by JavaScript.
 */

export interface ApiErrorBody {
  detail?: string | { field: string; msg: string }[];
  code?: string;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  fields?: { field: string; msg: string }[];

  constructor(status: number, message: string, code?: string, fields?: { field: string; msg: string }[]) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

const SAFE = new Set(["get", "head", "options"]);

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  return document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${name}=`))
    ?.split("=")[1];
}

export const http = axios.create({
  baseURL: "/api/v1",
  withCredentials: true,
  timeout: 30000,
});

http.interceptors.request.use((config) => {
  if (!SAFE.has((config.method || "get").toLowerCase())) {
    const csrf = readCookie("hrms_csrf");
    if (csrf) config.headers.set("X-CSRF-Token", decodeURIComponent(csrf));
  }
  return config;
});

let refreshing: Promise<boolean> | null = null;
type Listener = (event: "session-expired" | "subscription-inactive" | "suspended") => void;
const listeners = new Set<Listener>();

export function onSessionEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(event: Parameters<Listener>[0]) {
  listeners.forEach((l) => l(event));
}

async function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = axios
      .post("/api/v1/auth/refresh", {}, { withCredentials: true, headers: csrfHeader() })
      .then(() => true)
      .catch(() => false)
      .finally(() => {
        setTimeout(() => (refreshing = null), 0);
      });
  }
  return refreshing;
}

function csrfHeader(): Record<string, string> {
  const csrf = readCookie("hrms_csrf");
  return csrf ? { "X-CSRF-Token": decodeURIComponent(csrf) } : {};
}

// Platform operator calls use their own session and refresh endpoint.
const NO_REFRESH = ["/auth/login", "/auth/refresh", "/auth/signup", "/auth/logout", "/auth/login/mfa", "/platform"];

http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorBody>) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;
    const status = error.response?.status ?? 0;
    const body = error.response?.data;
    const isAuthCall = NO_REFRESH.some((p) => original?.url?.startsWith(p));

    if (status === 401 && original && !original._retried && !isAuthCall) {
      original._retried = true;
      if (await refreshSession()) return http(original);
      emit("session-expired");
    } else if (status === 402) {
      emit("subscription-inactive");
    } else if (status === 403 && body?.code === "COMPANY_SUSPENDED") {
      emit("suspended");
    }
    throw toApiError(error);
  },
);

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const axiosError = error as AxiosError<ApiErrorBody>;
  if (!axiosError.response) {
    return new ApiError(0, "We couldn't reach the server. Check your connection and try again.", "NETWORK");
  }
  const { status, data } = axiosError.response;
  if (Array.isArray(data?.detail)) {
    const fields = data!.detail as { field: string; msg: string }[];
    return new ApiError(status, fields.map((f) => f.msg).join(". "), data?.code, fields);
  }
  const fallback =
    status === 403
      ? "You don't have permission to do that."
      : status === 404
        ? "Not found."
        : status >= 500
          ? "Something went wrong. Please try again."
          : "Request failed.";
  // Payroll endpoints send structured details ({message, ...}); never show "[object Object]".
  const detail = data?.detail as unknown;
  const message =
    typeof detail === "string"
      ? detail
      : detail && typeof detail === "object" && typeof (detail as { message?: unknown }).message === "string"
        ? (detail as { message: string }).message
        : "";
  return new ApiError(status, message || fallback, data?.code);
}

export const api = {
  get: <T>(url: string, config?: AxiosRequestConfig) => http.get<T>(url, config).then((r) => r.data),
  post: <T>(url: string, body?: unknown, config?: AxiosRequestConfig) => http.post<T>(url, body, config).then((r) => r.data),
  put: <T>(url: string, body?: unknown, config?: AxiosRequestConfig) => http.put<T>(url, body, config).then((r) => r.data),
  patch: <T>(url: string, body?: unknown, config?: AxiosRequestConfig) => http.patch<T>(url, body, config).then((r) => r.data),
  delete: <T>(url: string, config?: AxiosRequestConfig) => http.delete<T>(url, config).then((r) => r.data),
};

/** Download an authorized file (exports, payslips) through the session. */
export async function downloadFile(url: string, fallbackName: string) {
  const response = await http.get(url, { responseType: "blob" });
  const disposition = response.headers["content-disposition"] as string | undefined;
  const match = disposition?.match(/filename="?([^";]+)"?/);
  const href = URL.createObjectURL(response.data as Blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = match?.[1] || fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

export function errorMessage(error: unknown): string {
  return toApiError(error).message;
}
