import { http, toApiError } from "./api";

/** Retry once after refreshing the platform session (separate from company sessions). */
export async function platformCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (toApiError(e).status !== 401) throw e;
    await http.post("/platform/auth/refresh");
    return fn();
  }
}
