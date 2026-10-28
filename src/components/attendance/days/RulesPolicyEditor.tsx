"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, Rocket } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorState, PageHeader } from "@/components/ui/layout";
import { Badge, Card } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/api";
import { fmtDate, todayISO } from "@/lib/format";
import { useApi } from "@/lib/hooks";

import { attendanceRulesApi, type RulesFields, type SimulateResult } from "./api";

const minutes = z.coerce.number().int().min(0).max(1440);
const optionalLimit = z.union([z.literal(""), z.coerce.number().int().min(1).max(720)]);

/** 02 §4.3 rules as a form schema; the server validates again (INVALID_FIELDS). */
export const rulesSchema = z.object({
  name: z.string().trim().min(3, "Name the policy").max(100),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date"),
  day_basis: z.enum(["PRESENCE", "HOURS"]),
  threshold_mode: z.enum(["ABSOLUTE", "PERCENT_OF_EXPECTED"]),
  full_day_min_minutes: minutes,
  half_day_min_minutes: minutes,
  full_day_min_percent: z.coerce.number().int().min(0).max(100),
  half_day_min_percent: z.coerce.number().int().min(0).max(100),
  absent_marking: z.enum(["AUTO_ABSENT", "LEAVE_UNMARKED"]),
  grace_in_minutes: z.union([z.literal(""), z.coerce.number().int().min(0).max(240)]),
  grace_out_minutes: z.coerce.number().int().min(0).max(240),
  late_half_day_after_minutes: optionalLimit,
  early_half_day_before_minutes: optionalLimit,
  late_waiver: z.enum(["NONE", "NET_GE_EXPECTED", "GROSS_GE_EXPECTED"]),
  short_hours_enabled: z.boolean(),
  short_tolerance_minutes: z.coerce.number().int().min(0).max(240),
  break_attestation: z.boolean(),
}).superRefine((v, ctx) => {
  if (v.half_day_min_minutes > v.full_day_min_minutes)
    ctx.addIssue({ code: "custom", path: ["half_day_min_minutes"], message: "Cannot exceed the full-day minimum" });
  if (v.half_day_min_percent > v.full_day_min_percent)
    ctx.addIssue({ code: "custom", path: ["half_day_min_percent"], message: "Cannot exceed the full-day share" });
  if (v.late_half_day_after_minutes !== "" && v.grace_in_minutes !== "" && v.late_half_day_after_minutes <= v.grace_in_minutes)
    ctx.addIssue({ code: "custom", path: ["late_half_day_after_minutes"], message: "Must be more than the grace in" });
});
export type RulesForm = z.infer<typeof rulesSchema>;

export function toFields(v: RulesForm): RulesFields {
  return {
    day_basis: v.day_basis, hours_basis: "NET", threshold_mode: v.threshold_mode,
    full_day_min_minutes: String(v.full_day_min_minutes), half_day_min_minutes: String(v.half_day_min_minutes),
    full_day_min_percent: v.full_day_min_percent, half_day_min_percent: v.half_day_min_percent,
    absent_marking: v.absent_marking, grace_in_minutes: v.grace_in_minutes === "" ? null : v.grace_in_minutes,
    grace_out_minutes: v.grace_out_minutes,
    late_half_day_after_minutes: v.late_half_day_after_minutes === "" ? null : v.late_half_day_after_minutes,
    early_half_day_before_minutes: v.early_half_day_before_minutes === "" ? null : v.early_half_day_before_minutes,
    late_waiver: v.late_waiver, early_waiver: "NONE", short_hours_enabled: v.short_hours_enabled,
    short_tolerance_minutes: v.short_tolerance_minutes, break_attestation: v.break_attestation,
    ot_post_shift_buffer_minutes: 0,
  };
}

const DEFAULTS: RulesForm = {
  name: "Attendance rules", effective_from: todayISO(), day_basis: "HOURS", threshold_mode: "PERCENT_OF_EXPECTED",
  full_day_min_minutes: 480, half_day_min_minutes: 240, full_day_min_percent: 90, half_day_min_percent: 50,
  absent_marking: "AUTO_ABSENT", grace_in_minutes: "", grace_out_minutes: 0, late_half_day_after_minutes: "",
  early_half_day_before_minutes: "", late_waiver: "NONE", short_hours_enabled: false, short_tolerance_minutes: 0,
  break_attestation: false,
};

/** Settings › Attendance › Rules: draft a STANDARD rules version, preview its impact (§5.4), activate it (§4.6). */
export function RulesPolicyEditor() {
  const { data: existing, error, reload } = useApi(() => attendanceRulesApi.list(), []);
  const { register, handleSubmit, watch, formState: { errors } } = useForm<RulesForm>({
    resolver: zodResolver(rulesSchema), defaultValues: DEFAULTS });
  const [draft, setDraft] = useState<{ id: number; version: number; effectiveFrom: string } | null>(null);
  const [preview, setPreview] = useState<SimulateResult | null>(null);
  const [reason, setReason] = useState("");
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const percent = watch("threshold_mode") === "PERCENT_OF_EXPECTED";

  const saveAndPreview = handleSubmit(async (values) => {
    setBusy("preview");
    try {
      // The draft is not assigned yet: an assigned draft without an active version would win resolution.
      // The preview passes the proposed assignment (everyone) instead (02 §5.4).
      const policy = await attendanceRulesApi.create(values.name, toFields(values));
      const next = { id: policy.id, version: 1, effectiveFrom: values.effective_from };
      setDraft(next);
      setPreview(await attendanceRulesApi.simulate(next.id, next.version, next.effectiveFrom));
      void reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  });

  async function activate() {
    if (!draft) return;
    setBusy("activate");
    try {
      await attendanceRulesApi.assignEveryone(draft.id);
      await attendanceRulesApi.activate(draft.id, draft.version, draft.effectiveFrom, reason, locked);
      toast.success("Activated: covered days are being recomputed.");
      setDraft(null);
      setPreview(null);
      void reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const err = (name: keyof RulesForm) => errors[name]?.message as string | undefined;
  return (
    <div className="space-y-4" data-testid="attendance-rules-editor">
      <PageHeader eyebrow="Settings · Attendance" title="Attendance rules"
        description="How a day is decided: full and half day, grace, late and early limits. Preview the impact before you activate." />
      {error ? <ErrorState message={error.message} onRetry={reload} /> : (
        <Card className="p-5">
          <p className="text-sm font-medium">Policies</p>
          <ul className="mt-2 space-y-1 text-sm" data-testid="rules-policies">
            {(existing ?? []).length === 0 && <li className="text-muted-foreground">No rules policy yet: days follow the current behaviour.</li>}
            {(existing ?? []).map((p) => (
              <li key={p.id} className="flex items-center gap-2">
                <span className="font-medium">{p.name}</span>
                <Badge tone={p.active_version ? "success" : "neutral"}>{p.active_version ? `v${p.active_version.version} active` : "draft"}</Badge>
                {p.active_version && <span className="text-muted-foreground">from {fmtDate(p.active_version.effective_from)} · {String(p.active_version.fields.profile ?? "STANDARD") === "LEGACY_V1" ? "current behaviour" : "standard"}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <form onSubmit={saveAndPreview} className="space-y-4" noValidate>
        <Card className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Name" error={err("name")}><Input {...register("name")} /></Field>
          <Field label="Effective from" error={err("effective_from")}><Input type="date" {...register("effective_from")} /></Field>
          <Field label="A day is judged by">
            <Select {...register("day_basis")}><option value="HOURS">Worked hours</option><option value="PRESENCE">Any work in the half</option></Select>
          </Field>
          <Field label="Thresholds">
            <Select {...register("threshold_mode")}><option value="PERCENT_OF_EXPECTED">Share of expected minutes</option><option value="ABSOLUTE">Fixed minutes</option></Select>
          </Field>
          {percent ? (
            <>
              <Field label="Full day (%)" error={err("full_day_min_percent")}><Input type="number" {...register("full_day_min_percent")} /></Field>
              <Field label="Half day (%)" error={err("half_day_min_percent")}><Input type="number" {...register("half_day_min_percent")} /></Field>
            </>
          ) : (
            <>
              <Field label="Full day (minutes)" error={err("full_day_min_minutes")}><Input type="number" {...register("full_day_min_minutes")} /></Field>
              <Field label="Half day (minutes)" error={err("half_day_min_minutes")}><Input type="number" {...register("half_day_min_minutes")} /></Field>
            </>
          )}
          <Field label="Unworked expected half">
            <Select {...register("absent_marking")}><option value="AUTO_ABSENT">Absent</option><option value="LEAVE_UNMARKED">Unmarked (for leave)</option></Select>
          </Field>
          <Field label="Grace in (minutes, empty = setting)" error={err("grace_in_minutes")}><Input type="number" {...register("grace_in_minutes")} /></Field>
          <Field label="Grace out (minutes)" error={err("grace_out_minutes")}><Input type="number" {...register("grace_out_minutes")} /></Field>
          <Field label="Late beyond = half day (minutes)" error={err("late_half_day_after_minutes")}><Input type="number" {...register("late_half_day_after_minutes")} /></Field>
          <Field label="Early beyond = half day (minutes)" error={err("early_half_day_before_minutes")}><Input type="number" {...register("early_half_day_before_minutes")} /></Field>
          <Field label="Excuse a late mark when">
            <Select {...register("late_waiver")}><option value="NONE">Never</option><option value="NET_GE_EXPECTED">Net hours are complete</option><option value="GROSS_GE_EXPECTED">Gross hours are complete</option></Select>
          </Field>
          <Field label="Short-hours tolerance (minutes)" error={err("short_tolerance_minutes")}><Input type="number" {...register("short_tolerance_minutes")} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register("short_hours_enabled")} /> Mark short days</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register("break_attestation")} /> Ask at check-out whether the break was taken</label>
        </Card>
        <Button type="submit" variant="secondary" loading={busy === "preview"}><Eye className="h-4 w-4" aria-hidden /> Save draft and preview impact</Button>
      </form>
      {preview && draft && (
        <Card className="space-y-3 p-5" data-testid="rules-preview">
          <p className="text-sm font-medium">Impact preview</p>
          <p className="text-sm text-muted-foreground">
            {preview.window ? `${fmtDate(preview.window.start)} – ${fmtDate(preview.window.end)}` : "No past days in the window"}
            {` · covers ${preview.population.covered_after} people (now ${preview.population.covered_now})`}
            {` · ${preview.dates.OPEN} open days, ${preview.dates.INPUT_LOCKED + preview.dates.FINALIZED} in locked periods`}
            {preview.bounded ? " · window capped" : ""}
          </p>
          <ul className="text-sm" data-testid="rules-preview-changes">
            {Object.entries(preview.changes.day_result ?? {}).map(([change, count]) => <li key={change}>{change.replace(/_/g, " ").toLowerCase()}: {count}</li>)}
            {!preview.changes.changed_days && <li className="text-muted-foreground">No day would change.</li>}
            {!!preview.changes.late_marks_added && <li>late marks added: {preview.changes.late_marks_added}</li>}
            {!!preview.changes.late_marks_removed && <li>late marks removed: {preview.changes.late_marks_removed}</li>}
          </ul>
          {!preview.v2_active && <p className="text-xs text-muted-foreground">Attendance v2 is not active: standard rules can be activated after the cut-over.</p>}
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={locked} onChange={(e) => setLocked(e.target.checked)} /> Also recompute locked payroll periods</label>
            <Button loading={busy === "activate"} disabled={!preview.v2_active || (locked && reason.trim().length < 3)} onClick={activate}>
              <Rocket className="h-4 w-4" aria-hidden /> Activate
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
