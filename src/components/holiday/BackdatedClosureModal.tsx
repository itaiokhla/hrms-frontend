"use client";

/**
 * "Declare emergency closure" (LH 04-holiday/01 §5.8; LH-HOL-24): a flood, strike or power cut recorded for today
 * or up to `holiday.backdate_days` back on a published calendar year. Step 1 the closure (calendar, date, name,
 * portion, type, category, mandatory reason); step 2 the warning — who was scheduled (and on which shift), attendance
 * sessions that become holiday work, approved and pending leave that is recounted, pay periods already locked or
 * finalized (then the date must be typed to confirm, and payroll gets retro). Confirm records it as an amendment.
 */

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CalendarX2, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

import { Notice } from "@/components/payroll/inputs/shared";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { Badge } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { rolloverApi, type ClosureResult, type HolidayCategory, type RolloverItem } from "@/lib/holiday/api";

const STATE_LABEL = { OPEN: "Open", INPUT_LOCKED: "Inputs locked", FINALIZED: "Finalized" } as const;

export interface BackdatedClosureModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Calendars the person may publish on; the closure's year must be published. */
  calendars: Pick<RolloverItem, "calendar_id" | "code" | "name">[];
  defaultCalendarId?: number | null;
  /** The tenant's local today (the date input never goes past it). */
  today: string;
  backdateDays?: number;
  onRecorded: (calendarId: number, date: string, result: ClosureResult) => void;
}

const EMPTY = { name: "Emergency closure", date: "", category: "EMERGENCY" as HolidayCategory, holiday_type: "COMPANY" as "COMPANY" | "PUBLIC", reason: "" };

export function BackdatedClosureModal({ open, onOpenChange, calendars, defaultCalendarId, today, backdateDays = 7, onRecorded }: BackdatedClosureModalProps) {
  const [calendarId, setCalendarId] = useState<number | null>(defaultCalendarId ?? calendars[0]?.calendar_id ?? null);
  const [form, setForm] = useState({ ...EMPTY, date: today });
  const [preview, setPreview] = useState<ClosureResult | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const earliest = (() => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - backdateDays);
    return d.toISOString().slice(0, 10);
  })();
  const valid = !!calendarId && !!form.date && form.reason.trim().length > 0 && form.name.trim().length > 0;

  const reset = () => {
    setPreview(null);
    setTyped("");
    setError(null);
  };
  const close = (o: boolean) => {
    if (!o) {
      reset();
      setForm({ ...EMPTY, date: today });
    }
    onOpenChange(o);
  };

  const body = () => ({ date: form.date, name: form.name.trim(), category: form.category, holiday_type: form.holiday_type, reason: form.reason.trim(), portion: "FULL" as const });

  const check = async () => {
    if (!calendarId) return;
    setBusy(true);
    setError(null);
    try {
      setPreview(await rolloverApi.closure(calendarId, { ...body(), dry_run: true }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!calendarId || !preview) return;
    setBusy(true);
    setError(null);
    try {
      const warnings = (preview.impact?.warnings ?? []).filter((w) => w.confirm).map((w) => w.code);
      const result = await rolloverApi.closure(calendarId, { ...body(), confirm_date: typed || undefined, acknowledged_warnings: warnings });
      toast.success(result.status === "PENDING_SECOND_PERSON" ? "Closure waits for a second publisher" : `${form.name} recorded for ${fmtDate(form.date)}`);
      onRecorded(calendarId, form.date, result);
      close(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const totals = preview?.closure.totals;
  const locked = preview?.closure.requires_typed_confirm ?? false;

  return (
    <Modal
      open={open}
      onOpenChange={close}
      size="lg"
      title={preview ? "Check the closure's impact" : "Declare emergency closure"}
      description={preview ? undefined : `Record a closure for today or up to ${backdateDays} days back. Approved leave on that date is credited back.`}
      footer={
        preview ? (
          <>
            <Button variant="secondary" onClick={reset}>Back</Button>
            <Button variant="danger" onClick={() => void confirm()} loading={busy} disabled={locked && typed !== form.date} data-testid="closure-confirm">
              <CalendarX2 className="h-4 w-4" /> Record closure
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={() => close(false)}>Cancel</Button>
            <Button onClick={() => void check()} loading={busy} disabled={!valid} data-testid="closure-check">Check impact</Button>
          </>
        )
      }
    >
      <AnimatePresence mode="wait">
        {!preview ? (
          <motion.div key="form" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4" data-testid="closure-form">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Calendar" required htmlFor="closure-calendar">
                <Select id="closure-calendar" value={calendarId ?? ""} onChange={(e) => setCalendarId(Number(e.target.value))}>
                  {calendars.map((c) => (
                    <option key={c.calendar_id} value={c.calendar_id}>{c.code} — {c.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Date" required htmlFor="closure-date">
                <Input id="closure-date" type="date" min={earliest} max={today} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </Field>
              <Field label="Name" required htmlFor="closure-name">
                <Input id="closure-name" maxLength={150} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="Category" htmlFor="closure-category">
                <Select id="closure-category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as HolidayCategory })}>
                  <option value="EMERGENCY">Emergency</option>
                  <option value="SHUTDOWN">Shutdown</option>
                  <option value="ELECTION">Election</option>
                  <option value="OTHER">Other</option>
                </Select>
              </Field>
              <Field label="Type" htmlFor="closure-type" hint="Paid as its type in payroll.">
                <Select id="closure-type" value={form.holiday_type} onChange={(e) => setForm({ ...form, holiday_type: e.target.value as "COMPANY" | "PUBLIC" })}>
                  <option value="COMPANY">Company</option>
                  <option value="PUBLIC">Public</option>
                </Select>
              </Field>
            </div>
            <Field label="Emergency reason" required htmlFor="closure-reason" hint="Kept in the calendar history; employees see the holiday name only.">
              <Textarea id="closure-reason" rows={2} maxLength={500} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. Office flooded after heavy rain" />
            </Field>
            {(form.category === "EMERGENCY" || form.category === "SHUTDOWN") && (
              <p className="text-xs text-muted-foreground">Not paid? Record unpaid leave for the affected employees instead.</p>
            )}
            {error && <Notice tone="danger" title={error} />}
          </motion.div>
        ) : (
          <motion.div key="impact" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4" data-testid="closure-impact">
            <Notice tone={locked ? "danger" : "warning"} title={`${form.name} on ${fmtDate(form.date)} changes ${totals?.employees ?? 0} employee(s)' day`}>
              <ul className="mt-1 grid gap-1 text-sm sm:grid-cols-2" data-testid="closure-totals">
                <li>{totals?.scheduled ?? 0} were scheduled to work ({totals?.on_shift ?? 0} on a shift)</li>
                <li>{totals?.attendance_sessions ?? 0} attendance session(s) become holiday work</li>
                <li>{totals?.approved_leave ?? 0} approved leave request(s) credited back</li>
                <li>{totals?.pending_leave ?? 0} pending leave request(s) re-previewed</li>
                <li>{totals?.input_locked ?? 0} in pay periods with locked inputs</li>
                <li>{totals?.finalized ?? 0} in finalized pay periods (retro)</li>
              </ul>
            </Notice>
            <div className="max-h-56 overflow-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface-muted text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Employee</th>
                    <th className="px-3 py-2">Shift</th>
                    <th className="px-3 py-2">Leave / attendance</th>
                    <th className="px-3 py-2">Pay period</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.closure.employees.map((e) => (
                    <tr key={e.employee_id} className="border-t border-border" data-testid={`closure-employee-${e.employee_id}`}>
                      <td className="px-3 py-2 font-medium">{e.name ?? `#${e.employee_id}`}</td>
                      <td className="px-3 py-2 text-muted-foreground">{e.scheduled ? e.shift ?? "Standard day" : "Day off"}</td>
                      <td className="px-3 py-2">
                        {e.approved_leave_ids.length > 0 && <Badge tone="info">Leave credited</Badge>}
                        {e.pending_leave && <Badge tone="warning">Pending leave</Badge>}
                        {e.attendance_session && <Badge tone="primary">Worked</Badge>}
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={e.period_state === "OPEN" ? "neutral" : e.period_state === "FINALIZED" ? "danger" : "warning"}>{STATE_LABEL[e.period_state]}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.requires_second_person && <Notice tone="info" title="A second holiday publisher completes this closure." />}
            {locked && (
              <Field label={`A locked pay period is affected. Type ${form.date} to confirm.`} required htmlFor="closure-typed">
                <Input id="closure-typed" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={form.date} data-testid="closure-typed" />
              </Field>
            )}
            {!locked && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-success" /> No locked pay period: payroll recalculates at its next run.
              </p>
            )}
            {error && (
              <p className="flex items-center gap-1.5 text-sm text-danger">
                <AlertTriangle className="h-4 w-4" /> {error}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </Modal>
  );
}
