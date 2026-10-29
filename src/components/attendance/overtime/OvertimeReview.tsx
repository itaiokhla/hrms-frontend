"use client";

import { motion } from "framer-motion";
import { CalendarClock, CheckCircle2, Coins, Gift, RefreshCw, ShieldAlert, Sparkles } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { DataTable, EmptyState, ErrorState, Pagination, type Column } from "@/components/ui/layout";
import { Sheet } from "@/components/ui/overlay";
import { Badge, Card, Skeleton } from "@/components/ui/primitives";
import { fmtDate, fmtTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { fmtMinutes, insightsApi, type OvertimeQueueItem } from "@/lib/attendanceInsights";

const LIMIT = 25;
const iso = (d: Date) => d.toISOString().slice(0, 10);

function CapMeter({ label, used, limit, rolling }: { label: string; used: number; limit: number; rolling: number | null }) {
  const pct = Math.min(100, Math.round((used / Math.max(limit, 1)) * 100));
  const tone = used > limit ? "bg-danger" : pct >= 90 ? "bg-warning" : "bg-primary";
  return (
    <div className="space-y-1" data-testid="ot-cap">
      <div className="flex justify-between text-xs"><span>{label}</span><span className="tabular-nums">{fmtMinutes(used)} of {fmtMinutes(limit)}</span></div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <motion.div className={`h-full ${tone}`} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.4 }} />
      </div>
      {rolling !== null && <p className="text-[11px] text-muted-foreground">Rolling 3 months: {fmtMinutes(rolling)}</p>}
    </div>
  );
}

/** The approval context of one entry (04-attendance/05 §7): attendance day, caps and consent. */
function ContextPanel({ id }: { id: number }) {
  const { data, error } = useApi(() => insightsApi.overtimeContext(id), [id]);
  if (error) return <ErrorState message={error.message} />;
  if (!data) return <Skeleton className="h-48" />;
  const day = data.attendance_day;
  return (
    <div className="space-y-5 text-sm" data-testid="ot-context">
      <div className="flex flex-wrap gap-2">
        <Badge tone={data.origin === "ATTENDANCE" ? "primary" : "neutral"}>{data.origin === "ATTENDANCE" ? "Proposed from attendance" : "Requested by a person"}</Badge>
        {data.policy && <Badge tone="neutral">{data.policy.combination.toLowerCase().replace(/_/g, " ")} threshold</Badge>}
        {data.policy?.comp_off_allowed && <Badge tone="info">Comp-off allowed</Badge>}
      </div>
      {day ? (
        <div className="rounded-2xl border border-border p-3">
          <p className="mb-2 font-semibold">Attendance day · {fmtDate(data.date)} <span className="text-xs font-normal text-muted-foreground">v{day.version} · {day.evaluation_state.toLowerCase()}</span></p>
          <dl className="grid grid-cols-2 gap-2">
            <div><dt className="text-xs text-muted-foreground">First in / last out</dt><dd>{day.first_in_at ? fmtTime(day.first_in_at) : "—"} – {day.last_out_at ? fmtTime(day.last_out_at) : "—"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Shift end</dt><dd>{day.expected_end_at ? fmtTime(day.expected_end_at) : "—"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Worked (net)</dt><dd>{fmtMinutes(day.net_minutes)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Overtime (before payroll rules)</dt><dd className="font-semibold" data-testid="ot-context-candidate">{fmtMinutes(day.ot_candidate_minutes)}</dd></div>
          </dl>
          {day.exceptions.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Exceptions: {day.exceptions.join(", ").toLowerCase().replace(/_/g, " ")}</p>}
        </div>
      ) : <p className="text-muted-foreground">No evaluated attendance day for this date.</p>}
      <div className="space-y-3 rounded-2xl border border-border p-3">
        <p className="font-semibold">Caps</p>
        {data.caps.length ? data.caps.map((c) => c.used_minutes !== null && (
          <CapMeter key={c.window} label={c.window.replace("per_", "Per ")} used={c.used_minutes} limit={c.limit_minutes} rolling={c.rolling_used_minutes} />
        )) : <p className="text-xs text-muted-foreground">No cap in the overtime policy. Quarter so far: {fmtMinutes(data.usage.quarter.minutes)}.</p>}
      </div>
      <div className="rounded-2xl border border-border p-3" data-testid="ot-consent" data-required={data.consent.required ? "yes" : "no"}>
        <p className="font-semibold">Consent</p>
        {!data.consent.required ? <p className="text-xs text-muted-foreground">Not required by the country pack.</p>
          : data.consent.on_file ? <p className="flex items-center gap-1.5 text-success"><CheckCircle2 className="h-4 w-4" aria-hidden /> On file</p>
            : <p className="flex items-center gap-1.5 text-danger"><ShieldAlert className="h-4 w-4" aria-hidden /> Consent not on file{data.consent.enforced ? " — record it before approving" : ""}</p>}
      </div>
    </div>
  );
}

/** Overtime › Review: pending overtime with the attendance candidate, one-click pay or comp-off (G-18). */
export function OvertimeReview() {
  const [skip, setSkip] = useState(0);
  const [openId, setOpenId] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const today = new Date();
  const [from, setFrom] = useState(iso(new Date(today.getTime() - 14 * 86_400_000)));
  const [to, setTo] = useState(iso(new Date(today.getTime() - 86_400_000)));
  const { data, error, loading, reload } = useApi(() => insightsApi.overtimeQueue(skip, LIMIT), [skip]);

  const decide = async (row: OvertimeQueueItem, outcome: "PAY" | "COMP_OFF") => {
    setBusy(`${outcome}-${row.id}`);
    try {
      await insightsApi.convert(row.id, outcome);
      toast.success(outcome === "PAY" ? "Approved for payroll" : "Approved as comp-off (credited at payroll finalization)");
      void reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const run = async () => {
    setBusy("run");
    try {
      const result = await insightsApi.runProposals(from, to);
      toast.success(`${result.created} new, ${result.updated} updated, ${result.successors} new versions`);
      void reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const columns: Column<OvertimeQueueItem>[] = [
    { key: "employee", header: "Employee", primary: true, cell: (r) => <span className="font-medium" data-testid={`ot-review-row-${r.id}`}>{r.employee_name ?? `#${r.employee_id}`}</span> },
    { key: "date", header: "Date", cell: (r) => fmtDate(r.date) },
    { key: "requested", header: "Requested", cell: (r) => <span className="tabular-nums">{fmtMinutes(r.minutes_requested)}</span> },
    { key: "candidate", header: "Attendance shows", hideOnMobile: true, cell: (r) => (
      r.attendance ? <span className="tabular-nums">{fmtMinutes(r.attendance.ot_candidate_minutes)} <span className="text-xs text-muted-foreground">of {fmtMinutes(r.attendance.net_minutes)} worked</span></span> : "—") },
    { key: "source", header: "Origin", hideOnMobile: true, cell: (r) => (
      <Badge tone={r.source.startsWith("ATTENDANCE") ? "primary" : "neutral"}>{r.source.startsWith("ATTENDANCE") ? `Attendance${r.version > 1 ? ` · v${r.version}` : ""}` : "Request"}</Badge>) },
    { key: "actions", header: <span className="sr-only">Decide</span>, cell: (r) => (
      <div className="flex flex-wrap justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" onClick={() => decide(r, "PAY")} loading={busy === `PAY-${r.id}`} data-testid={`ot-pay-${r.id}`}>
          <Coins className="h-3.5 w-3.5" aria-hidden /> Approve for payroll
        </Button>
        <Button size="sm" variant="secondary" onClick={() => decide(r, "COMP_OFF")} loading={busy === `COMP_OFF-${r.id}`} data-testid={`ot-compoff-${r.id}`}>
          <Gift className="h-3.5 w-3.5" aria-hidden /> Convert to comp-off
        </Button>
      </div>) },
  ];

  return (
    <div className="space-y-4" data-testid="ot-review">
      <Card className="flex flex-wrap items-end gap-3 p-4">
        <div className="me-auto">
          <p className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4 text-primary" aria-hidden /> Overtime from attendance</p>
          <p className="text-xs text-muted-foreground">Final attendance days above the policy thresholds become proposals every night. Run it now for a range.</p>
        </div>
        <Field label="From" className="w-40"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="ot-run-from" /></Field>
        <Field label="To" className="w-40"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} data-testid="ot-run-to" /></Field>
        <Button onClick={run} loading={busy === "run"} data-testid="ot-run"><RefreshCw className="h-4 w-4" aria-hidden /> Run proposals</Button>
      </Card>
      <Card>
        {error ? <ErrorState message={error.message} onRetry={reload} /> : (
          <DataTable rows={data?.items} loading={loading && !data} busy={loading && !!data} rowKey={(r) => r.id} columns={columns}
            onRowClick={(r) => setOpenId(r.id)} cardBelowMd caption="Overtime waiting for review"
            empty={<EmptyState icon={<CalendarClock />} title="Nothing to review" description="Proposals and requests waiting for your decision appear here." />} />
        )}
        {data && <Pagination total={data.total} skip={skip} limit={LIMIT} onChange={setSkip} />}
      </Card>
      <Sheet open={openId !== null} onOpenChange={(o) => !o && setOpenId(null)} title="Overtime context" description="Attendance day, caps and consent">
        {openId !== null && <ContextPanel id={openId} />}
      </Sheet>
    </div>
  );
}
