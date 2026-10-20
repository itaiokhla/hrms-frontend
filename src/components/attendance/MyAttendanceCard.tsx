"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  CalendarCheck2,
  Coffee,
  Crosshair,
  LocateFixed,
  LogIn,
  LogOut,
  MapPin,
  MapPinOff,
  Moon,
  PauseCircle,
  RefreshCw,
  ScanFace,
  ShieldCheck,
  Utensils,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";

import { CameraCapture, type CameraHandle } from "@/components/shared/CameraCapture";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { LiveClock } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Badge, Card } from "@/components/ui/primitives";
import { toApiError } from "@/lib/api";
import {
  ACTION_LABELS,
  type ActionMeta,
  faceRequiredFor,
  liveHours,
  locationModeFor,
  newKey,
  noticeRequired,
  sendAction,
} from "@/lib/attendance";
import { cn } from "@/lib/cn";
import { captureLocation, explainAttempt, type LocationAttempt, permissionState, type PermissionStatus } from "@/lib/geolocation";
import { fmtClock, fmtDate, fmtHours, fmtMeters, fmtTime } from "@/lib/format";
import type { AttendanceAction, MyAttendance, TrackingStatus } from "@/lib/types";
import { useSession } from "@/store/session";
import { useTracking } from "@/store/tracking";

const ACTION_ICONS: Record<AttendanceAction, typeof LogIn> = {
  PUNCH_IN: LogIn,
  LUNCH_IN: Utensils,
  LUNCH_OUT: Coffee,
  PUNCH_OUT: LogOut,
};

const DONE_TOASTS: Record<AttendanceAction, string> = {
  PUNCH_IN: "Punched in. Have a great day!",
  LUNCH_IN: "Lunch started. Enjoy your break!",
  LUNCH_OUT: "Lunch ended. Welcome back!",
  PUNCH_OUT: "Punched out. See you tomorrow!",
};

function useTicker(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export function usePermission(): PermissionStatus {
  const [state, setState] = useState<PermissionStatus>("unknown");
  useEffect(() => {
    let alive = true;
    let status: PermissionStatus_ | null = null;
    const refresh = () => void permissionState().then((s) => alive && setState(s));
    refresh();
    navigator.permissions
      ?.query({ name: "geolocation" })
      .then((s) => {
        status = s;
        s.addEventListener("change", refresh);
      })
      .catch(() => undefined);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      alive = false;
      status?.removeEventListener("change", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return state;
}
type PermissionStatus_ = globalThis.PermissionStatus;

/* ===================================================================== Card */
export function MyAttendanceCard({ data, onChange, onReload }: {
  data: MyAttendance | undefined;
  onChange: (next: MyAttendance) => void;
  onReload: () => void;
}) {
  const [dialog, setDialog] = useState<AttendanceAction | null>(null);
  const [busy, setBusy] = useState<AttendanceAction | null>(null);
  const received = useRef<{ data?: MyAttendance; at: number }>({ at: Date.now() });
  if (received.current.data !== data) received.current = { data, at: Date.now() };
  const live = data?.attendance_state === "WORKING" || data?.attendance_state === "ON_LUNCH";
  const now = useTicker(live);
  const bridge = useTracking((s) => s.bridge);

  const applyResult = useCallback(
    (next: MyAttendance, action: AttendanceAction) => {
      onChange(next);
      toast.success(DONE_TOASTS[action]);
      bridge?.ingest(next.tracking);
      bridge?.requestSync();
    },
    [onChange, bridge],
  );

  const start = async (action: AttendanceAction) => {
    if (!data) return;
    const policy = data.policy;
    const needsDialog =
      faceRequiredFor(policy, action) ||
      locationModeFor(policy, action) !== "OFF" ||
      (action === "PUNCH_IN" && noticeRequired(policy)) ||
      (action === "PUNCH_OUT" && data.attendance_state === "ON_LUNCH");
    if (needsDialog) {
      setDialog(action);
      return;
    }
    setBusy(action);
    try {
      applyResult(await sendAction(action, { idempotency_key: newKey(), attendance_id: data.record?.id }), action);
    } catch (e) {
      const err = toApiError(e);
      if (err.code === "FACE_REQUIRED" || err.code === "LUNCH_OPEN_CONFIRM" || err.code?.startsWith("LOCATION_")) setDialog(action);
      else {
        toast.error(err.message);
        if (err.status === 409) onReload(); // another tab or device changed the state
      }
    } finally {
      setBusy(null);
    }
  };

  if (!data) {
    return <Card className="h-[420px] animate-pulse" aria-busy="true" />;
  }
  const record = data.record;
  const state = data.attendance_state;
  const hours = record ? liveHours(record.hours, state, data.policy.lunch_is_paid, (now - received.current.at) / 1000) : null;
  const openBreak = record?.breaks.find((b) => !b.ended_at);

  return (
    <Card className="overflow-hidden" data-testid="attendance-card" data-state={state}>
      <div className="relative overflow-hidden bg-gradient-to-br from-primary via-primary to-accent p-6 text-primary-foreground">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
        <p className="text-sm opacity-90">{fmtDate(new Date().toISOString(), "EEEE, d MMMM")}</p>
        <LiveClock className="mt-1 block font-display text-4xl font-semibold" />
        <AnimatePresence mode="wait">
          <motion.p key={state} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="mt-3 flex items-center gap-2 text-sm" role="status" aria-live="polite">
            {state === "NOT_PUNCHED_IN" && "You haven't punched in yet."}
            {state === "WORKING" && <>Working since {fmtTime(record?.check_in_time)}{data.overnight && <Badge className="bg-white/20 text-white"><Moon className="h-3 w-3" /> overnight</Badge>}</>}
            {state === "ON_LUNCH" && <>On lunch since {fmtTime(openBreak?.started_at)}</>}
            {state === "PUNCHED_OUT" && (record?.closed_reason === "MISSING_PUNCH_OUT"
              ? "Shift closed without a punch-out. Ask HR to correct it."
              : "Day complete.")}
          </motion.p>
        </AnimatePresence>
      </div>

      <div className="space-y-4 p-6">
        {record && hours && (
          <div className="grid grid-cols-3 gap-2 text-center" aria-label="Working time">
            <Counter label="Worked (net)" value={hours.complete ? fmtClock(hours.net) : "—"} highlight testId="net" />
            <Counter label="Lunch" value={fmtClock(hours.lunch)} testId="lunch" />
            <Counter label="Total (gross)" value={hours.complete ? fmtClock(hours.gross) : "—"} testId="gross" />
            {hours.provisional && (
              <p className="col-span-3 text-[11px] text-muted-foreground">Live, provisional until you punch out. Net time excludes unpaid lunch.</p>
            )}
          </div>
        )}
        {!record && data.last_session && (
          <p className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
            Last shift {fmtTime(data.last_session.check_in_time)}–{fmtTime(data.last_session.check_out_time)} · {fmtHours(data.last_session.hours.net_seconds)} worked
          </p>
        )}

        <div className="flex flex-col gap-2">
          {data.actions.map((action) => {
            const Icon = ACTION_ICONS[action];
            const primary = action === "PUNCH_IN" || action === "LUNCH_OUT";
            return (
              <Button key={action} size="lg" variant={primary ? "primary" : "secondary"} className="w-full"
                loading={busy === action} disabled={!!busy} onClick={() => start(action)}>
                <Icon className="h-4 w-4" /> {ACTION_LABELS[action]}
              </Button>
            );
          })}
          {state === "PUNCHED_OUT" && record?.closed_reason !== "MISSING_PUNCH_OUT" && (
            <div className="flex items-center gap-3 rounded-xl bg-success-soft px-4 py-3 text-sm text-success">
              <CalendarCheck2 className="h-5 w-5" /> Attendance recorded for today.
            </div>
          )}
        </div>

        {record && (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-muted p-3"><p className="text-xs text-muted-foreground">Punch in</p><p className="font-semibold">{fmtTime(record.check_in_time)}</p></div>
            <div className="rounded-xl bg-muted p-3"><p className="text-xs text-muted-foreground">Punch out</p><p className="font-semibold">{record.check_out_time ? fmtTime(record.check_out_time) : "—"}</p></div>
          </div>
        )}

        <LocationPanel data={data} />
        {data.policy.require_face && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><ScanFace className="h-3.5 w-3.5" /> Your face is verified against your own profile on the server.</p>
        )}
      </div>

      {dialog && (
        <ActionDialog action={dialog} data={data} onClose={() => setDialog(null)}
          onDone={(next) => { setDialog(null); applyResult(next, dialog); }}
          onStale={(message) => { setDialog(null); toast.error(message); onReload(); }} />
      )}
    </Card>
  );
}

function Counter({ label, value, highlight, testId }: { label: string; value: string; highlight?: boolean; testId: string }) {
  return (
    <div className={cn("rounded-xl p-3", highlight ? "bg-primary-soft text-primary" : "bg-muted")}>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="font-display text-lg font-semibold tabular-nums" data-testid={`counter-${testId}`}>{value}</p>
    </div>
  );
}

/* =========================================================== Location panel */
const STOP_REASONS: Record<string, string> = {
  PUNCHED_OUT: "stopped at punch-out",
  POLICY_DISABLED: "turned off by your company",
  SHIFT_EXPIRED: "stopped: the shift exceeded the company's limit",
  ACCOUNT_SUSPENDED: "stopped: account suspended",
  PERMISSION_REVOKED: "stopped: attendance access removed",
  EMPLOYMENT_ENDED: "stopped: employment ended",
  CORRECTED: "stopped by an HR correction",
};

function LocationPanel({ data }: { data: MyAttendance }) {
  const policy = data.policy;
  const live = useTracking((s) => s.status);
  const phase = useTracking((s) => s.phase);
  const trackerError = useTracking((s) => s.error);
  const bridge = useTracking((s) => s.bridge);
  const permission = usePermission();
  const status: TrackingStatus = live && live.attendance_id === data.tracking.attendance_id ? live : data.tracking;
  const collects = noticeRequired(policy) || policy.location.lunch !== "OFF";
  if (!collects) return null;
  const last = status.last_capture;
  const missed = status.missed_count + status.pending_missed;

  let headline: { icon: typeof MapPin; text: string; tone: "success" | "warning" | "neutral" | "danger" };
  if (status.state === "ACTIVE" && status.schedule_state === "OVERDUE") {
    headline = { icon: AlertTriangle, text: "Location check overdue — taking a current reading", tone: "warning" };
  } else if (status.state === "ACTIVE" && status.schedule_state === "DUE") {
    headline = { icon: Crosshair, text: "Location check due now", tone: "warning" };
  } else if (status.state === "ACTIVE") {
    headline = { icon: MapPin, text: `Next location check about ${fmtTime(status.next_due_at)}`, tone: "success" };
  } else if (status.state === "PAUSED") {
    headline = { icon: PauseCircle, text: "Location checks paused during lunch", tone: "neutral" };
  } else if (status.state === "STOPPED") {
    headline = { icon: MapPinOff, text: `Location checks ${STOP_REASONS[status.stop_reason ?? ""] ?? "stopped"}`, tone: "neutral" };
  } else {
    headline = { icon: MapPin, text: policy.tracking.enabled ? "Location checks start when you punch in" : "Location is checked at attendance actions only", tone: "neutral" };
  }
  const tones = { success: "text-success", warning: "text-warning", neutral: "text-muted-foreground", danger: "text-danger" };
  const Icon = headline.icon;

  return (
    <div className="space-y-2 rounded-xl border border-border p-3 text-sm" data-testid="location-panel" data-tracking={status.state}
      data-schedule={status.schedule_state ?? ""}>
      <p className={cn("flex items-center gap-2 font-medium", tones[headline.tone])}>
        <Icon className="h-4 w-4 shrink-0" /> <span data-testid="tracking-headline">{headline.text}</span>
        {phase !== "idle" && <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-label="Checking location" />}
      </p>
      <p className="text-xs text-muted-foreground" data-testid="last-location">
        {last
          ? `Last reading ${fmtTime(last.received_at)} · ±${fmtMeters(last.accuracy_m)}${last.accuracy_class === "LOW" ? " (approximate)" : ""}`
          : "No location recorded for this shift yet."}
      </p>
      {missed > 0 && (
        <p className="text-xs text-warning" data-testid="missed-count">
          {missed} scheduled check{missed === 1 ? "" : "s"} missed (the page was closed, asleep or offline). Missed checks are recorded, never filled in.
        </p>
      )}
      {permission === "denied" && (
        <p className="text-xs text-danger" role="alert">Location is blocked for this site. Allow it in your browser's site settings to record locations.</p>
      )}
      {permission === "prompt" && status.state === "ACTIVE" && (
        <Button size="sm" variant="subtle" onClick={() => void bridge?.captureNow()}>
          <LocateFixed className="h-4 w-4" /> Allow location
        </Button>
      )}
      {trackerError && <p className="text-xs text-warning">{trackerError.message}</p>}
      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {policy.tracking.enabled
          ? `While punched in, your browser's estimated location is checked about every ${policy.tracking.interval_minutes} min${policy.tracking.pause_on_lunch ? " (paused at lunch)" : ""} and only while this site is open. `
          : ""}
        Readings are estimates with an accuracy radius, kept {policy.location.retention_days} days, visible to you and authorised managers/HR.
      </p>
    </div>
  );
}

/* ============================================================ Action dialog */
function ActionDialog({ action, data, onClose, onDone, onStale }: {
  action: AttendanceAction;
  data: MyAttendance;
  onClose: () => void;
  onDone: (next: MyAttendance) => void;
  onStale: (message: string) => void;
}) {
  const me = useSession((s) => s.me);
  const policy = data.policy;
  const face = faceRequiredFor(policy, action);
  const mode = locationModeFor(policy, action);
  const noticeKey = `hrms-location-notice-${me?.company.id}`;
  const needsNotice = action === "PUNCH_IN" && noticeRequired(policy);
  const onLunch = action === "PUNCH_OUT" && data.attendance_state === "ON_LUNCH";
  const intent = useMemo(newKey, []); // one id for this intent: retries reuse it
  const cam = useRef<CameraHandle>(null);
  const [consent, setConsent] = useState(() => {
    try {
      return localStorage.getItem(noticeKey) === "1";
    } catch {
      return false;
    }
  });
  const [confirmLunch, setConfirmLunch] = useState(false);
  const [attempt, setAttempt] = useState<LocationAttempt | null>(null);
  const [locating, setLocating] = useState(false);
  const [useException, setUseException] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const exceptionAllowed = mode === "REQUIRED" && policy.location.exception === "ALLOW_WITH_REASON";

  const locate = useCallback(async () => {
    if (mode === "OFF") return null;
    setLocating(true);
    setError(null);
    try {
      const result = await captureLocation({
        timeoutMs: policy.location.timeout_ms,
        maxAttempts: policy.location.max_attempts,
        acceptableAccuracyM: policy.location.acceptable_accuracy_m,
        maxFixAgeSeconds: policy.location.max_fix_age_seconds,
        allowPrompt: true,
      });
      setAttempt(result);
      return result;
    } finally {
      setLocating(false);
    }
  }, [mode, policy]);

  useEffect(() => {
    void locate(); // starts with the dialog, in parallel with the camera warming up
  }, [locate]);

  const failed = attempt !== null && attempt.status !== "CAPTURED";
  const lowAccuracy = attempt?.status === "CAPTURED" && (attempt.accuracy_m ?? 0) > policy.location.acceptable_accuracy_m;
  const blockedByLocation = mode === "REQUIRED" && (locating || failed || (lowAccuracy && policy.location.reject_low_accuracy)) && !useException;
  const canSubmit = !busy && (!needsNotice || consent) && (!onLunch || confirmLunch) && !blockedByLocation
    && (!useException || reason.trim().length >= 5) && !(mode !== "OFF" && locating);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      let image: Blob | null = null;
      if (face) {
        image = (await cam.current?.capture()) ?? null;
        if (!image) {
          setError("Couldn't capture from the camera. Try again.");
          return;
        }
      }
      const meta: ActionMeta = { idempotency_key: intent };
      if (action !== "PUNCH_IN" && data.record) meta.attendance_id = data.record.id;
      if (mode !== "OFF" && attempt) meta.location = attempt;
      if (needsNotice) meta.location_consent = consent;
      if (useException) meta.exception_reason = reason.trim();
      if (onLunch) meta.confirm_close_lunch = confirmLunch;
      const next = await sendAction(action, meta, image);
      if (needsNotice && consent) {
        try {
          localStorage.setItem(noticeKey, "1");
        } catch {
          /* private mode: ask again next time */
        }
      }
      onDone(next);
    } catch (e) {
      const err = toApiError(e);
      if (err.code === "LOCATION_STALE") {
        setError("That location reading is too old. Taking a fresh one…");
        await locate();
      } else if (err.status === 0) {
        setError("You're offline. Reconnect and press the button again — nothing was recorded twice.");
      } else if (err.status === 409 && !["LUNCH_OPEN_CONFIRM", "LUNCH_OPEN"].includes(err.code ?? "")) {
        onStale(err.message);
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const title = face ? "Verify it's you" : ACTION_LABELS[action];
  return (
    <Modal open onOpenChange={(open) => !open && onClose()} title={title} size={face ? "md" : "sm"}
      description={face ? "Look at the camera. We compare this capture with your enrolled face only." : undefined}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button loading={busy} disabled={!canSubmit} onClick={submit}>
          {face ? <><ScanFace className="h-4 w-4" /> Capture & {ACTION_LABELS[action].toLowerCase()}</> : ACTION_LABELS[action]}
        </Button>
      </>}>
      <div className="space-y-4">
        {face && <CameraCapture ref={cam} scanning={busy} />}
        {mode !== "OFF" && (
          <div className="rounded-xl border border-border p-3 text-sm" data-testid="dialog-location" data-status={attempt?.status ?? (locating ? "LOCATING" : "")}>
            <p className="flex items-center gap-2 font-medium">
              <MapPin className="h-4 w-4" /> Location {mode === "OPTIONAL" ? "(optional)" : "(required)"}
            </p>
            {locating ? (
              <p className="mt-1 flex items-center gap-2 text-muted-foreground"><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Getting a fresh location…</p>
            ) : attempt ? (
              <p className={cn("mt-1", attempt.status === "CAPTURED" && !lowAccuracy ? "text-success" : "text-warning")}>
                {explainAttempt(attempt, policy.location.acceptable_accuracy_m)}
              </p>
            ) : null}
            {!locating && (failed || lowAccuracy) && (
              <Button size="sm" variant="ghost" className="mt-1" onClick={() => void locate()}><RefreshCw className="h-3.5 w-3.5" /> Try again</Button>
            )}
            {exceptionAllowed && !locating && (failed || lowAccuracy || error) && (
              <div className="mt-2 space-y-2 border-t border-border pt-2">
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={useException} onChange={(e) => setUseException(e.target.checked)} />
                  Continue without a usable location — my manager will review the reason
                </label>
                {useException && (
                  <Field label="Reason">
                    <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500}
                      placeholder="e.g. GPS doesn't work inside the warehouse" />
                  </Field>
                )}
              </div>
            )}
          </div>
        )}
        {needsNotice && (
          <div className="rounded-xl bg-muted p-3 text-xs leading-relaxed" data-testid="location-notice">
            <p className="mb-1 flex items-center gap-1.5 font-semibold"><ShieldCheck className="h-4 w-4" /> Location notice</p>
            While you are punched in, {me?.company.name} records your browser&apos;s estimated location
            {policy.location.punch !== "OFF" ? ` when you punch in and out (${policy.location.punch.toLowerCase()})` : ""}
            {policy.location.lunch !== "OFF" ? `, at lunch (${policy.location.lunch.toLowerCase()})` : ""}
            {policy.tracking.enabled ? `, and about every ${policy.tracking.interval_minutes} minutes while this site is open${policy.tracking.pause_on_lunch ? " (not during lunch)" : ""}` : ""}.
            Readings are estimates with an accuracy radius, kept {policy.location.retention_days} days and visible to you and
            authorised managers/HR. Collection stops when you punch out.
            <label className="mt-2 flex items-center gap-2 font-medium">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> I understand
            </label>
          </div>
        )}
        {onLunch && (
          <label className="flex items-start gap-2 rounded-xl bg-warning-soft p-3 text-sm text-warning">
            <input type="checkbox" className="mt-1" checked={confirmLunch} onChange={(e) => setConfirmLunch(e.target.checked)} />
            You&apos;re still on lunch. End lunch now and punch out at the same time.
          </label>
        )}
        {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
