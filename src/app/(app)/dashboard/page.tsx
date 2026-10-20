"use client";

import { motion } from "framer-motion";
import {
  ArrowRight,
  CalendarCheck2,
  CalendarRange,
  Clock3,
  Inbox,
  PartyPopper,
  UserCheck,
  Users,
  UserX,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LiveClock, PageHeader, StatCard } from "@/components/ui/layout";
import { Avatar, Card, CardHeader, Skeleton, StatusBadge } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { fmtDate, fmtDuration, fmtMoney, fmtTime, fromNow } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { DashboardData } from "@/lib/types";
import { useSession } from "@/store/session";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function DashboardContent() {
  const me = useSession((s) => s.me)!;
  const params = useSearchParams();
  const { data, loading, error, reload } = useApi(() => api.get<DashboardData>("/dashboard"), []);
  const currency = me.company.currency;

  return (
    <div>
      <PageHeader
        eyebrow={fmtDate(new Date().toISOString(), "EEEE, d MMMM")}
        title={`${greeting()}, ${me.user.full_name.split(" ")[0]}`}
        description={
          data?.scope === "company"
            ? `Here's what's happening across ${me.company.name} today.`
            : data?.scope === "team"
              ? "Here's what's happening with your team today."
              : "Here's your day at a glance."
        }
        actions={<LiveClock className="rounded-xl border border-border bg-surface px-3 py-2 font-display text-sm font-semibold shadow-sm" />}
      />

      {params.get("welcome") && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
          <Card className="flex flex-col gap-4 overflow-hidden border-primary/20 bg-gradient-to-r from-primary-soft to-surface p-5 sm:flex-row sm:items-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-glow">
              <PartyPopper className="h-6 w-6" />
            </span>
            <div className="flex-1">
              <p className="font-semibold">Welcome to {me.company.name}!</p>
              <p className="text-sm text-muted-foreground">
                {me.is_company_admin
                  ? "Next steps: add your employees, set up reporting lines, then invite people to sign in."
                  : "Your account is ready. Your access is based on the roles your administrator assigned."}
              </p>
            </div>
            {me.is_company_admin && (
              <Link href="/employees">
                <Button>
                  Add employees <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            )}
          </Card>
        </motion.div>
      )}

      {error && <ErrorState message={error.message} onRetry={reload} />}
      {loading && !data && <DashboardSkeleton />}

      {data && (
        <div className="space-y-6">
          {data.attendance && (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label={data.scope === "company" ? "Active employees" : "People in your team"} value={data.attendance.total_employees} icon={<Users />} />
              <StatCard label="Present today" value={data.attendance.present_today} icon={<UserCheck />} tone="success"
                hint={`${data.attendance.attendance_percentage}% attendance`} delay={0.05} />
              <StatCard label="On leave" value={data.attendance.on_leave} icon={<CalendarRange />} tone="info" delay={0.1} />
              <StatCard label="Not checked in" value={data.attendance.absent_today} icon={<UserX />} tone="warning"
                hint={`${data.attendance.late_today} late arrivals`} delay={0.15} />
            </div>
          )}

          <div className="grid gap-6 xl:grid-cols-3">
            <div className="space-y-6 xl:col-span-2">
              {data.attendance_trend && (
                <Card>
                  <CardHeader title="Attendance this week" description="Unique check-ins per day within your scope" />
                  <div className="h-64 px-2 pb-4 pt-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={data.attendance_trend} margin={{ left: -16, right: 12 }}>
                        <defs>
                          <linearGradient id="present" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} stroke="hsl(var(--muted-foreground))" />
                        <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} stroke="hsl(var(--muted-foreground))" />
                        <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--surface))" }} />
                        <Area type="monotone" dataKey="present" stroke="hsl(var(--primary))" strokeWidth={2.5} fill="url(#present)" animationDuration={900} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
              )}

              {data.attendance && (
                <Card>
                  <CardHeader
                    title="Live attendance"
                    description="Who's in today"
                    action={<Link href="/attendance" className="text-sm font-medium text-primary hover:underline">View all</Link>}
                  />
                  {data.attendance.employees.length === 0 ? (
                    <EmptyState icon={<Clock3 />} title="No check-ins yet today" />
                  ) : (
                    <ul className="divide-y divide-border/60">
                      {data.attendance.employees.slice(0, 6).map((r, i) => (
                        <motion.li key={r.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
                          className="flex items-center gap-3 px-5 py-3">
                          <Avatar name={r.employee_name} size={34} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{r.employee_name}</p>
                            <p className="truncate text-xs text-muted-foreground">{r.department}</p>
                          </div>
                          <div className="hidden text-right text-xs text-muted-foreground sm:block">
                            <p>In {fmtTime(r.check_in_time)}</p>
                            <p>{r.check_out_time ? `Out ${fmtTime(r.check_out_time)}` : fmtDuration(r.working_seconds)}</p>
                          </div>
                          {r.attendance_state === "ON_LUNCH"
                            ? <StatusBadge status="on_lunch" label="On lunch" />
                            : <StatusBadge status={r.check_out_time ? "completed" : "working"} />}
                        </motion.li>
                      ))}
                    </ul>
                  )}
                </Card>
              )}

              {!data.attendance && data.me && <MySummary data={data} currency={currency} />}
            </div>

            <div className="space-y-6">
              {data.me && data.attendance && <MySummary data={data} currency={currency} compact />}
              {data.pending_approvals > 0 && (
                <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}>
                  <Card className="flex items-center gap-4 border-warning/30 bg-warning-soft/60 p-5">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-warning text-white">
                      <Inbox className="h-5 w-5" />
                    </span>
                    <div className="flex-1">
                      <p className="font-semibold">{data.pending_approvals} request{data.pending_approvals > 1 ? "s" : ""} need you</p>
                      <p className="text-sm text-muted-foreground">Leave approvals routed to you</p>
                    </div>
                    <Link href="/leaves?tab=approvals">
                      <Button size="sm" variant="secondary">Review</Button>
                    </Link>
                  </Card>
                </motion.div>
              )}
              {data.payroll && (
                <Card className="p-5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent"><Wallet className="h-5 w-5" /></span>
                    <div>
                      <p className="text-sm text-muted-foreground">Payroll · {data.payroll.month}</p>
                      <p className="font-display text-2xl font-semibold">{fmtMoney(data.payroll.total_net_salary, currency)}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {Object.entries(data.payroll.status_breakdown).map(([status, count]) => (
                      <StatusBadge key={status} status={status} label={`${count} ${status}`} />
                    ))}
                    {data.payroll.total_employees === 0 && <p className="text-sm text-muted-foreground">No payroll generated this month yet.</p>}
                  </div>
                </Card>
              )}
              {data.upcoming_leaves && (
                <Card>
                  <CardHeader title="Upcoming leave" />
                  {data.upcoming_leaves.length === 0 ? (
                    <p className="px-5 py-6 text-sm text-muted-foreground">No approved leave in the next 30 days.</p>
                  ) : (
                    <ul className="divide-y divide-border/60">
                      {data.upcoming_leaves.map((l, i) => (
                        <li key={i} className="flex items-center gap-3 px-5 py-3">
                          <Avatar name={l.employee_name} size={30} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{l.employee_name}</p>
                            <p className="text-xs text-muted-foreground">{fmtDate(l.start_date, "d MMM")} – {fmtDate(l.end_date, "d MMM")}</p>
                          </div>
                          <span className="text-xs capitalize text-muted-foreground">{l.leave_type}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              )}
              {data.recent_activity && data.recent_activity.length > 0 && (
                <Card>
                  <CardHeader title="Recent activity" />
                  <ul className="space-y-3 px-5 py-4">
                    {data.recent_activity.slice(0, 6).map((a, i) => (
                      <li key={i} className="flex items-start gap-3 text-sm">
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.type === "checkin" ? "bg-success" : "bg-info"}`} />
                        <div>
                          <p>{a.message}</p>
                          <p className="text-xs text-muted-foreground">{fromNow(a.time)}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MySummary({ data, currency, compact }: { data: DashboardData; currency: string; compact?: boolean }) {
  const mine = data.me!;
  const record = mine.attendance.record;
  const balances = Object.entries(mine.leave_balance).filter(([, b]) => !b.is_unlimited);
  return (
    <Card className="overflow-hidden">
      <div className="bg-gradient-to-br from-primary to-accent p-5 text-primary-foreground">
        <p className="text-sm opacity-90">My day</p>
        <p className="mt-1 font-display text-2xl font-semibold">
          {{ NOT_PUNCHED_IN: "Not punched in", WORKING: "Working", ON_LUNCH: "On lunch", PUNCHED_OUT: "Day complete" }[mine.attendance.attendance_state]}
        </p>
        {record && (
          <p className="mt-1 text-sm opacity-90">
            In {fmtTime(record.check_in_time)}
            {record.check_out_time ? ` · Out ${fmtTime(record.check_out_time)} · ${fmtDuration(record.working_seconds)} worked` : ` · ${fmtDuration(record.working_seconds)} worked so far`}
          </p>
        )}
        <Link href="/attendance">
          <Button size="sm" variant="secondary" className="mt-4 border-white/30 bg-white/15 text-white hover:bg-white/25">
            <CalendarCheck2 className="h-4 w-4" /> {mine.attendance.attendance_state === "NOT_PUNCHED_IN" ? "Punch in" : "Open attendance"}
          </Button>
        </Link>
      </div>
      <div className={compact ? "grid grid-cols-2 gap-3 p-5" : "grid grid-cols-2 gap-3 p-5 sm:grid-cols-4"}>
        {balances.slice(0, 4).map(([code, b]) => (
          <div key={code} className="rounded-xl bg-muted p-3">
            <p className="truncate text-xs text-muted-foreground">{b.name}</p>
            <p className="mt-1 font-display text-xl font-semibold">
              {b.available}<span className="text-xs font-normal text-muted-foreground"> / {b.total}</span>
            </p>
          </div>
        ))}
      </div>
      {mine.latest_payslip && (
        <Link href="/payslips" className="flex items-center justify-between border-t border-border px-5 py-3 text-sm hover:bg-surface-muted">
          <span className="text-muted-foreground">Latest payslip · {fmtDate(mine.latest_payslip.salary_month, "MMMM yyyy")}</span>
          <span className="font-semibold">{fmtMoney(mine.latest_payslip.net_salary, currency)}</span>
        </Link>
      )}
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[116px] rounded-2xl" />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <Skeleton className="h-80 rounded-2xl xl:col-span-2" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense>
      <DashboardContent />
    </Suspense>
  );
}
