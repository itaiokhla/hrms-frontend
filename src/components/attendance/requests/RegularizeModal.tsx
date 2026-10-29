"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Clock, FileUp, Route, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { EmployeePicker, type PickedEmployee } from "@/components/shared/EmployeePicker";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { Badge } from "@/components/ui/primitives";
import { toApiError } from "@/lib/api";
import {
  ERROR_TEXT, KIND_LABELS, requestsApi,
  type ReasonCode, type RequestFormContext, type RequestKind, type RequestMode, type RequestPreview,
} from "@/lib/attendanceRequests";
import { useDebounced } from "@/lib/hooks";
import { nextDayIso, zonedIso } from "@/lib/timezone";

export interface RegularizeInitial {
  date?: string;
  sessionId?: number | null;
  kind?: RequestKind;
  direction?: "IN" | "OUT" | "BREAK_END";
  mode?: RequestMode;
  employee?: PickedEmployee | null;
}

/** Preset buttons: "Forgot punch-out" is MISSED_PUNCH with direction OUT (§2 vocabulary). */
const PRESETS: { key: string; label: string; kind: RequestKind; direction?: "IN" | "OUT" | "BREAK_END" }[] = [
  { key: "OUT", label: "Forgot punch-out", kind: "MISSED_PUNCH", direction: "OUT" },
  { key: "IN", label: "Missed punch-in", kind: "MISSED_PUNCH", direction: "IN" },
  { key: "ADD", label: "Add a session", kind: "ADD_SESSION" },
  { key: "FIX", label: "Correct times", kind: "CORRECTION" },
  { key: "EXCUSE", label: "Excuse late / early", kind: "MARK_EXCUSE" },
  { key: "VOID", label: "Remove a session", kind: "VOID_SESSION" },
  { key: "MARK", label: "Mark the day", kind: "STATUS_OVERRIDE" },
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The `att-regularize` Modal (04-attendance/04 §17.3): SELF for oneself, ON_BEHALF / DIRECT for someone in scope. */
export function RegularizeModal({ open, onOpenChange, initial, onSaved, allowedModes = ["SELF"] }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: RegularizeInitial;
  onSaved?: () => void;
  allowedModes?: RequestMode[];
}) {
  const [mode, setMode] = useState<RequestMode>(initial?.mode ?? allowedModes[0]);
  const [employee, setEmployee] = useState<PickedEmployee | null>(initial?.employee ?? null);
  const [date, setDate] = useState(initial?.date ?? today());
  const [preset, setPreset] = useState<string>(() => {
    const found = PRESETS.find((p) => p.kind === initial?.kind && (!p.direction || p.direction === (initial?.direction ?? "OUT")));
    return found?.key ?? "OUT";
  });
  const [sessionId, setSessionId] = useState<number | null>(initial?.sessionId ?? null);
  const [at, setAt] = useState("18:00");
  const [inTime, setInTime] = useState("09:00");
  const [outTime, setOutTime] = useState("18:00");
  const [mark, setMark] = useState<"LATE" | "EARLY">("LATE");
  const [minutes, setMinutes] = useState(30);
  const [firstHalf, setFirstHalf] = useState("PRESENT");
  const [secondHalf, setSecondHalf] = useState("PRESENT");
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");
  const [files, setFiles] = useState<{ id: number; name: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [context, setContext] = useState<RequestFormContext | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<ReasonCode[]>([]);
  const [preview, setPreview] = useState<RequestPreview | null>(null);
  const [saving, setSaving] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const current = PRESETS.find((p) => p.key === preset) ?? PRESETS[0];
  const kind = current.kind;
  const needsEmployee = mode !== "SELF";
  const employeeId = needsEmployee ? employee?.id ?? null : null;

  // Reset when reopened with another target.
  useEffect(() => {
    if (!open) return;
    setDate(initial?.date ?? today());
    setSessionId(initial?.sessionId ?? null);
    setMode(initial?.mode ?? allowedModes[0]);
    setEmployee(initial?.employee ?? null);
    setFiles([]);
    setComment("");
    setAcknowledged(false);
    const found = PRESETS.find((p) => p.kind === initial?.kind && (!p.direction || p.direction === (initial?.direction ?? "OUT")));
    setPreset(found?.key ?? "OUT");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || (needsEmployee && !employeeId)) return;
    let cancelled = false;
    setContextError(null);
    requestsApi.form(date, mode, employeeId).then((ctx) => {
      if (cancelled) return;
      setContext(ctx);
      const target = ctx.sessions.find((s) => s.id === sessionId) ?? ctx.sessions[ctx.sessions.length - 1];
      if (target && (sessionId === null || !ctx.sessions.some((s) => s.id === sessionId))) setSessionId(target.id);
      if (target?.in) setInTime(target.in);
      if (target?.out) setOutTime(target.out);
    }).catch((e) => {
      if (!cancelled) { setContext(null); setContextError(toApiError(e).message); }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, date, mode, employeeId]);

  useEffect(() => {
    if (!open) return;
    requestsApi.reasons(kind).then((r) => {
      setReasons(r.items);
      setReason((prev) => (r.items.some((x) => x.code === prev) ? prev : r.items[0]?.code ?? ""));
    }).catch(() => setReasons([]));
  }, [open, kind]);

  const zone = context?.work_timezone ?? "UTC";
  const sessions = context?.sessions ?? [];
  const offered = PRESETS.filter((p) => !context || context.kinds.includes(p.kind));
  const needsSession = kind === "CORRECTION" || kind === "VOID_SESSION" || (kind === "MISSED_PUNCH" && current.direction !== "IN");

  const payload = useMemo(() => {
    const instant = (hhmm: string, after?: string) =>
      after && hhmm <= after ? zonedIso(nextDayIso(date), hhmm, zone) : zonedIso(date, hhmm, zone);
    switch (kind) {
      case "MISSED_PUNCH":
        if (current.direction === "IN") return { direction: "IN", at: instant(inTime), pair_out_at: instant(outTime, inTime) };
        return { direction: current.direction, at: instant(at, sessions.find((s) => s.id === sessionId)?.in ?? undefined) };
      case "ADD_SESSION":
        return { in_at: instant(inTime), out_at: instant(outTime, inTime) };
      case "CORRECTION":
        return { in_at: instant(inTime), out_at: instant(outTime, inTime) };
      case "MARK_EXCUSE":
        return date > today() ? { mark, minutes } : { mark };
      case "STATUS_OVERRIDE":
        return { first_half: firstHalf, second_half: secondHalf };
      default:
        return {};
    }
  }, [kind, current.direction, date, zone, at, inTime, outTime, mark, minutes, firstHalf, secondHalf, sessionId, sessions]);

  const body = useMemo(() => ({
    shift_date: date, kind, mode, employee_id: employeeId ?? undefined,
    session_id: needsSession ? sessionId ?? undefined : undefined, payload, reason_code: reason || undefined,
    comment: comment.trim() || undefined, attachment_ids: files.map((f) => f.id),
    acknowledged_warnings: acknowledged ? ["REQUEST_LIMIT_REACHED"] : [],
  }), [date, kind, mode, employeeId, needsSession, sessionId, payload, reason, comment, files, acknowledged]);
  const debounced = useDebounced(body, 400);

  useEffect(() => {
    if (!open || !context || (needsEmployee && !employeeId)) return;
    let cancelled = false;
    const { attachment_ids: _a, acknowledged_warnings: _w, ...rest } = debounced;
    void _a; void _w;
    requestsApi.preview(rest).then((p) => { if (!cancelled) setPreview(p); }).catch(() => { if (!cancelled) setPreview(null); });
    return () => { cancelled = true; };
  }, [open, context, debounced, needsEmployee, employeeId]);

  const blocking = preview?.issues.filter((i) => i.severity === "BLOCKING") ?? [];
  const overLimit = preview?.issues.find((i) => i.code === "REQUEST_LIMIT_REACHED" && i.severity === "WARNING");

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(list).slice(0, 5 - files.length)) {
        const saved = await requestsApi.upload(file, employeeId);
        setFiles((prev) => [...prev, { id: saved.id, name: saved.file_name }]);
      }
    } catch (e) {
      toast.error(toApiError(e).message);
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    setSaving(true);
    try {
      await requestsApi.create(body);
      toast.success(mode === "DIRECT" ? "Correction saved" : "Request sent for approval");
      onOpenChange(false);
      onSaved?.();
    } catch (e) {
      const error = toApiError(e);
      toast.error(ERROR_TEXT[error.code ?? ""] ? `${ERROR_TEXT[error.code ?? ""]} ${error.message}` : error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} size="lg"
      title={mode === "DIRECT" ? "Correct attendance" : "Request an attendance correction"}
      description={`Times are in ${zone.replace("_", " ")} time. Original punches are kept beside the correction.`}
      footer={(
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button data-testid="reg-submit" loading={saving}
            disabled={!reason || (needsEmployee && !employeeId) || blocking.length > 0 || (!!overLimit && !acknowledged) || !context}
            onClick={submit}>
            {mode === "DIRECT" ? "Save correction" : "Submit request"}
          </Button>
        </>
      )}>
      <div className="space-y-4" data-testid="att-regularize">
        {allowedModes.length > 1 && (
          <Field label="For">
            <Select data-testid="reg-mode" value={mode} onChange={(e) => setMode(e.target.value as RequestMode)}>
              {allowedModes.map((m) => <option key={m} value={m}>{m === "SELF" ? "Me" : m === "ON_BEHALF" ? "Someone (needs approval)" : "Someone (HR direct edit)"}</option>)}
            </Select>
          </Field>
        )}
        {needsEmployee && (
          <Field label="Employee" required>
            <EmployeePicker value={employee} onChange={setEmployee} />
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date" required>
            <Input data-testid="reg-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          {context?.day && (
            <div className="self-end rounded-xl bg-muted px-3 py-2 text-xs" data-testid="reg-day-now">
              Now: <b>{context.day.day_result.replace("_", " ").toLowerCase()}</b>
              {context.day.exception_codes.length > 0 && <> · {context.day.exception_codes.slice(0, 2).join(", ").toLowerCase().replace(/_/g, " ")}</>}
            </div>
          )}
        </div>
        {contextError && <p className="text-sm text-danger">{contextError}</p>}

        <fieldset>
          <legend className="mb-2 text-sm font-medium">What happened?</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup">
            {offered.map((p) => (
              <motion.button key={p.key} type="button" role="radio" aria-checked={preset === p.key} whileTap={{ scale: 0.96 }}
                data-testid={`reg-kind-${p.key}`} onClick={() => setPreset(p.key)}
                className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${preset === p.key
                  ? "border-primary bg-primary-soft text-primary" : "border-border hover:bg-muted"}`}>
                {p.label}
              </motion.button>
            ))}
          </div>
        </fieldset>

        <AnimatePresence mode="wait">
          <motion.div key={preset} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }} className="space-y-4">
            {needsSession && (
              <Field label="Session" required>
                <Select data-testid="reg-session" value={sessionId ?? ""} onChange={(e) => setSessionId(Number(e.target.value) || null)}>
                  {sessions.length === 0 && <option value="">No session on this date</option>}
                  {sessions.map((s) => <option key={s.id} value={s.id}>{s.in ?? "—"} – {s.out ?? "no punch-out"} · {s.source.toLowerCase()}</option>)}
                </Select>
              </Field>
            )}
            {kind === "MISSED_PUNCH" && current.direction !== "IN" && (
              <Field label={current.direction === "OUT" ? "Punch-out time" : "Break end time"} required hint={`${zone} time`}>
                <Input data-testid="reg-time-at" type="time" value={at} onChange={(e) => setAt(e.target.value)} />
              </Field>
            )}
            {(kind === "ADD_SESSION" || kind === "CORRECTION" || (kind === "MISSED_PUNCH" && current.direction === "IN")) && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Start" required><Input data-testid="reg-time-in" type="time" value={inTime} onChange={(e) => setInTime(e.target.value)} /></Field>
                <Field label="End" required hint={outTime <= inTime ? "Ends the next day" : undefined}>
                  <Input data-testid="reg-time-out" type="time" value={outTime} onChange={(e) => setOutTime(e.target.value)} />
                </Field>
              </div>
            )}
            {kind === "MARK_EXCUSE" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Excuse">
                  <Select data-testid="reg-mark" value={mark} onChange={(e) => setMark(e.target.value as "LATE" | "EARLY")}>
                    <option value="LATE">Late arrival</option><option value="EARLY">Early exit</option>
                  </Select>
                </Field>
                {date > today() ? (
                  <Field label="Minutes"><Input type="number" min={1} max={480} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} /></Field>
                ) : <p className="self-end text-xs text-muted-foreground">The minutes come from the recorded day; the mark stays, shown as excused.</p>}
              </div>
            )}
            {kind === "STATUS_OVERRIDE" && (
              <div className="grid gap-4 sm:grid-cols-2">
                {([["First half", firstHalf, setFirstHalf], ["Second half", secondHalf, setSecondHalf]] as const).map(([label, value, set]) => (
                  <Field key={label} label={label}>
                    <Select value={value} onChange={(e) => set(e.target.value)}><option value="PRESENT">Present</option><option value="ABSENT">Absent</option></Select>
                  </Field>
                ))}
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Reason" required>
            <Select data-testid="reg-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
              {reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
            </Select>
          </Field>
          <Field label="Evidence" hint={reasons.find((r) => r.code === reason)?.sensitive
            ? "No medical details are needed: upload only what shows the dates." : "PDF, PNG or JPEG · max 5 MB"}>
            <label className="flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-border px-3 text-sm hover:bg-muted">
              <FileUp className="h-4 w-4" /> {uploading ? "Uploading…" : "Attach a file"}
              <input data-testid="reg-file" type="file" className="sr-only" accept="application/pdf,image/png,image/jpeg"
                onChange={(e) => void upload(e.target.files)} />
            </label>
          </Field>
        </div>
        {files.length > 0 && (
          <ul className="flex flex-wrap gap-2" data-testid="reg-files">
            {files.map((f) => (
              <li key={f.id}><Badge tone="info">{f.name}
                <button type="button" aria-label={`Remove ${f.name}`} className="ml-1" onClick={() => setFiles((prev) => prev.filter((x) => x.id !== f.id))}><X className="h-3 w-3" /></button>
              </Badge></li>
            ))}
          </ul>
        )}
        <Field label="Comment" hint={`${comment.length}/1000`}>
          <Textarea data-testid="reg-comment" maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)}
            placeholder={reason === "OTHER" ? "Explain what happened (required for Other)" : "Optional"} />
        </Field>

        <PreviewPanel preview={preview} />
        {overLimit && (
          <label className="flex items-center gap-2 text-sm text-warning" data-testid="reg-ack">
            <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
            {overLimit.message} File anyway on their behalf.
          </label>
        )}
      </div>
    </Modal>
  );
}

function PreviewPanel({ preview }: { preview: RequestPreview | null }) {
  if (!preview) return null;
  const route = preview.route_preview;
  return (
    <motion.section layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2 rounded-2xl border border-border bg-surface-muted/40 p-3 text-sm"
      data-testid="reg-preview">
      {preview.issues.map((issue) => (
        <p key={issue.code + issue.message} className={`flex items-start gap-2 ${issue.severity === "BLOCKING" ? "text-danger" : "text-warning"}`}
          data-testid={`reg-issue-${issue.code}`}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {issue.message}
        </p>
      ))}
      {preview.issues.length === 0 && <p className="flex items-center gap-2 text-success"><CheckCircle2 className="h-4 w-4" /> Ready to send</p>}
      {route && (
        <p className="flex items-center gap-2" data-testid="reg-route">
          <Route className="h-4 w-4 text-muted-foreground" />
          Goes to: {route.steps.map((s) => `${s.approvers.filter(Boolean).join(" or ") || "an approver"} (${s.label})`).join(" → ")}
          {" · "}due within {route.sla_hours} h
        </p>
      )}
      {preview.limit_usage.map((u) => (
        <p key={u.limit_index} className="flex items-center gap-2 text-muted-foreground" data-testid="reg-usage">
          <Clock className="h-4 w-4" /> {u.kinds.map((k) => KIND_LABELS[k as RequestKind] ?? k).join(", ")}: {u.used} of {u.limit ?? "∞"} used this period
        </p>
      ))}
      {preview.payroll_state.message && <Badge tone="warning">{preview.payroll_state.message}</Badge>}
    </motion.section>
  );
}
