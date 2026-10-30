"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CalendarCheck2, CheckCircle2, Eye, Info, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { EmployeePicker, type PickedEmployee } from "@/components/shared/EmployeePicker";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Badge, Card, MotionSafe } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { fmtDate, todayISO } from "@/lib/format";
import { leaveAdminApi } from "@/lib/leave/adminApi";
import type { RecordBody, RecordPreview } from "@/lib/leave/adminTypes";

import { ErrorNotice, fmtUnits, useLeaveTypes } from "../shared";

const SEVERITY = {
  ERROR: { icon: XCircle, cls: "border-danger/40 bg-danger-soft text-danger" },
  WARNING: { icon: AlertTriangle, cls: "border-warning/40 bg-warning-soft text-warning" },
  INFO: { icon: Info, cls: "border-info/30 bg-info-soft text-info" },
} as const;

/**
 * Record leave for an employee (`POST /leaves/record/preview` → `POST /leaves/record`): HR enters leave that already
 * happened or was agreed outside the system. The preview shows charged days, balance and every rule finding first.
 */
export function RecordLeaveTab() {
  const types = useLeaveTypes(false);
  const [employee, setEmployee] = useState<PickedEmployee | null>(null);
  const [form, setForm] = useState<Omit<RecordBody, "employee_id">>({
    leave_type: "", start_date: todayISO(), end_date: todayISO(), start_portion: "FULL", end_portion: "FULL", reason: "",
  });
  const [preview, setPreview] = useState<RecordPreview | null>(null);
  const [busy, setBusy] = useState<"preview" | "record" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  useEffect(() => {
    setPreview(null);
    setError(null);
  }, [employee, form]);

  const body = (): RecordBody | null => {
    const found: Record<string, string> = {};
    if (!employee) found.employee = "Choose the employee.";
    if (!form.leave_type) found.leave_type = "Choose a leave type.";
    if (!form.start_date) found.start_date = "Choose the first day.";
    if (!form.end_date) found.end_date = "Choose the last day.";
    if (form.start_date && form.end_date && form.end_date < form.start_date) found.end_date = "The last day is before the first.";
    setErrors(found);
    if (Object.keys(found).length || !employee) return null;
    return { ...form, employee_id: employee.id, reason: form.reason?.trim() || null };
  };
  const runPreview = async () => {
    const b = body();
    if (!b) return;
    setBusy("preview");
    setError(null);
    try {
      setPreview(await leaveAdminApi.recordPreview(b));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  const record = async () => {
    const b = body();
    if (!b || !preview || preview.blocking) return;
    setBusy("record");
    setError(null);
    try {
      const created = await leaveAdminApi.record(b);
      toast.success(`Leave recorded for ${employee?.full_name} (request #${created.id})`);
      setForm((f) => ({ ...f, reason: "" }));
      setPreview(null);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const selected = (types.data ?? []).find((t) => t.code === form.leave_type);
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]" data-testid="record-tab">
      <Card className="space-y-4 p-5">
        <div>
          <h3 className="font-semibold">Record leave</h3>
          <p className="text-sm text-muted-foreground">For leave agreed outside the system. It is recorded as approved and charged to the balance.</p>
        </div>
        <Field label="Employee" required error={errors.employee}>
          <EmployeePicker value={employee} onChange={setEmployee} id="record-employee" />
        </Field>
        <Field label="Leave type" required error={errors.leave_type}>
          <Select value={form.leave_type} onChange={(e) => set({ leave_type: e.target.value })} data-testid="record-type">
            <option value="">Choose…</option>
            {(types.data ?? []).map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First day" required error={errors.start_date}><Input type="date" value={form.start_date} onChange={(e) => set({ start_date: e.target.value })} data-testid="record-start" /></Field>
          <Field label="Last day" required error={errors.end_date}><Input type="date" value={form.end_date} onChange={(e) => set({ end_date: e.target.value })} data-testid="record-end" /></Field>
          {selected?.allow_half_day !== false && (
            <>
              <Field label="First day portion">
                <Select value={form.start_portion} onChange={(e) => set({ start_portion: e.target.value as RecordBody["start_portion"] })}>
                  <option value="FULL">Full day</option>
                  <option value="SECOND_HALF">Second half only</option>
                </Select>
              </Field>
              <Field label="Last day portion">
                <Select value={form.end_portion} onChange={(e) => set({ end_portion: e.target.value as RecordBody["end_portion"] })}>
                  <option value="FULL">Full day</option>
                  <option value="FIRST_HALF">First half only</option>
                </Select>
              </Field>
            </>
          )}
        </div>
        <Field label="Reason">
          <Textarea rows={2} maxLength={1000} value={form.reason ?? ""} onChange={(e) => set({ reason: e.target.value })} />
        </Field>
        <ErrorNotice error={error} />
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="secondary" onClick={() => void runPreview()} loading={busy === "preview"} data-testid="record-preview">
            <Eye className="h-4 w-4" /> Preview
          </Button>
          <Button onClick={() => void record()} loading={busy === "record"} disabled={!preview || preview.blocking} data-testid="record-submit">
            <CalendarCheck2 className="h-4 w-4" /> Record leave
          </Button>
        </div>
      </Card>

      <MotionSafe>
        <AnimatePresence mode="wait">
          {preview ? (
            <motion.div key="preview" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
              <Card className="space-y-4 p-5" data-testid="record-preview-result">
                <div className="flex flex-wrap items-center gap-3">
                  {preview.blocking ? <XCircle className="h-5 w-5 text-danger" aria-hidden /> : <CheckCircle2 className="h-5 w-5 text-success" aria-hidden />}
                  <h3 className="flex-1 font-semibold">{preview.employee_name} · {preview.leave_type_name}</h3>
                  <Badge tone={preview.blocking ? "danger" : "success"} dot>{preview.blocking ? "Cannot be recorded" : "Ready to record"}</Badge>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-xl bg-surface-muted/60 p-3"><p className="text-xs text-muted-foreground">Charged</p><p className="text-xl font-semibold tabular-nums">{fmtUnits(preview.charged_units)}</p></div>
                  <div className="rounded-xl bg-surface-muted/60 p-3"><p className="text-xs text-muted-foreground">Balance before</p><p className="text-xl font-semibold tabular-nums">{preview.unlimited ? "∞" : fmtUnits(preview.balance_before)}</p></div>
                  <div className="rounded-xl bg-surface-muted/60 p-3"><p className="text-xs text-muted-foreground">Balance after</p><p className={cn("text-xl font-semibold tabular-nums", (preview.balance_after ?? 0) < 0 && "text-danger")}>{preview.unlimited ? "∞" : fmtUnits(preview.balance_after)}</p></div>
                </div>
                {preview.issues.length > 0 && (
                  <ul className="space-y-2">
                    {preview.issues.map((issue, i) => {
                      const meta = SEVERITY[issue.severity] ?? SEVERITY.INFO;
                      const Icon = meta.icon;
                      return (
                        <li key={`${issue.code}-${i}`} className={cn("flex gap-2 rounded-xl border px-3 py-2 text-sm", meta.cls)}>
                          <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                          <span className="text-foreground">{issue.message}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {preview.split && <p className="text-sm text-muted-foreground">{fmtUnits(preview.split.units)} unit(s) become {preview.split.leave_type ?? "unpaid"} leave.</p>}
                <div className="scrollbar-thin max-h-64 overflow-auto rounded-xl border border-border">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Charged days</caption>
                    <thead className="bg-surface-muted text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Charged</th><th className="px-3 py-2">Note</th></tr></thead>
                    <tbody>
                      {preview.days.map((d) => (
                        <tr key={d.date} className="border-t border-border/70">
                          <td className="px-3 py-1.5">{fmtDate(d.date, "EEE d MMM")}</td>
                          <td className="px-3 py-1.5 tabular-nums">{fmtUnits(d.charged)}</td>
                          <td className="px-3 py-1.5 text-xs text-muted-foreground">{d.holiday ? "Holiday" : d.weekly_off ? "Weekly off" : d.charge_reason ? d.charge_reason.toLowerCase().replace(/_/g, " ") : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </motion.div>
          ) : (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Card className="flex h-full min-h-[16rem] flex-col items-center justify-center p-8 text-center text-sm text-muted-foreground">
                <Eye className="mb-3 h-6 w-6" aria-hidden />
                Preview shows the charged days, the balance before and after and every rule finding before anything is recorded.
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </MotionSafe>
    </div>
  );
}
