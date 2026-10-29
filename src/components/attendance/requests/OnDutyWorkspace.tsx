"use client";

import { motion } from "framer-motion";
import { Briefcase, CalendarX2, Home, Route } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { EmployeePicker, type PickedEmployee } from "@/components/shared/EmployeePicker";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { DataTable, EmptyState, PageHeader } from "@/components/ui/layout";
import { Badge, Card, CardHeader } from "@/components/ui/primitives";
import { toApiError } from "@/lib/api";
import { can, canBeyondSelf } from "@/lib/access";
import { ERROR_TEXT, requestsApi, type OnDutyRow, type ReasonCode, type RoutePreview } from "@/lib/attendanceRequests";
import { fmtDate } from "@/lib/format";
import { useApi, useDebounced } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";

type Kind = "ON_DUTY" | "REMOTE_WORK";
const COPY: Record<Kind, { title: string; description: string; icon: typeof Briefcase; reason: string }> = {
  ON_DUTY: { title: "On duty", icon: Briefcase, reason: "Where and why (client, site, travel)",
    description: "Field work, client visits and official travel count as present, without geofence checks." },
  REMOTE_WORK: { title: "Remote work", icon: Home, reason: "Why you work remotely",
    description: "Work from home or another place on a day planned at the office, without geofence penalties." },
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** `/attendance/on-duty` and `/attendance/remote-work` (04-attendance/04 §5, §17.5): one form, one list per kind. */
export function OnDutyWorkspace({ kind }: { kind: Kind }) {
  const { me } = useCan();
  const copy = COPY[kind];
  const onBehalf = can(me, P.ATTENDANCE_REQUEST_ON_BEHALF);
  const [forOther, setForOther] = useState(false);
  const [employee, setEmployee] = useState<PickedEmployee | null>(null);
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState(today());
  const [portion, setPortion] = useState("FULL");
  const [partial, setPartial] = useState(false);
  const [startTime, setStartTime] = useState("14:00");
  const [endTime, setEndTime] = useState("18:00");
  const [reasonCode, setReasonCode] = useState("OFFICIAL_WORK");
  const [reason, setReason] = useState("");
  const [reasons, setReasons] = useState<ReasonCode[]>([]);
  const [plan, setPlan] = useState<{ dates: { date: string; portion: string }[]; skipped_dates: { date: string; reason: string }[];
    route_preview?: RoutePreview } | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { data, loading, reload } = useApi(() => requestsApi.onDuty({ kind, mine: !canBeyondSelf(me, P.ATTENDANCE_READ) }), [kind]);

  useEffect(() => {
    requestsApi.reasons("ON_DUTY").then((r) => setReasons(r.items)).catch(() => setReasons([]));
  }, []);

  const body = useMemo(() => ({
    kind, start, end, portion, reason: reason.trim() || "-", reason_code: reasonCode,
    employee_id: forOther ? employee?.id : undefined,
    ...(partial ? { start_time: startTime, end_time: endTime } : {}),
  }), [kind, start, end, portion, reason, reasonCode, forOther, employee, partial, startTime, endTime]);
  const debounced = useDebounced(body, 400);

  useEffect(() => {
    if (forOther && !employee) return;
    let cancelled = false;
    requestsApi.fileOnDuty({ ...debounced, dry_run: true }).then((p) => {
      if (!cancelled) { setPlan(p); setPlanError(null); }
    }).catch((e) => {
      if (!cancelled) { setPlan(null); const err = toApiError(e); setPlanError(ERROR_TEXT[err.code ?? ""] ? `${ERROR_TEXT[err.code ?? ""]} ${err.message}` : err.message); }
    });
    return () => { cancelled = true; };
  }, [debounced, forOther, employee]);

  const submit = async () => {
    setSaving(true);
    try {
      await requestsApi.fileOnDuty({ ...body, reason: reason.trim() });
      toast.success(`${copy.title} request sent for approval`);
      setReason("");
      await reload();
    } catch (e) {
      toast.error(toApiError(e).message);
    } finally {
      setSaving(false);
    }
  };

  const cancel = async (row: OnDutyRow) => {
    try {
      await requestsApi.cancelOnDuty(row.id);
      toast.success("Cancelled");
      await reload();
    } catch (e) {
      toast.error(toApiError(e).message);
    }
  };

  const Icon = copy.icon;
  return (
    <div>
      <PageHeader title={copy.title} description={copy.description} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,460px)_1fr]">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="space-y-4 p-5" data-testid="on-duty-form">
            <CardHeader title={`New ${copy.title.toLowerCase()} request`} />
            {onBehalf && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={forOther} onChange={(e) => setForOther(e.target.checked)} /> For someone else
              </label>
            )}
            {forOther && <Field label="Employee" required><EmployeePicker value={employee} onChange={setEmployee} /></Field>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="From" required><Input data-testid="od-start" type="date" value={start}
                onChange={(e) => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value); }} /></Field>
              <Field label="To" required><Input data-testid="od-end" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Portion">
                <Select data-testid="od-portion" value={portion} disabled={partial} onChange={(e) => setPortion(e.target.value)}>
                  <option value="FULL">Full day</option><option value="FIRST_HALF">First half</option><option value="SECOND_HALF">Second half</option>
                </Select>
              </Field>
              <label className="flex items-end gap-2 pb-2 text-sm">
                <input type="checkbox" checked={partial} onChange={(e) => setPartial(e.target.checked)} /> Part of the day (times)
              </label>
            </div>
            {partial && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="From time"><Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></Field>
                <Field label="To time"><Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></Field>
              </div>
            )}
            <Field label="Reason code">
              <Select data-testid="od-reason-code" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
                {reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
              </Select>
            </Field>
            <Field label={copy.reason} required hint={`${reason.length}/500`}>
              <Textarea data-testid="od-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <section className="space-y-1 rounded-2xl bg-muted/60 p-3 text-sm" data-testid="od-plan">
              {planError ? <p className="text-danger">{planError}</p> : plan ? (
                <>
                  <p><b>{plan.dates.length}</b> day(s): {plan.dates.map((d) => fmtDate(d.date, "EEE d MMM")).join(", ")}</p>
                  {plan.skipped_dates.map((s) => (
                    <p key={s.date} className="flex items-center gap-1.5 text-muted-foreground"><CalendarX2 className="h-3.5 w-3.5" />
                      {fmtDate(s.date, "EEE d MMM")} skipped: {s.reason.toLowerCase().replace("_", " ")}</p>
                  ))}
                  {plan.route_preview && (
                    <p className="flex items-center gap-1.5"><Route className="h-3.5 w-3.5" /> Goes to: {plan.route_preview.steps
                      .map((s) => s.approvers.filter(Boolean).join(" or ") || s.label).join(" → ")}</p>
                  )}
                </>
              ) : <p className="text-muted-foreground">Checking dates…</p>}
            </section>
            <Button data-testid="od-submit" className="w-full" loading={saving} disabled={!reason.trim() || !plan || (forOther && !employee)}
              onClick={submit}><Icon className="h-4 w-4" /> Send for approval</Button>
          </Card>
        </motion.div>
        <Card>
          <CardHeader title="Requests" description="One approval covers every day of a trip." />
          <DataTable rows={data?.items} loading={loading && !data} rowKey={(r) => r.id}
            empty={<EmptyState icon={<Icon />} title={`No ${copy.title.toLowerCase()} yet`} />}
            columns={[
              { key: "who", header: "Employee", cell: (r) => r.employee_name ?? "—", hideOnMobile: true },
              { key: "date", header: "Date", cell: (r) => fmtDate(r.date, "EEE, d MMM") },
              { key: "portion", header: "Portion", cell: (r) => r.start_time ? `${r.start_time}–${r.end_time}` : r.portion.toLowerCase().replace("_", " ") },
              { key: "status", header: "Status", cell: (r) => <Badge tone={r.status === "APPROVED" ? "success" : r.status === "PENDING" ? "warning" : "neutral"} dot>
                <span data-testid="od-status">{r.status.toLowerCase()}</span></Badge> },
              { key: "act", header: "", cell: (r) => (r.status === "PENDING" || r.status === "APPROVED")
                ? <Button size="sm" variant="ghost" onClick={() => void cancel(r)}>Cancel</Button> : null },
            ]} />
        </Card>
      </div>
    </div>
  );
}
