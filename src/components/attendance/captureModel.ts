/**
 * Pure helpers of capture v2 (AS-M2, G-06): labels, the employee-safe geofence wording, site geometry for the static
 * SVG preview, the capture policy form model and the kiosk ticket clock. No React, no network — Jest covers them.
 *
 * Privacy rule (07 §7, 09-ui-ux/02 §3.5 rule 3): an employee or lead sees the geofence *result* and a distance
 * *band* only; nothing here formats coordinates for a punch.
 */

/* ------------------------------------------------------------------ directions */

export type Direction = "IN" | "OUT" | "BREAK_START" | "BREAK_END";
export type LegacyAction = "PUNCH_IN" | "PUNCH_OUT" | "LUNCH_IN" | "LUNCH_OUT";

/** `my_today.actions` (legacy action names) → the explicit v2 directions of `POST /attendance/me/punch`. */
export const DIRECTION_OF: Record<LegacyAction, Direction> = {
  PUNCH_IN: "IN", PUNCH_OUT: "OUT", LUNCH_IN: "BREAK_START", LUNCH_OUT: "BREAK_END",
};

export const DIRECTION_LABEL: Record<Direction, string> = {
  IN: "Check in", OUT: "Check out", BREAK_START: "Start break", BREAK_END: "End break",
};

export const DIRECTION_DONE: Record<Direction, string> = {
  IN: "Checked in", OUT: "Checked out", BREAK_START: "Break started", BREAK_END: "Break ended",
};

/** The explicit directions offered for a set of legacy actions, in the order the server sent them. */
export function directionsFor(actions: readonly string[] | undefined): Direction[] {
  return (actions ?? []).map((a) => DIRECTION_OF[a as LegacyAction]).filter((d): d is Direction => !!d);
}

/* ------------------------------------------------------------------ geofence wording (employee-safe) */

export type GeofenceResult = "INSIDE" | "OUTSIDE" | "UNKNOWN" | "NOT_CHECKED";
export type DistanceBand = "INSIDE" | "WITHIN_250M" | "WITHIN_1KM" | "BEYOND_1KM" | "UNKNOWN";

export const RESULT_LABEL: Record<string, string> = {
  INSIDE: "At site", OUTSIDE: "Outside site", UNKNOWN: "Location not confirmed", NOT_CHECKED: "Not checked",
};

export const BAND_LABEL: Record<string, string> = {
  INSIDE: "Inside the site", WITHIN_250M: "Within 250 m", WITHIN_1KM: "Within 1 km", BEYOND_1KM: "Over 1 km away",
  UNKNOWN: "Distance unknown",
};

export type Tone = "success" | "warning" | "danger" | "neutral" | "info" | "primary";

export function resultTone(result: string | null | undefined): Tone {
  if (result === "INSIDE") return "success";
  if (result === "OUTSIDE") return "warning";
  if (result === "UNKNOWN") return "neutral";
  return "neutral";
}

/** "Outside site · Within 250 m of Bengaluru Office" — never a number of metres or a coordinate. */
export function geofenceText(check: { result?: string | null; label?: string | null; distance_band?: string | null;
  site_name?: string | null } | null | undefined): string | null {
  if (!check || !check.result || check.result === "NOT_CHECKED") return null;
  const label = check.label || RESULT_LABEL[check.result] || check.result;
  if (check.result === "INSIDE") return check.site_name ? `${label} · ${check.site_name}` : label;
  const band = check.distance_band && check.distance_band !== "UNKNOWN" ? BAND_LABEL[check.distance_band] : null;
  if (band && check.site_name) return `${label} · ${band} of ${check.site_name}`;
  if (band) return `${label} · ${band}`;
  return check.site_name ? `${label} · ${check.site_name}` : label;
}

export const FLAG_LABEL: Record<string, string> = {
  OUTSIDE_GEOFENCE: "Outside the site", LOW_ACCURACY: "Approximate location", IP_NOT_ALLOWED: "Outside the office network",
  QR_INVALID: "QR code not recognised", OTHER_BRANCH_KIOSK: "Kiosk of another branch",
};

/* ------------------------------------------------------------------ consents and privacy */

export const PURPOSE_LABEL: Record<string, string> = {
  BIOMETRIC_FACE: "Face match", BIOMETRIC_DEVICE: "Fingerprint or face on a terminal", PUNCH_PHOTO: "Photo at punch",
  LOCATION_AT_PUNCH: "Location when you punch", LOCATION_TRACKING: "Location during your shift",
  NIGHT_WORK: "Night work", OVERTIME: "Overtime", COMPRESSED_WEEK: "Compressed week",
  REST_WAIVER: "Shorter rest between shifts", SCHEDULE_CHANGE_ACCEPTED: "Late schedule changes",
  WEEKLY_HOURS_OPT_OUT: "Weekly hours opt-out",
};

export const CONSENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  GRANTED: { label: "Granted", tone: "success" },
  DECLINED: { label: "Declined", tone: "neutral" },
  WITHDRAWN: { label: "Withdrawn", tone: "warning" },
  EXPIRED: { label: "Expired", tone: "neutral" },
};

export const LEGAL_BASIS_LABEL: Record<string, string> = {
  CONSENT: "Your consent", EMPLOYMENT_LEGITIMATE_USE: "Employment (legitimate use)", LEGAL_OBLIGATION: "Legal obligation",
  CONTRACT: "Your contract",
};

export const CHANNEL_LABEL: Record<string, string> = { SELF_SERVICE: "You", HR_RECORDED: "Recorded by HR" };

/* ------------------------------------------------------------------ review queue */

export const REVIEW_KIND_LABEL: Record<string, string> = {
  LOCATION_EXCEPTION: "Location exception", MOVEMENT: "Movement", OUTSIDE_GEOFENCE: "Outside geofence",
  LOW_ACCURACY: "Low accuracy", MOCK_LOCATION: "Simulated location", IP_NOT_ALLOWED: "Outside office network",
  FACE_MISMATCH: "Face mismatch", IMPOSSIBLE_TRAVEL: "Impossible travel", UNMAPPED_PUNCH: "Unmapped punch",
  ORPHAN_PUNCH: "Orphan punch", DEVICE_CLOCK_SKEW: "Device clock skew", DEVICE_OFFLINE: "Device offline",
  SESSION_OVERLAP_LEGACY: "Overlapping sessions (legacy)", CONTRACTOR_HEADCOUNT_OVER_LICENCE: "Contractors over licence",
  CONTRACTOR_LICENCE_EXPIRED: "Contractor licence expired", QR_INVALID: "QR not recognised",
  KIOSK_OFF_SITE: "Kiosk off site", DEVICE_ZONE_SUSPECT: "Device time zone suspect", STRAY_PUNCH: "Stray punch",
  PUNCH_OUTSIDE_EMPLOYMENT: "Punch outside employment", AMBIGUOUS_LOCAL_TIME: "Ambiguous local time",
  LICENCE_NOT_RECORDED: "Licence not recorded", RULE_MEMBER_GAP: "Rule member gap",
};

/** Location kinds need `location:review`; the others `attendance:review` (spine §4.10). */
export const LOCATION_REVIEW_KINDS = ["LOCATION_EXCEPTION", "MOVEMENT", "OUTSIDE_GEOFENCE", "LOW_ACCURACY", "MOCK_LOCATION",
  "IMPOSSIBLE_TRAVEL"] as const;

export const SEVERITY: Record<string, { label: string; tone: Tone; rank: number }> = {
  HIGH: { label: "High", tone: "danger", rank: 3 },
  WARNING: { label: "Warning", tone: "warning", rank: 2 },
  INFO: { label: "Info", tone: "info", rank: 1 },
};

export const REVIEW_STATUS: Record<string, { label: string; tone: Tone }> = {
  OPEN: { label: "Open", tone: "warning" },
  ACKNOWLEDGED: { label: "Acknowledged", tone: "info" },
  APPROVED: { label: "Approved", tone: "success" },
  REJECTED: { label: "Rejected", tone: "danger" },
  RESOLVED: { label: "Resolved", tone: "success" },
};

export const DECISION_LABEL: Record<string, string> = {
  APPROVED: "Approve", REJECTED: "Reject", ACKNOWLEDGED: "Acknowledge", RESOLVED: "Resolve",
};

/** Age of an item in words ("2 h", "3 d"), from the server timestamp. */
export function ageText(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "—";
  const ms = Math.max(0, now - new Date(iso).getTime());
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

/* ------------------------------------------------------------------ sites */

export const SITE_KINDS = ["OFFICE", "PLANT", "STORE", "CLINIC", "WAREHOUSE", "CLIENT_SITE", "PROJECT_SITE", "OTHER"] as const;
export type SiteKind = (typeof SITE_KINDS)[number];
export const SITE_KIND_LABEL: Record<string, string> = {
  OFFICE: "Office", PLANT: "Plant", STORE: "Store", CLINIC: "Clinic", WAREHOUSE: "Warehouse", CLIENT_SITE: "Client site",
  PROJECT_SITE: "Project site", OTHER: "Other",
};
export type Geometry = "CIRCLE" | "POLYGON" | "NONE";

/** `attendance.geofence.min_radius_m` (FU-AS-20: a backend constant until the Attendance settings section ships). */
export const MIN_RADIUS_M = 100;

export function geometryText(site: { geometry_type: string; radius_m?: number | null; polygon?: number[][] | null }): string {
  if (site.geometry_type === "CIRCLE") return `Circle ${site.radius_m ?? "?"} m`;
  if (site.geometry_type === "POLYGON") return `Polygon · ${(site.polygon ?? []).length} points`;
  return "No area";
}

/** Textarea → CIDR list (one per line or comma separated; blanks dropped). The server validates and normalises. */
export function parseRanges(text: string): string[] {
  return text.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
}

/** "lat, lng" per line → [[lat, lng], …]; throws a readable message on a bad line. */
export function parsePolygon(text: string): number[][] {
  const points: number[][] = [];
  for (const [index, raw] of text.split(/\n+/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/[\s,;]+/).filter(Boolean).map(Number);
    if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) {
      throw new Error(`Line ${index + 1}: write "latitude, longitude".`);
    }
    const [lat, lng] = parts;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error(`Line ${index + 1}: outside the valid range.`);
    points.push([lat, lng]);
  }
  return points;
}

export function polygonText(points: number[][] | null | undefined): string {
  return (points ?? []).map((p) => `${p[0]}, ${p[1]}`).join("\n");
}

const EARTH_M = 6_371_008.8;

/** Great-circle distance in metres (the backend's `geo.distance_m`). */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** A point `metres` north (+) / east (+) of an origin (the Chrome spec uses it to stand 164 m from a centre). */
export function offsetPoint(lat: number, lng: number, northM: number, eastM = 0): { lat: number; lng: number } {
  const dLat = northM / 111_320;
  const dLng = eastM / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lng: lng + dLng };
}

export interface PlotShape {
  /** SVG path or circle in a square viewBox of `size`. */
  kind: "circle" | "polygon" | "none";
  cx?: number;
  cy?: number;
  r?: number;
  points?: string;
  /** Half-width of the drawing in metres (for the scale caption). */
  extentM: number;
}

/**
 * Local east/north projection of a site into an SVG box (the `LocationPlot` pattern): circle centre in the middle,
 * polygon around its centroid. No map tiles, no coordinates printed.
 */
export function plotSite(site: { geometry_type: string; center_lat?: number | null; center_lng?: number | null;
  radius_m?: number | null; polygon?: number[][] | null }, size = 220): PlotShape {
  const mid = size / 2;
  if (site.geometry_type === "CIRCLE" && site.radius_m && site.radius_m > 0) {
    const extent = site.radius_m * 1.6;
    const scale = (mid - 8) / extent;
    return { kind: "circle", cx: mid, cy: mid, r: site.radius_m * scale, extentM: Math.round(extent) };
  }
  const ring = site.polygon ?? [];
  if (site.geometry_type === "POLYGON" && ring.length >= 3) {
    const lat0 = ring.reduce((s, p) => s + p[0], 0) / ring.length;
    const lng0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const cos = Math.cos((lat0 * Math.PI) / 180);
    const xy = ring.map((p) => ({ x: (p[1] - lng0) * 111_320 * cos, y: (p[0] - lat0) * 110_574 }));
    const extent = Math.max(30, ...xy.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y)))) * 1.25;
    const scale = (mid - 8) / extent;
    const points = xy.map((p) => `${(mid + p.x * scale).toFixed(1)},${(mid - p.y * scale).toFixed(1)}`).join(" ");
    return { kind: "polygon", points, extentM: Math.round(extent) };
  }
  return { kind: "none", extentM: 0 };
}

/* ------------------------------------------------------------------ capture policy (ATTENDANCE_CAPTURE_POLICY) */

export const CAPTURE_TYPE = "ATTENDANCE_CAPTURE_POLICY";
export const SOURCE_CHOICES = ["WEB", "MOBILE", "KIOSK"] as const;
export const SOURCE_LABEL: Record<string, string> = {
  WEB: "Web browser", MOBILE: "Phone (punch app)", KIOSK: "Kiosk", DEVICE: "Terminal", IMPORT: "Import", SUPERVISOR: "Supervisor",
};
export const KIOSK_METHODS = ["PIN", "QR", "CARD", "FACE"] as const;
export const KIOSK_METHOD_LABEL: Record<string, string> = { PIN: "PIN", QR: "QR badge", CARD: "Card", FACE: "Face" };
export const GEOFENCE_MODES = ["OFF", "FLAG", "REQUIRE_REASON", "BLOCK"] as const;
export const GEOFENCE_LABEL: Record<string, string> = {
  OFF: "Off", FLAG: "Flag for review", REQUIRE_REASON: "Ask for a reason", BLOCK: "Block",
};
export const LOCATION_MODES = ["OFF", "OPTIONAL", "REQUIRED"] as const;
export const LOCATION_LABEL: Record<string, string> = { OFF: "Off", OPTIONAL: "Optional", REQUIRED: "Required" };
export const IP_MODES = ["OFF", "FLAG", "BLOCK"] as const;
export const QR_MODES = ["OFF", "REQUIRED"] as const;

/** The editable subset of a capture version; every other field of the version is kept as it was. */
export interface CaptureForm {
  allowed_sources: string[];
  kiosk_methods: string[];
  location_mode: string;
  location_failure_action: string;
  geofence_mode: string;
  allowed_site_ids: number[];
  ip_mode: string;
  qr_mode: string;
  face_on_punch: boolean;
  face_on_break: boolean;
  dpia_reference: string;
  capture_required: boolean;
}

export const DEFAULT_FORM: CaptureForm = {
  allowed_sources: ["WEB", "MOBILE"], kiosk_methods: ["PIN"], location_mode: "OFF",
  location_failure_action: "ALLOW_WITH_REASON", geofence_mode: "OFF", allowed_site_ids: [], ip_mode: "OFF",
  qr_mode: "OFF", face_on_punch: false, face_on_break: false, dpia_reference: "", capture_required: true,
};

export function formFromFields(fields: Record<string, unknown> | null | undefined): CaptureForm {
  const f = fields ?? {};
  const list = (v: unknown, fallback: string[]) => (Array.isArray(v) && v.length ? v.map(String) : fallback);
  return {
    allowed_sources: list(f.allowed_sources, DEFAULT_FORM.allowed_sources),
    kiosk_methods: list(f.kiosk_methods, DEFAULT_FORM.kiosk_methods),
    location_mode: String(f.location_mode ?? "OFF"),
    location_failure_action: String(f.location_failure_action ?? "ALLOW_WITH_REASON"),
    geofence_mode: String(f.geofence_mode ?? "OFF"),
    allowed_site_ids: Array.isArray(f.allowed_site_ids) ? f.allowed_site_ids.map(Number) : [],
    ip_mode: String(f.ip_mode ?? "OFF"),
    qr_mode: String(f.qr_mode ?? "OFF"),
    face_on_punch: Boolean(f.face_on_punch),
    face_on_break: Boolean(f.face_on_break),
    dpia_reference: typeof f.dpia_reference === "string" ? f.dpia_reference : "",
    capture_required: f.capture_required === undefined ? true : Boolean(f.capture_required),
  };
}

/** Merge the form into the version's fields (profile is always STANDARD on save; the server enforces it too). */
export function fieldsFromForm(form: CaptureForm, base: Record<string, unknown> = {}): Record<string, unknown> {
  const { profile: _profile, ...rest } = base as Record<string, unknown> & { profile?: unknown };
  void _profile;
  return {
    ...rest,
    allowed_sources: form.allowed_sources,
    kiosk_methods: form.kiosk_methods,
    location_mode: form.location_mode,
    location_failure_action: form.location_failure_action,
    geofence_mode: form.geofence_mode,
    allowed_site_ids: form.allowed_site_ids.length ? form.allowed_site_ids : null,
    ip_mode: form.ip_mode,
    qr_mode: form.qr_mode,
    face_on_punch: form.face_on_punch,
    face_on_break: form.face_on_break,
    dpia_reference: form.dpia_reference.trim() || null,
    capture_required: form.capture_required,
  };
}

/** Client checks that mirror the type's field rules (IG-AS-57), so the editor explains before it saves. */
export function formProblems(form: CaptureForm): { field: keyof CaptureForm; message: string }[] {
  const problems: { field: keyof CaptureForm; message: string }[] = [];
  if (!form.allowed_sources.length) problems.push({ field: "allowed_sources", message: "Choose at least one source." });
  if (!form.kiosk_methods.length) problems.push({ field: "kiosk_methods", message: "Choose at least one kiosk method." });
  const face = form.face_on_punch || form.face_on_break || form.kiosk_methods.includes("FACE");
  if (face && !form.dpia_reference.trim()) {
    problems.push({ field: "dpia_reference", message: "Enter the privacy impact assessment reference to use face matching." });
  }
  if ((form.geofence_mode === "REQUIRE_REASON" || form.geofence_mode === "BLOCK") && form.location_mode !== "REQUIRED") {
    problems.push({ field: "location_mode", message: "A geofence that asks for a reason or blocks needs location required." });
  }
  return problems;
}

/** One-line summary of a version for the policy card. */
export function captureSummary(fields: Record<string, unknown> | null | undefined): string {
  const f = formFromFields(fields);
  const parts = [f.allowed_sources.map((s) => SOURCE_LABEL[s] ?? s).join(" · ")];
  if (f.location_mode !== "OFF") parts.push(`location ${LOCATION_LABEL[f.location_mode].toLowerCase()}`);
  if (f.geofence_mode !== "OFF") parts.push(`geofence: ${GEOFENCE_LABEL[f.geofence_mode].toLowerCase()}`);
  if (f.ip_mode !== "OFF") parts.push(`network ${f.ip_mode.toLowerCase()}`);
  if (f.qr_mode !== "OFF") parts.push("QR required");
  if (f.face_on_punch) parts.push("face at punch");
  return parts.join(" · ");
}

/** Assignment criteria in words. */
export function criteriaText(criteria: Record<string, unknown> | null | undefined,
  names: { branch?: (id: number) => string | undefined; employee?: (id: number) => string | undefined } = {}): string {
  const c = criteria ?? {};
  if (c.everyone) return "Everyone";
  const parts: string[] = [];
  const ids = (key: string) => (Array.isArray(c[key]) ? (c[key] as unknown[]).map(Number) : []);
  if (ids("branch_ids").length) parts.push(`Branches: ${ids("branch_ids").map((id) => names.branch?.(id) ?? `#${id}`).join(", ")}`);
  if (ids("legal_entity_ids").length) parts.push(`Entities: ${ids("legal_entity_ids").map((id) => `#${id}`).join(", ")}`);
  if (ids("department_ids").length) parts.push(`Departments: ${ids("department_ids").length}`);
  if (ids("employee_ids").length) parts.push(`People: ${ids("employee_ids").map((id) => names.employee?.(id) ?? `#${id}`).join(", ")}`);
  return parts.join(" · ") || "No one";
}

/* ------------------------------------------------------------------ kiosk */

/** Whole seconds left on a kiosk ticket (0 when expired or unparsable); `skewMs` = server − device clock. */
export function secondsLeft(expiresAt: string | null | undefined, now: number = Date.now(), skewMs = 0): number {
  if (!expiresAt) return 0;
  const end = new Date(expiresAt).getTime();
  if (!Number.isFinite(end)) return 0;
  return Math.max(0, Math.ceil((end - (now + skewMs)) / 1000));
}

/** The first name the kiosk greets (the identified person sees only that, 09-ui-ux/02 §13). */
export function firstName(displayName: string | null | undefined): string {
  return (displayName ?? "").trim().split(/\s+/)[0] || "there";
}

/** Kiosk error codes → the screen copy of 09-ui-ux/02 §13. `null` = show the server message. */
export function kioskErrorText(code: string | undefined, status: number): string | null {
  if (code === "KIOSK_METHOD_NOT_ALLOWED") return "This kiosk doesn't accept that method.";
  if (code === "KIOSK_TICKET_EXPIRED" || status === 410) return "Took too long — please identify again.";
  if (code === "DEVICE_SUSPENDED" || code === "DEVICE_AUTH_FAILED") return "This kiosk is not active. Ask your administrator.";
  if (code === "RATE_LIMITED" || status === 429) return "Please wait a moment.";
  if (status === 0) return "No connection — punches are not recorded. Use another way to record your attendance.";
  return null;
}

/** Whether an error means the kiosk itself is unusable (full-screen "not active"). */
export function kioskInactive(code: string | undefined, status: number): boolean {
  return code === "DEVICE_SUSPENDED" || code === "DEVICE_AUTH_FAILED" || status === 401;
}

export const DEVICE_STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING_ACTIVATION: { label: "Waiting for pairing", tone: "warning" },
  ACTIVE: { label: "Active", tone: "success" },
  SUSPENDED: { label: "Suspended", tone: "danger" },
  RETIRED: { label: "Retired", tone: "neutral" },
};
