/**
 * Browser location for attendance checks.
 *
 * Returns the browser's *estimate* (with its 95% accuracy radius) or the honest
 * reason there is none. A position is never invented, cached or reused: every
 * attempt asks for a fresh fix (high accuracy, maximumAge 0), retries a bounded
 * number of times while the reading is worse than the acceptable accuracy, and
 * keeps the most accurate fresh reading. Laptops without GPS usually estimate
 * from Wi-Fi or IP, which shows up as a large accuracy radius, not as a lie.
 */

export type AttemptStatus =
  | "CAPTURED"
  | "PERMISSION_DENIED"
  | "POSITION_UNAVAILABLE"
  | "TIMEOUT"
  | "INSECURE_CONTEXT"
  | "UNSUPPORTED"
  | "ERROR";

export interface LocationAttempt {
  status: AttemptStatus;
  latitude?: number;
  longitude?: number;
  accuracy_m?: number;
  captured_at?: string;
  attempts: number;
  error_message?: string;
}

export interface CaptureOptions {
  timeoutMs: number;
  maxAttempts: number;
  acceptableAccuracyM: number;
  maxFixAgeSeconds: number;
  /** Background checks must never pop a permission prompt; user actions may. */
  allowPrompt: boolean;
}

export type PermissionStatus = PermissionState | "unsupported" | "unknown";

export interface GeoEnv {
  isSecureContext: boolean;
  geolocation?: Pick<Geolocation, "getCurrentPosition">;
  permissions?: { query(descriptor: { name: "geolocation" }): Promise<{ state: PermissionState }> };
  now(): number;
}

export function browserEnv(): GeoEnv {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  return {
    isSecureContext: typeof window !== "undefined" && window.isSecureContext,
    geolocation: nav && "geolocation" in nav ? nav.geolocation : undefined,
    permissions: nav?.permissions as GeoEnv["permissions"],
    now: () => Date.now(),
  };
}

export async function permissionState(env: GeoEnv = browserEnv()): Promise<PermissionStatus> {
  if (!env.geolocation) return "unsupported";
  if (!env.permissions) return "unknown";
  try {
    return (await env.permissions.query({ name: "geolocation" })).state;
  } catch {
    return "unknown";
  }
}

const ERROR_STATUS: Record<number, AttemptStatus> = { 1: "PERMISSION_DENIED", 2: "POSITION_UNAVAILABLE", 3: "TIMEOUT" };

function fresh(geo: NonNullable<GeoEnv["geolocation"]>, timeoutMs: number, guardMs: number): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    // The spec's timeout only starts once permission is granted; the guard also covers an unanswered prompt.
    const guard = setTimeout(() => reject({ code: 3, message: "No answer from the location service" }), guardMs);
    geo.getCurrentPosition(
      (position) => {
        clearTimeout(guard);
        resolve(position);
      },
      (error) => {
        clearTimeout(guard);
        reject(error);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs },
    );
  });
}

function usable(position: GeolocationPosition, env: GeoEnv, maxAgeSeconds: number): boolean {
  const { latitude, longitude, accuracy } = position.coords;
  if (![latitude, longitude, accuracy].every(Number.isFinite)) return false;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || accuracy <= 0) return false;
  if (latitude === 0 && longitude === 0) return false; // a placeholder, not a reading
  const ageSeconds = (env.now() - position.timestamp) / 1000;
  return ageSeconds <= maxAgeSeconds && ageSeconds >= -5;
}

export async function captureLocation(options: CaptureOptions, env: GeoEnv = browserEnv()): Promise<LocationAttempt> {
  if (!env.isSecureContext) {
    return { status: "INSECURE_CONTEXT", attempts: 0, error_message: "Location needs a secure (HTTPS) connection" };
  }
  if (!env.geolocation) return { status: "UNSUPPORTED", attempts: 0, error_message: "This browser has no location support" };
  const permission = await permissionState(env);
  if (permission === "denied") {
    return { status: "PERMISSION_DENIED", attempts: 0, error_message: "Location permission is blocked for this site" };
  }
  if (permission === "prompt" && !options.allowPrompt) {
    return { status: "PERMISSION_DENIED", attempts: 0, error_message: "Location permission has not been granted yet" };
  }

  const guardMs = options.timeoutMs + (options.allowPrompt ? 60_000 : 5_000);
  let best: GeolocationPosition | null = null;
  let failure: { status: AttemptStatus; message: string } | null = null;
  let attempts = 0;
  for (let i = 0; i < Math.max(1, options.maxAttempts); i++) {
    attempts += 1;
    try {
      const position = await fresh(env.geolocation, options.timeoutMs, guardMs);
      if (!usable(position, env, options.maxFixAgeSeconds)) {
        failure = { status: "ERROR", message: "The browser returned an unusable or stale position" };
        continue;
      }
      if (!best || position.coords.accuracy < best.coords.accuracy) best = position;
      if (best.coords.accuracy <= options.acceptableAccuracyM) break;
    } catch (error) {
      const code = (error as { code?: number }).code ?? 0;
      const message = String((error as { message?: string }).message ?? "Location failed").slice(0, 200);
      failure = { status: ERROR_STATUS[code] ?? "ERROR", message };
      if (code === 1) break; // denied: retrying cannot help
    }
  }
  if (best) {
    return {
      status: "CAPTURED",
      latitude: best.coords.latitude,
      longitude: best.coords.longitude,
      accuracy_m: best.coords.accuracy,
      captured_at: new Date(best.timestamp).toISOString(),
      attempts,
    };
  }
  return { status: failure?.status ?? "ERROR", attempts, error_message: failure?.message };
}

/** Plain-language explanation for each outcome, shown to the employee. */
export function explainAttempt(attempt: Pick<LocationAttempt, "status" | "accuracy_m">, acceptableM: number): string {
  switch (attempt.status) {
    case "CAPTURED":
      return (attempt.accuracy_m ?? 0) > acceptableM
        ? `Location is approximate (about ±${Math.round(attempt.accuracy_m ?? 0)} m). Devices without GPS estimate it from Wi-Fi or IP.`
        : `Location found (±${Math.round(attempt.accuracy_m ?? 0)} m).`;
    case "PERMISSION_DENIED":
      return "Location permission is blocked. Allow location for this site (the icon left of the address bar), then try again.";
    case "TIMEOUT":
      return "No location fix arrived in time. Move near a window or outdoors and try again.";
    case "POSITION_UNAVAILABLE":
      return "Your device couldn't determine its location. Turn on location services (Windows: Settings › Privacy › Location) and try again.";
    case "INSECURE_CONTEXT":
      return "Location only works when the site is opened over HTTPS.";
    case "UNSUPPORTED":
      return "This browser doesn't support location.";
    default:
      return "The location check failed. Try again.";
  }
}
