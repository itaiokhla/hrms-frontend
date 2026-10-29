"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle, CheckCircle2, Coffee, LogIn, LogOut, MapPin, QrCode, RefreshCw, ScanFace, ShieldCheck, Smartphone,
  Monitor, Utensils,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";

import { CameraCapture, type CameraHandle } from "@/components/shared/CameraCapture";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { ErrorState, LiveClock } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Badge, Card, MotionSafe, Skeleton } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { fmtDate, fmtTime } from "@/lib/format";
import { captureLocation, explainAttempt, type LocationAttempt } from "@/lib/geolocation";
import { useApi } from "@/lib/hooks";
import { enqueue, recordServerTime } from "@/lib/offlineQueue";
import { newIdempotencyKey } from "@/lib/payroll/api";
import type { MyAttendance } from "@/lib/types";
import { useSession } from "@/store/session";

import { CaptureApiError, captureApi, type CaptureView, type LocationCheck, type PunchMeta, type PunchResult } from "./captureApi";
import { OfflineQueueCard } from "./OfflineQueueCard";
import {
  BAND_LABEL, DIRECTION_DONE, DIRECTION_LABEL, FLAG_LABEL, GEOFENCE_LABEL, LOCATION_LABEL, RESULT_LABEL, directionsFor,
  geofenceText, resultTone, type Direction,
} from "./captureModel";

const ICONS: Record<Direction, typeof LogIn> = { IN: LogIn, OUT: LogOut, BREAK_START: Utensils, BREAK_END: Coffee };
const REASON_MIN = 5;

/** WEB (desktop browser) or MOBILE (the /punch PWA on a phone), the client's own statement (IG-AS-45). */
export function detectSource(capture: Pick<CaptureView, "sources"> | undefined,
  env: { userAgent?: string; coarse?: boolean } = {}): "WEB" | "MOBILE" {
  const ua = env.userAgent ?? (typeof navigator === "undefined" ? "" : navigator.userAgent);
  const coarse = env.coarse ?? (typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia("(pointer: coarse)").matches);
  const phone = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || !!coarse;
  const wanted = phone ? "MOBILE" : "WEB";
  const sources = capture?.sources ?? [];
  if (sources.includes(wanted) || !sources.length) return wanted;
  return sources.includes("WEB") ? "WEB" : sources.includes("MOBILE") ? "MOBILE" : wanted;
}

function locationModeOf(capture: CaptureView, direction: Direction): string {
  return direction === "IN" || direction === "OUT" ? capture.location_mode : capture.location_on_breaks;
}

function faceWanted(capture: CaptureView, direction: Direction): boolean {
  return direction === "IN" || direction === "OUT" ? capture.face_on_punch : capture.face_on_break;
}

/* ===================================================================== screen */

/**
 * `/punch` (AS 09-ui-ux/01 M1, 02 §3.6; 04-attendance/01 §4): one primary button with explicit direction, the live
 * state, the location notice, the site checks of the effective capture policy, and the result of the last punch as
 * a label and a distance band — never coordinates (07 §7).
 */
export function PunchScreen() {
  const me = useSession((s) => s.me);
  const capture = useApi(() => captureApi.myCapture(), []);
  const today = useApi(() => captureApi.myToday(), []);
  const [dialog, setDialog] = useState<Direction | null>(null);
  const [receipt, setReceipt] = useState<PunchResult | null>(null);
  useEffect(() => { recordServerTime(today.data?.server_now); }, [today.data?.server_now]);

  if (capture.error || today.error) {
    const error = capture.error ?? today.error;
    return (
      <Card className="mx-auto max-w-lg">
        <ErrorState message={error?.message ?? "Couldn't load your punch screen."}
          onRetry={() => { void capture.reload(); void today.reload(); }} />
      </Card>
    );
  }
  if (!capture.data || !today.data) {
    return (
      <div className="mx-auto max-w-lg space-y-4" aria-busy="true">
        <Skeleton className="h-56 rounded-3xl" />
        <Skeleton className="h-14 rounded-2xl" />
        <Skeleton className="h-32 rounded-2xl" />
      </div>
    );
  }
  const policy = capture.data;
  const day = today.data;
  const directions = directionsFor(day.actions);
  const source = detectSource(policy);
  const record = day.record;
  const openBreak = record?.breaks.find((b) => !b.ended_at);
  const SourceIcon = source === "MOBILE" ? Smartphone : Monitor;

  return (
    <MotionSafe>
      <div className="mx-auto max-w-lg space-y-4" data-testid="punch-screen" data-state={day.attendance_state} data-source={source}>
        <Card className="overflow-hidden">
          <div className="relative overflow-hidden bg-gradient-to-br from-primary via-primary to-accent p-6 text-primary-foreground">
            <motion.div aria-hidden className="absolute -right-12 -top-12 h-44 w-44 rounded-full bg-white/10 blur-2xl"
              animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }} />
            <div className="relative flex items-start justify-between gap-3">
              <div>
                <p className="text-sm opacity-90">{fmtDate(new Date().toISOString(), "EEEE, d MMMM")}</p>
                <LiveClock className="mt-1 block font-display text-4xl font-semibold" />
              </div>
              <Badge className="bg-white/20 text-white" data-testid="punch-source">
                <SourceIcon className="h-3 w-3" aria-hidden /> {source === "MOBILE" ? "Phone" : "Web"}
              </Badge>
            </div>
            <AnimatePresence mode="wait">
              <motion.p key={day.attendance_state} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="relative mt-3 text-sm" role="status"
                aria-live="polite" data-testid="punch-state">
                {day.attendance_state === "NOT_PUNCHED_IN" && "You haven't checked in yet."}
                {day.attendance_state === "WORKING" && <>Checked in since {fmtTime(record?.check_in_time)}</>}
                {day.attendance_state === "ON_LUNCH" && <>On a break since {fmtTime(openBreak?.started_at)}</>}
                {day.attendance_state === "PUNCHED_OUT" && "Your day is recorded."}
              </motion.p>
            </AnimatePresence>
          </div>

          <div className="space-y-3 p-5">
            {directions.length ? directions.map((direction, index) => (
              <PunchButton key={direction} direction={direction} primary={index === 0}
                onPress={() => setDialog(direction)} />
            )) : (
              <div className="flex items-center gap-3 rounded-2xl bg-success-soft px-4 py-3 text-sm text-success" data-testid="punch-done">
                <CheckCircle2 className="h-5 w-5" aria-hidden /> Nothing more to punch today.
              </div>
            )}
            {!policy.sources.includes(source) && (
              <p className="flex items-center gap-2 rounded-xl bg-warning-soft px-3 py-2 text-xs text-warning" role="note">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> Your company doesn&apos;t accept punches from this kind of device.
              </p>
            )}
          </div>
        </Card>

        <AnimatePresence>
          {receipt && <Receipt key={receipt.punch_id ?? "receipt"} result={receipt} />}
        </AnimatePresence>

        <OfflineQueueCard enabled={policy.offline_punches === "ALLOW"}
          onSynced={() => { void today.reload(); void capture.reload(); }} />

        <ChecksCard capture={policy} />

        <p className="text-center text-xs text-muted-foreground">
          <Link href="/me/attendance/privacy" className="font-medium text-primary hover:underline" data-testid="punch-privacy-link">
            Privacy &amp; consents
          </Link>
          {" · "}what is recorded when you punch, and for how long.
        </p>

        {dialog && (
          <PunchDialog direction={dialog} capture={policy} today={day} source={source} companyName={me?.company.name ?? "Your company"}
            onClose={() => setDialog(null)}
            onDone={(result) => {
              setDialog(null);
              setReceipt(result);
              today.setData(result);
              toast.success(`${DIRECTION_DONE[result.direction] ?? "Done"} at ${fmtTime(new Date().toISOString())}`);
              void capture.reload();
            }}
            onStale={(message) => { setDialog(null); toast.error(message); void today.reload(); }} />
        )}
      </div>
    </MotionSafe>
  );
}

/** The big explicit-direction button (≥ 48 px, spine §11.8); press scales via the kit. */
export function PunchButton({ direction, primary, onPress, busy }: {
  direction: Direction;
  primary?: boolean;
  onPress: () => void;
  busy?: boolean;
}) {
  const Icon = ICONS[direction];
  return (
    <Button size="lg" variant={primary ? "primary" : "secondary"} className="h-14 w-full text-base"
      data-testid={`punch-${direction}`} loading={busy} onClick={onPress}>
      <Icon className="h-5 w-5" aria-hidden /> {DIRECTION_LABEL[direction]}
    </Button>
  );
}

/** The employee's view of the site check: label + band, a chip per flag. */
export function LocationResult({ check }: { check: LocationCheck | null | undefined }) {
  const text = geofenceText(check);
  if (!check || !text) return null;
  const tone = resultTone(check.result);
  return (
    <div className="space-y-1.5" data-testid="punch-location-result" data-result={check.result} data-band={check.distance_band ?? ""}>
      <p className={cn("flex items-center gap-2 text-sm font-medium",
        tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-muted-foreground")}>
        <MapPin className="h-4 w-4 shrink-0" aria-hidden /> {text}
      </p>
      {check.flags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {check.flags.map((f) => <Badge key={f} tone="warning">{FLAG_LABEL[f] ?? f}</Badge>)}
        </div>
      )}
      {check.result === "OUTSIDE" && (
        <p className="text-xs text-muted-foreground">Your punch is recorded. A reviewer may look at it; your exact position is not shown to your manager.</p>
      )}
    </div>
  );
}

function Receipt({ result }: { result: PunchResult }) {
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}>
      <Card className="space-y-3 p-5" data-testid="punch-receipt" data-direction={result.direction}>
        <p className="flex items-center gap-2 font-semibold">
          <CheckCircle2 className="h-5 w-5 text-success" aria-hidden />
          {DIRECTION_DONE[result.direction] ?? "Recorded"} · {fmtTime(new Date().toISOString())}
          {result.replayed && <Badge tone="neutral">already recorded</Badge>}
        </p>
        <LocationResult check={result.location_check} />
        {result.face_step === "SKIPPED" && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="punch-receipt-face-skipped">
            <ScanFace className="h-4 w-4" aria-hidden /> Recorded without face matching.
          </p>
        )}
      </Card>
    </motion.div>
  );
}

/** Which checks apply to me today, in plain words (no geometry). */
function ChecksCard({ capture }: { capture: CaptureView }) {
  const rows: { label: string; value: string }[] = [];
  if (capture.location_mode !== "OFF") rows.push({ label: "Location at check in and out", value: LOCATION_LABEL[capture.location_mode] ?? capture.location_mode });
  if (capture.geofence_mode !== "OFF") rows.push({ label: "Site check", value: GEOFENCE_LABEL[capture.geofence_mode] ?? capture.geofence_mode });
  if (capture.ip_mode !== "OFF") rows.push({ label: "Office network", value: capture.ip_mode === "BLOCK" ? "Required" : "Flag for review" });
  if (capture.qr_mode !== "OFF") rows.push({ label: "QR poster", value: "Scan at your site" });
  if (capture.face_step !== "OFF") rows.push({ label: "Face match", value: capture.face_step === "SKIPPED" ? "Skipped for you" : "At check in and out" });
  if (!rows.length && !capture.sites.length) return null;
  return (
    <Card className="p-5" data-testid="punch-checks">
      <p className="mb-3 flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4 text-primary" aria-hidden /> How your punches are checked</p>
      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.label} className="rounded-xl bg-muted px-3 py-2">
            <dt className="text-xs text-muted-foreground">{r.label}</dt>
            <dd className="font-medium">{r.value}</dd>
          </div>
        ))}
      </dl>
      {capture.sites.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground" data-testid="punch-sites">
          Your sites: {capture.sites.map((s) => s.name).join(", ")}
        </p>
      )}
    </Card>
  );
}

/* ===================================================================== dialog */

interface Blocked {
  message: string;
  reasonAllowed: boolean;
  check: LocationCheck | null;
}

function PunchDialog({ direction, capture, today, source, companyName, onClose, onDone, onStale }: {
  direction: Direction;
  capture: CaptureView;
  today: MyAttendance;
  source: "WEB" | "MOBILE";
  companyName: string;
  onClose: () => void;
  onDone: (result: PunchResult) => void;
  onStale: (message: string) => void;
}) {
  const mode = locationModeOf(capture, direction);
  const face = faceWanted(capture, direction) && capture.face_step === "REQUIRED";
  const faceSkipped = faceWanted(capture, direction) && capture.face_step === "SKIPPED";
  // Periodic location during the shift has its own notice (07 L-2): shown at check in while tracking is on.
  const tracking = direction === "IN" && !!capture.tracking?.enabled;
  const needsNotice = (mode !== "OFF" && capture.consents_needed.some((c) => c.purpose === "LOCATION_AT_PUNCH")) || tracking;
  const qrRequired = capture.qr_mode === "REQUIRED";
  const onBreak = direction === "OUT" && today.attendance_state === "ON_LUNCH";
  const intent = useMemo(() => newIdempotencyKey(), []); // one key per intent: retries reuse it (P-1)
  const cam = useRef<CameraHandle>(null);
  const [attempt, setAttempt] = useState<LocationAttempt | null>(null);
  const [locating, setLocating] = useState(false);
  const [consent, setConsent] = useState(false);
  const [noticeForced, setNoticeForced] = useState(false);
  const [qr, setQr] = useState("");
  const [reason, setReason] = useState("");
  const [askReason, setAskReason] = useState(false);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [confirmBreak, setConfirmBreak] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const locate = useCallback(async () => {
    if (mode === "OFF") return null;
    setLocating(true);
    try {
      const result = await captureLocation({
        timeoutMs: today.policy?.location?.timeout_ms ?? 20_000,
        maxAttempts: today.policy?.location?.max_attempts ?? 3,
        acceptableAccuracyM: capture.gps.acceptable_accuracy_m,
        maxFixAgeSeconds: capture.gps.max_fix_age_seconds,
        allowPrompt: true,
      });
      setAttempt(result);
      return result;
    } finally {
      setLocating(false);
    }
  }, [mode, capture, today]);

  useEffect(() => {
    void locate();
  }, [locate]);

  const showNotice = needsNotice || noticeForced;
  const failed = attempt !== null && attempt.status !== "CAPTURED";
  const reasonOffered = askReason || (mode === "REQUIRED" && failed && capture.location_failure_action === "ALLOW_WITH_REASON");
  const reasonOk = reason.trim().length >= REASON_MIN;
  const canSubmit = !busy && !locating && (!showNotice || consent) && (!qrRequired || qr.trim().length > 0)
    && (!onBreak || confirmBreak) && (!askReason || reasonOk)
    && !(mode === "REQUIRED" && failed && !(reasonOffered && reasonOk));

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
      const meta: PunchMeta = { direction, capture_source: source, idempotency_key: intent };
      if (direction !== "IN" && today.record) meta.attendance_id = today.record.id;
      if (mode !== "OFF" && attempt) meta.location = attempt;
      if (showNotice && consent) meta.location_consent = true;
      if (qrRequired && qr.trim()) meta.qr_payload = qr.trim();
      if (reasonOffered && reasonOk) meta.exception_reason = reason.trim();
      if (onBreak) meta.confirm_close_lunch = true;
      onDone(await captureApi.punch(meta, image));
    } catch (e) {
      const err = e instanceof CaptureApiError ? e : null;
      const code = err?.code ?? (e as { code?: string }).code;
      const status = err?.status ?? (e as { status?: number }).status ?? 0;
      const message = (e as Error).message;
      if (code === "GEOFENCE_BLOCKED") {
        const d = (err?.details ?? {}) as Record<string, unknown>;
        const check: LocationCheck = {
          result: String(d.geofence_result ?? "OUTSIDE"), label: (d.label as string) ?? null,
          distance_band: (d.distance_band as string) ?? null, site_name: (d.site_name as string) ?? null, flags: [],
        };
        const allowed = Boolean(d.reason_allowed);
        setBlocked({ message, reasonAllowed: allowed, check });
        if (allowed) setAskReason(true);
      } else if (code === "CONSENT_REQUIRED" || code === "LOCATION_NOTICE_REQUIRED") {
        setNoticeForced(true);
        setError("Please read the notice and tick “I understand” to continue.");
      } else if (code === "LOCATION_STALE") {
        setError("That location reading is too old. Taking a fresh one…");
        await locate();
      } else if (code === "QR_INVALID") {
        setError(message);
      } else if (status === 0 && capture.offline_punches === "ALLOW") {
        // O-2: keep the punch on this phone (no photo, face or QR is queued) and sync it when the network is back.
        enqueue({ idempotency_key: intent, direction, capture_source: source,
          location: mode !== "OFF" && attempt ? (attempt as unknown as Record<string, unknown>) : null,
          location_consent: true, exception_reason: reasonOffered && reasonOk ? reason.trim() : null });
        toast.success(`${DIRECTION_LABEL[direction]} saved on this phone — it syncs when you're back online.`);
        onClose();
      } else if (status === 0) {
        setError("You're offline. Reconnect and press the button again — nothing is recorded twice.");
      } else if (status === 409 && !["LUNCH_OPEN_CONFIRM", "LUNCH_OPEN"].includes(code ?? "")) {
        onStale(message);
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  };

  const title = face ? "Verify it's you" : DIRECTION_LABEL[direction];
  const submitLabel = face ? `Capture & ${DIRECTION_LABEL[direction].toLowerCase()}`
    : askReason ? `${DIRECTION_LABEL[direction]} with reason` : DIRECTION_LABEL[direction];
  return (
    <Modal open onOpenChange={(open) => !open && onClose()} title={title} size={face ? "md" : "sm"}
      description={face ? "Look at the camera. We compare this capture with your enrolled face only." : undefined}
      footer={<>
        <Button variant="secondary" onClick={onClose} data-testid="punch-cancel">Cancel</Button>
        <Button loading={busy} disabled={!canSubmit} onClick={submit} data-testid="punch-submit">
          {face && <ScanFace className="h-4 w-4" aria-hidden />} {submitLabel}
        </Button>
      </>}>
      <div className="space-y-4" data-testid="punch-dialog" data-direction={direction}>
        {face && <CameraCapture ref={cam} scanning={busy} />}
        {faceSkipped && (
          <p className="flex items-start gap-2 rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground" data-testid="punch-face-skipped">
            <ScanFace className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            You punch without face matching: there is no face consent on file for you. You can give it on your privacy page.
          </p>
        )}

        {mode !== "OFF" && (
          <div className="rounded-xl border border-border p-3 text-sm" data-testid="punch-location"
            data-status={attempt?.status ?? (locating ? "LOCATING" : "")}>
            <p className="flex items-center gap-2 font-medium">
              <MapPin className="h-4 w-4" aria-hidden /> Location {mode === "OPTIONAL" ? "(optional)" : "(required)"}
            </p>
            {locating ? (
              <p className="mt-1 flex items-center gap-2 text-muted-foreground">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden /> Getting a fresh location…
              </p>
            ) : attempt ? (
              <p className={cn("mt-1", attempt.status === "CAPTURED" ? "text-success" : "text-warning")}>
                {explainAttempt(attempt, capture.gps.acceptable_accuracy_m)}
              </p>
            ) : null}
            {!locating && failed && (
              <Button size="sm" variant="ghost" className="mt-1" onClick={() => void locate()}>
                <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Try again
              </Button>
            )}
          </div>
        )}

        {qrRequired && (
          <Field label="QR poster code" hint="Scan the poster at your site with your camera app, or type the code under it.">
            <div className="relative">
              <QrCode className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input value={qr} onChange={(e) => setQr(e.target.value)} className="ps-9" data-testid="punch-qr" maxLength={256} />
            </div>
          </Field>
        )}

        <AnimatePresence>
          {blocked && (
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="space-y-2 rounded-xl border border-warning/40 bg-warning-soft p-3 text-sm" role="alert"
              data-testid="punch-blocked" data-reason-allowed={String(blocked.reasonAllowed)}>
              <p className="flex items-start gap-2 font-medium text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {blocked.message}
              </p>
              {blocked.check && (
                <p className="text-xs text-foreground/80" data-testid="punch-blocked-band">
                  {RESULT_LABEL[blocked.check.result] ?? blocked.check.result}
                  {blocked.check.distance_band && blocked.check.distance_band !== "UNKNOWN" ? ` · ${BAND_LABEL[blocked.check.distance_band]}` : ""}
                  {blocked.check.site_name ? ` · ${blocked.check.site_name}` : ""}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {reasonOffered && (
          <Field label="Reason" required hint={`At least ${REASON_MIN} characters. Your reviewer sees it with the punch.`}>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} data-testid="punch-reason"
              placeholder="e.g. Working at the client office today" />
          </Field>
        )}

        {showNotice && (
          <div className="rounded-xl bg-muted p-3 text-xs leading-relaxed" data-testid="punch-location-notice">
            <p className="mb-1 flex items-center gap-1.5 font-semibold"><ShieldCheck className="h-4 w-4" aria-hidden /> Location notice</p>
            {mode !== "OFF" && <>
              {companyName} records your phone or browser&apos;s location when you check in and out
              {capture.location_on_breaks !== "OFF" ? " and at breaks" : ""}, to confirm you are at your site.{" "}
            </>}
            {tracking && <>
              While you are checked in, your location is also checked about every {capture.tracking?.interval_minutes} minutes
              {capture.tracking?.pause_on_break ? " (not during breaks)" : ""}, and never outside work.{" "}
            </>}
            It is kept for a limited time (see your privacy page). Your manager sees only whether you were at your site,
            never the exact place.
            <label className="mt-2 flex items-center gap-2 font-medium">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="punch-location-consent" />
              I understand
            </label>
          </div>
        )}

        {onBreak && (
          <label className="flex items-start gap-2 rounded-xl bg-warning-soft p-3 text-sm text-warning">
            <input type="checkbox" className="mt-1" checked={confirmBreak} onChange={(e) => setConfirmBreak(e.target.checked)} />
            You&apos;re still on a break. End it now and check out at the same time.
          </label>
        )}

        {error && <p role="alert" className="text-sm font-medium text-danger" data-testid="punch-error">{error}</p>}
      </div>
    </Modal>
  );
}
