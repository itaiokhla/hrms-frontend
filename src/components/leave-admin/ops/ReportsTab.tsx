"use client";

import { motion } from "framer-motion";
import { BarChart3, Landmark } from "lucide-react";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Notice } from "@/components/payroll/inputs/shared";
import { Field, Input, Select } from "@/components/ui/field";
import { DataTable, EmptyState, ErrorState, StatCard, type Column } from "@/components/ui/layout";
import { Card, CardHeader, MotionSafe, Skeleton } from "@/components/ui/primitives";
import { fmtDate, todayISO } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { leaveAdminApi } from "@/lib/leave/adminApi";
import type { LeaveAccess, LiabilityReport } from "@/lib/leave/adminTypes";
import { leaveColor } from "@/lib/leave/colors";

import { LeaveSwatch, V2Only, fmtUnits, hasLeavePerm, useLeaveTypes, useOrgOptions } from "../shared";

const monthLabel = (key: string) => fmtDate(`${key}-01`, "MMM yy");

function UsageReportCard() {
  const year = new Date().getFullYear();
  const [start, setStart] = useState(`${year}-01-01`);
  const [end, setEnd] = useState(todayISO());
  const valid = !!start && !!end && start <= end;
  const usage = useApi(() => leaveAdminApi.usage(start, end), [start, end], { enabled: valid });
  const types = useLeaveTypes(true);
  const colorOf = (code: string) => leaveColor(types.data?.find((t) => t.code === code)?.color_token);
  const months = useMemo(() => Object.entries(usage.data?.by_month ?? {}).map(([key, units]) => ({ key, label: monthLabel(key), units })), [usage.data]);
  const total = (usage.data?.by_type ?? []).reduce((sum, t) => sum + t.units, 0);

  return (
    <Card data-testid="usage-report">
      <CardHeader title="Leave taken" description="Approved, charged units in the period (sensitive types with few people are suppressed)." />
      <div className="space-y-5 p-5">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="From" className="w-44"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} data-testid="usage-start" /></Field>
          <Field label="To" className="w-44" error={!valid ? "The end is before the start." : undefined}><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} data-testid="usage-end" /></Field>
        </div>
        {usage.error ? <ErrorState message={usage.error.message} onRetry={() => void usage.reload()} /> : !usage.data ? <Skeleton className="h-64 rounded-2xl" /> : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard label="Units taken" value={total} tone="primary" format={(n) => fmtUnits(n)} />
              <StatCard label="Leave types used" value={usage.data.by_type.length} tone="info" delay={0.05} />
              <StatCard label="Pending requests" value={usage.data.pending_requests} tone="warning" delay={0.1} />
            </div>
            {months.length === 0 ? (
              <EmptyState icon={<BarChart3 />} title="No leave taken in this period" />
            ) : (
              <div className="grid gap-5 lg:grid-cols-2">
                <div className="h-64" aria-label="Units taken per month" role="img">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={months} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} allowDecimals />
                      <Tooltip formatter={(v) => [fmtUnits(Number(v)), "Units"]} />
                      <Bar dataKey="units" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="h-64" aria-label="Units taken per leave type" role="img">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={usage.data.by_type} layout="vertical" margin={{ top: 8, right: 16, left: 16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                      <XAxis type="number" tick={{ fontSize: 12 }} />
                      <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 12 }} />
                      <Tooltip formatter={(v) => [fmtUnits(Number(v)), "Units"]} />
                      <Bar dataKey="units" radius={[0, 6, 6, 0]}>
                        {usage.data.by_type.map((t) => <Cell key={t.leave_type} fill={colorOf(t.leave_type)} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
            {usage.data.by_type.length > 0 && (
              <ul className="divide-y divide-border/70 rounded-xl border border-border text-sm">
                {usage.data.by_type.map((t, i) => (
                  <MotionSafe key={t.leave_type}>
                    <motion.li initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }} className="flex items-center gap-3 px-3 py-2">
                      <LeaveSwatch token={types.data?.find((x) => x.code === t.leave_type)?.color_token} />
                      <span className="flex-1">{t.name}</span>
                      <span className="tabular-nums font-medium">{fmtUnits(t.units)}</span>
                      <span className="w-28 text-right text-xs text-muted-foreground">{t.suppressed ? "people hidden" : `${t.employees ?? 0} people`}</span>
                    </motion.li>
                  </MotionSafe>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

function LiabilityCard() {
  const [on, setOn] = useState(todayISO());
  const [entity, setEntity] = useState("");
  const org = useOrgOptions();
  const report = useApi(() => leaveAdminApi.liability(on || undefined, entity ? Number(entity) : undefined), [on, entity]);
  const columns: Column<LiabilityReport["rows"][number]>[] = [
    { key: "name", header: "Employee", primary: true, cell: (r) => <span className="font-medium">{r.name}</span> },
    { key: "type", header: "Leave type", cell: (r) => <span className="font-mono text-xs">{r.leave_type}</span> },
    { key: "units", header: "Encashable units", cell: (r) => <span className="tabular-nums">{fmtUnits(r.encashable_units)}</span> },
  ];
  return (
    <Card data-testid="liability-report">
      <CardHeader title="Leave liability" description="Encashable units per employee and type; the money value comes from the payroll encashment formula." />
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="As of" className="w-44"><Input type="date" value={on} onChange={(e) => setOn(e.target.value)} /></Field>
          <Field label="Legal entity" className="w-64">
            <Select value={entity} onChange={(e) => setEntity(e.target.value)}>
              <option value="">All</option>
              {org.entities.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
            </Select>
          </Field>
        </div>
        {report.error ? <ErrorState message={report.error.message} onRetry={() => void report.reload()} /> : !report.data ? <Skeleton className="h-40" /> : (
          <>
            <div className="flex flex-wrap gap-2">
              {Object.entries(report.data.totals).map(([code, units]) => (
                <span key={code} className="rounded-xl border border-border px-3 py-1.5 text-sm"><span className="font-mono text-xs text-muted-foreground">{code}</span> <strong className="tabular-nums">{fmtUnits(units)}</strong></span>
              ))}
            </div>
            <DataTable caption="Leave liability" columns={columns} rows={report.data.rows} rowKey={(r) => `${r.employee_id}-${r.leave_type}`} cardBelowMd
              empty={<EmptyState icon={<Landmark />} title="No encashable balances" description="Only types whose plan rule allows encashment appear here." />} />
          </>
        )}
      </div>
    </Card>
  );
}

/** Reports (09-ui-ux/02 §15): usage with charts; liability (encashable units) after go-live. */
export function ReportsTab({ access, canUsage }: { access: LeaveAccess | undefined; canUsage: boolean }) {
  const liability = hasLeavePerm(access, "leave:liability_read");
  return (
    <div className="space-y-5" data-testid="reports-tab">
      {canUsage ? <UsageReportCard /> : <Notice tone="info" title="Usage reports need report access or company-wide leave read access" />}
      {liability && <V2Only access={access} what="The liability report"><LiabilityCard /></V2Only>}
    </div>
  );
}
