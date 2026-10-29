"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import { Fingerprint, MapPin, Radar, Rocket, Smartphone, Timer, WifiOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorState, PageHeader } from "@/components/ui/layout";
import { Badge, Card, Skeleton } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/api";
import { fmtDate, todayISO } from "@/lib/format";
import { useApi } from "@/lib/hooks";

import { capturePolicyApi, type CaptureFields } from "./api";

const SOURCES = [
  { value: "WEB", label: "Web browser" },
  { value: "MOBILE", label: "Mobile app" },
  { value: "KIOSK", label: "Kiosk" },
  { value: "DEVICE", label: "Biometric terminal" },
  { value: "IMPORT", label: "File import" },
  { value: "SUPERVISOR", label: "Supervisor muster" },
] as const;
const KIOSK = ["PIN", "QR", "CARD", "FACE"] as const;

const int = (min: number, max: number) => z.coerce.number().int().min(min, `${min}–${max}`).max(max, `${min}–${max}`);

/** 04-attendance/02 §4.1 capture fields as a form; the API validates again (INVALID_FIELDS). */
export const captureSchema = z.object({
  name: z.string().trim().min(3, "Name the policy").max(100),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date"),
  reason: z.string().trim().max(500),
  allowed_sources: z.array(z.string()).min(1, "Allow at least one way to punch"),
  kiosk_methods: z.array(z.string()).min(1, "Choose at least one kiosk method"),
  face_on_punch: z.boolean(),
  dpia_reference: z.string().trim().max(100),
  location_mode: z.enum(["OFF", "OPTIONAL", "REQUIRED"]),
  location_on_breaks: z.enum(["OFF", "OPTIONAL", "REQUIRED"]),
  location_failure_action: z.enum(["ALLOW_WITH_REASON", "BLOCK"]),
  geofence_mode: z.enum(["OFF", "FLAG", "REQUIRE_REASON", "BLOCK"]),
  ip_mode: z.enum(["OFF", "FLAG", "BLOCK"]),
  qr_mode: z.enum(["OFF", "REQUIRED"]),
  tracking_enabled: z.boolean(),
  tracking_interval_minutes: int(5, 480),
  tracking_grace_minutes: int(1, 60),
  tracking_pause_on_break: z.boolean(),
  multiple_sessions_allowed: z.boolean(),
  allow_multiple_breaks: z.boolean(),
  min_session_minutes: int(1, 60),
  auto_close_mode: z.enum(["MAX_DURATION", "SHIFT_END_PLUS"]),
  max_session_hours: int(4, 24),
  auto_close_after_minutes: int(30, 720),
  offline_punches: z.enum(["OFF", "ALLOW"]),
  offline_max_age_hours: int(1, 168),
  muster_enabled: z.boolean(),
}).superRefine((v, ctx) => {
  const face = v.face_on_punch || v.kiosk_methods.includes("FACE");
  if (face && !v.dpia_reference) ctx.addIssue({ code: "custom", path: ["dpia_reference"], message: "Required with face matching" });
  if (v.tracking_grace_minutes >= v.tracking_interval_minutes)
    ctx.addIssue({ code: "custom", path: ["tracking_grace_minutes"], message: "Must be shorter than the interval" });
});
export type CaptureForm = z.infer<typeof captureSchema>;

const DEFAULTS: CaptureForm = {
  name: "Capture policy", effective_from: todayISO(), reason: "", allowed_sources: ["WEB", "MOBILE"],
  kiosk_methods: ["PIN"], face_on_punch: false, dpia_reference: "", location_mode: "OPTIONAL",
  location_on_breaks: "OFF", location_failure_action: "ALLOW_WITH_REASON", geofence_mode: "OFF", ip_mode: "OFF",
  qr_mode: "OFF", tracking_enabled: false, tracking_interval_minutes: 60, tracking_grace_minutes: 15,
  tracking_pause_on_break: true, multiple_sessions_allowed: true, allow_multiple_breaks: true, min_session_minutes: 1,
  auto_close_mode: "SHIFT_END_PLUS", max_session_hours: 16, auto_close_after_minutes: 240, offline_punches: "OFF",
  offline_max_age_hours: 24, muster_enabled: false,
};

/** Existing version fields -> form values (LEGACY_V1 versions become an editable STANDARD draft). */
export function fromFields(name: string, f: Record<string, unknown>): CaptureForm {
  const tracking = (f.tracking ?? {}) as Partial<CaptureFields["tracking"]>;
  const muster = (f.supervisor_muster ?? {}) as Partial<CaptureFields["supervisor_muster"]>;
  const pick = <K extends keyof CaptureForm>(key: K, raw: unknown) => (raw ?? DEFAULTS[key]) as CaptureForm[K];
  return {
    ...DEFAULTS, name, effective_from: todayISO(),
    allowed_sources: pick("allowed_sources", f.allowed_sources), kiosk_methods: pick("kiosk_methods", f.kiosk_methods),
    face_on_punch: pick("face_on_punch", f.face_on_punch), dpia_reference: String(f.dpia_reference ?? ""),
    location_mode: pick("location_mode", f.location_mode), location_on_breaks: pick("location_on_breaks", f.location_on_breaks),
    location_failure_action: pick("location_failure_action", f.location_failure_action),
    geofence_mode: pick("geofence_mode", f.geofence_mode), ip_mode: pick("ip_mode", f.ip_mode), qr_mode: pick("qr_mode", f.qr_mode),
    tracking_enabled: tracking.enabled ?? false, tracking_interval_minutes: tracking.interval_minutes ?? 60,
    tracking_grace_minutes: tracking.grace_minutes ?? 15, tracking_pause_on_break: tracking.pause_on_break ?? true,
    multiple_sessions_allowed: pick("multiple_sessions_allowed", f.multiple_sessions_allowed),
    allow_multiple_breaks: pick("allow_multiple_breaks", f.allow_multiple_breaks),
    min_session_minutes: pick("min_session_minutes", f.min_session_minutes),
    auto_close_mode: pick("auto_close_mode", f.auto_close_mode), max_session_hours: pick("max_session_hours", f.max_session_hours),
    auto_close_after_minutes: pick("auto_close_after_minutes", f.auto_close_after_minutes),
    offline_punches: pick("offline_punches", f.offline_punches), offline_max_age_hours: pick("offline_max_age_hours", f.offline_max_age_hours),
    muster_enabled: muster.enabled ?? false,
  };
}

/** Form values over the version being replaced (keeps fields the form does not show, e.g. GPS tuning). */
export function toFields(v: CaptureForm, base: Record<string, unknown> = {}): CaptureFields {
  const baseTracking = (base.tracking ?? {}) as Partial<CaptureFields["tracking"]>;
  const baseMuster = (base.supervisor_muster ?? {}) as Partial<CaptureFields["supervisor_muster"]>;
  return {
    ...(base as Partial<CaptureFields>),
    profile: "STANDARD",
    allowed_sources: v.allowed_sources, kiosk_methods: v.kiosk_methods, face_on_punch: v.face_on_punch,
    face_on_break: Boolean(base.face_on_break ?? false), punch_photo: Boolean(base.punch_photo ?? false),
    shift_required: Boolean(base.shift_required ?? false), capture_required: (base.capture_required ?? true) as boolean,
    dpia_reference: v.dpia_reference || null, location_mode: v.location_mode, location_on_breaks: v.location_on_breaks,
    location_failure_action: v.location_failure_action, reject_low_accuracy: Boolean(base.reject_low_accuracy ?? false),
    gps: (base.gps as CaptureFields["gps"]) ?? { preferred_accuracy_m: 50, acceptable_accuracy_m: 100, timeout_seconds: 20, max_attempts: 3, max_fix_age_seconds: 120 },
    geofence_mode: v.geofence_mode, allowed_site_ids: (base.allowed_site_ids as number[] | null) ?? null, ip_mode: v.ip_mode,
    qr_mode: v.qr_mode,
    tracking: { movement_threshold_m: baseTracking.movement_threshold_m ?? 1000, enabled: v.tracking_enabled,
      interval_minutes: v.tracking_interval_minutes, grace_minutes: v.tracking_grace_minutes, pause_on_break: v.tracking_pause_on_break },
    multiple_sessions_allowed: v.multiple_sessions_allowed, allow_multiple_breaks: v.allow_multiple_breaks,
    break_open_at_punch_out: (base.break_open_at_punch_out as CaptureFields["break_open_at_punch_out"]) ?? "CONFIRM_AUTO_CLOSE",
    min_session_minutes: v.min_session_minutes, auto_close_mode: v.auto_close_mode, max_session_hours: v.max_session_hours,
    auto_close_after_minutes: v.auto_close_after_minutes,
    infer_breaks_from_punches: Boolean(base.infer_breaks_from_punches ?? false),
    max_break_gap_minutes: Number(base.max_break_gap_minutes ?? 90),
    offline_punches: v.offline_punches, offline_max_age_hours: v.offline_max_age_hours,
    supervisor_muster: { photo_required: baseMuster.photo_required ?? false, geofence_mode: baseMuster.geofence_mode ?? "OFF",
      offline_allowed: baseMuster.offline_allowed ?? false, enabled: v.muster_enabled },
  };
}

function Section({ icon, title, hint, children, testId }: { icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode; testId?: string }) {
  return (
    <motion.section initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} data-testid={testId}>
      <Card className="space-y-4 p-5">
        <div className="flex items-start gap-3">
          <span className="rounded-xl bg-primary/10 p-2 text-primary">{icon}</span>
          <div><p className="font-medium">{title}</p>{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>
        </div>
        {children}
      </Card>
    </motion.section>
  );
}

/** Settings › Attendance › Capture methods & devices (rail item 2): one company capture policy, edited as a new
 * version and activated from a date. Tracking = the periodic location check while someone is checked in. */
export function CapturePolicyEditor() {
  const { data: policies, error, reload, loading } = useApi(() => capturePolicyApi.list(), []);
  const current = useMemo(() => (policies ?? []).find((p) => p.active_version) ?? (policies ?? [])[0] ?? null, [policies]);
  const { data: detail } = useApi(() => (current ? capturePolicyApi.get(current.id) : Promise.resolve(null)), [current?.id]);
  const base = (current?.active_version?.fields ?? detail?.versions?.at(-1)?.fields ?? {}) as Record<string, unknown>;
  const { register, handleSubmit, watch, reset, setValue, formState: { errors, isDirty } } = useForm<CaptureForm>({
    resolver: zodResolver(captureSchema), defaultValues: DEFAULTS });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (current) reset(fromFields(current.name, base));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, current?.active_version?.version]);

  const sources = watch("allowed_sources");
  const kiosk = watch("kiosk_methods");
  const tracking = watch("tracking_enabled");
  const interval = watch("tracking_interval_minutes");
  const toggle = (name: "allowed_sources" | "kiosk_methods", value: string) => {
    const list = watch(name);
    setValue(name, list.includes(value) ? list.filter((x) => x !== value) : [...list, value], { shouldDirty: true, shouldValidate: true });
  };

  const save = handleSubmit(async (values) => {
    setBusy(true);
    try {
      const fields = toFields(values, base);
      let id: number;
      let version: number;
      if (current) {
        id = current.id;
        version = (await capturePolicyApi.newVersion(id, fields, values.effective_from)).version;
      } else {
        const created = await capturePolicyApi.create(values.name, fields, values.effective_from);
        id = created.id;
        version = 1;
        await capturePolicyApi.assignEveryone(id);
      }
      const result = await capturePolicyApi.activate(id, version, values.effective_from, values.reason || "Capture settings");
      toast.success(`Capture policy v${version} active from ${fmtDate(values.effective_from)}`);
      for (const w of result?.warnings ?? []) toast(w, { icon: "⚠️" });
      void reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  });

  const err = (name: keyof CaptureForm) => errors[name]?.message as string | undefined;
  if (error) return <ErrorState message={error.message} onRetry={reload} />;
  if (loading && !policies) return <Skeleton className="h-96 rounded-2xl" />;
  return (
    <div className="space-y-4" data-testid="capture-policy-editor">
      <PageHeader eyebrow="Settings · Attendance" title="Capture methods & devices"
        description="Where people may punch from, what is checked at a punch, and how often location is checked during a shift." />
      <Card className="flex flex-wrap items-center gap-2 p-4 text-sm" data-testid="capture-current">
        {current ? (
          <>
            <span className="font-medium">{current.name}</span>
            <Badge tone={current.active_version ? "success" : "neutral"}>
              {current.active_version ? `v${current.active_version.version} active` : "draft"}
            </Badge>
            {current.active_version && <span className="text-muted-foreground">from {fmtDate(current.active_version.effective_from)}
              {String(current.active_version.fields.profile ?? "STANDARD") === "LEGACY_V1" ? " · follows the legacy settings until you save" : ""}</span>}
          </>
        ) : <span className="text-muted-foreground">No capture policy yet: punches follow the legacy attendance settings.</span>}
      </Card>
      <form onSubmit={save} noValidate className="space-y-4">
        <Section icon={<Smartphone className="h-4 w-4" />} title="Where people punch" testId="capture-sources">
          <div className="flex flex-wrap gap-2">
            {SOURCES.map((s) => (
              <label key={s.value} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-1.5 text-sm ${sources.includes(s.value) ? "border-primary bg-primary/5" : "border-border"}`}>
                <input type="checkbox" checked={sources.includes(s.value)} onChange={() => toggle("allowed_sources", s.value)} data-testid={`source-${s.value}`} />{s.label}
              </label>
            ))}
          </div>
          {err("allowed_sources") && <p className="text-xs text-danger">{err("allowed_sources")}</p>}
          {sources.includes("KIOSK") && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Kiosk identifies by</span>
              {KIOSK.map((k) => (
                <label key={k} className="flex items-center gap-1.5"><input type="checkbox" checked={kiosk.includes(k)} onChange={() => toggle("kiosk_methods", k)} />{k}</label>
              ))}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register("face_on_punch")} /> <Fingerprint className="h-4 w-4" /> Face match at check in and out</label>
            <Field label="Privacy impact assessment reference" error={err("dpia_reference")}><Input {...register("dpia_reference")} placeholder="DPIA-2026-04" /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register("muster_enabled")} data-testid="muster-enabled" /> Supervisors may punch a crew (muster)</label>
          </div>
        </Section>

        <Section icon={<MapPin className="h-4 w-4" />} title="Location at a punch" hint="Checked only when someone punches." testId="capture-location">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="At check in and out"><Select data-testid="location-mode" {...register("location_mode")}><option value="OFF">Off</option><option value="OPTIONAL">Optional</option><option value="REQUIRED">Required</option></Select></Field>
            <Field label="At break start and end"><Select {...register("location_on_breaks")}><option value="OFF">Off</option><option value="OPTIONAL">Optional</option><option value="REQUIRED">Required</option></Select></Field>
            <Field label="Without a usable location"><Select {...register("location_failure_action")}><option value="ALLOW_WITH_REASON">Continue with a reason</option><option value="BLOCK">Refuse the punch</option></Select></Field>
            <Field label="Outside the allowed sites"><Select data-testid="geofence-mode" {...register("geofence_mode")}><option value="OFF">Don't check</option><option value="FLAG">Accept and flag for review</option><option value="REQUIRE_REASON">Ask for a reason</option><option value="BLOCK">Refuse</option></Select></Field>
            <Field label="Office network check"><Select {...register("ip_mode")}><option value="OFF">Off</option><option value="FLAG">Flag outside the network</option><option value="BLOCK">Refuse outside the network</option></Select></Field>
            <Field label="Site QR poster"><Select {...register("qr_mode")}><option value="OFF">Off</option><option value="REQUIRED">Must be scanned</option></Select></Field>
          </div>
        </Section>

        <Section icon={<Radar className="h-4 w-4" />} title="Location during the shift (tracking)"
          hint="Only while someone is checked in; paused on breaks if you choose; never outside work. Employees see an indicator and can withdraw consent." testId="capture-tracking">
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" data-testid="tracking-enabled" {...register("tracking_enabled")} /> Check location periodically during the shift</label>
          {tracking && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="grid gap-4 sm:grid-cols-3">
              <Field label="Every (minutes)" error={err("tracking_interval_minutes")} hint={Number(interval) === 60 ? "Every hour" : undefined}>
                <Input type="number" data-testid="tracking-interval" {...register("tracking_interval_minutes")} />
              </Field>
              <Field label="Grace before a check counts as missed (minutes)" error={err("tracking_grace_minutes")}>
                <Input type="number" {...register("tracking_grace_minutes")} />
              </Field>
              <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" {...register("tracking_pause_on_break")} /> Pause on breaks</label>
            </motion.div>
          )}
        </Section>

        <Section icon={<Timer className="h-4 w-4" />} title="Sessions" testId="capture-sessions">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" data-testid="multiple-sessions" {...register("multiple_sessions_allowed")} /> Several sessions per day</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register("allow_multiple_breaks")} /> Several breaks per session</label>
            <Field label="Minimum session (minutes)" error={err("min_session_minutes")}><Input type="number" {...register("min_session_minutes")} /></Field>
            <Field label="A forgotten check out closes"><Select {...register("auto_close_mode")}><option value="SHIFT_END_PLUS">After the shift end</option><option value="MAX_DURATION">After the longest session</option></Select></Field>
            <Field label="Longest session (hours)" error={err("max_session_hours")}><Input type="number" {...register("max_session_hours")} /></Field>
            <Field label="Close this long after the shift end (minutes)" error={err("auto_close_after_minutes")}><Input type="number" {...register("auto_close_after_minutes")} /></Field>
          </div>
        </Section>

        <Section icon={<WifiOff className="h-4 w-4" />} title="Offline punches" hint="The phone keeps a punch made without network and sends it once, when it reconnects." testId="capture-offline">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Offline punches"><Select data-testid="offline-mode" {...register("offline_punches")}><option value="OFF">Not allowed</option><option value="ALLOW">Allowed</option></Select></Field>
            <Field label="Oldest offline punch accepted (hours)" error={err("offline_max_age_hours")}><Input type="number" {...register("offline_max_age_hours")} /></Field>
          </div>
        </Section>

        <Card className="grid gap-4 p-5 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end">
          <Field label="Name" error={err("name")}><Input {...register("name")} disabled={Boolean(current)} /></Field>
          <Field label="Effective from" error={err("effective_from")}><Input type="date" {...register("effective_from")} /></Field>
          <Field label="Reason (audit)"><Input data-testid="capture-reason" {...register("reason")} placeholder="e.g. hourly location checks for field staff" /></Field>
          <Button type="submit" loading={busy} data-testid="capture-save" disabled={Boolean(current) && !isDirty}><Rocket className="h-4 w-4" aria-hidden /> Save and activate</Button>
        </Card>
      </form>
    </div>
  );
}
