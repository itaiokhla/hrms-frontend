"use client";

import { motion } from "framer-motion";
import { ArrowRight, CalendarClock, CalendarPlus, Banknote, Inbox, Palmtree, Timer, UsersRound } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { useCan } from "@/components/access/Can";
import { EmptyState, ErrorState, Stagger, StaggerItem } from "@/components/ui/layout";
import { Avatar, Card, CardHeader, Skeleton } from "@/components/ui/primitives";
import { fmtDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { leaveApi, units } from "@/lib/leave/api";
import { useLeaveChanged } from "@/lib/leave/events";
import { canApplyLeave, canApproveLeave } from "@/lib/leave/routes";

import { BalanceCards } from "./BalanceCards";
import { DateRangeText, LeaveStatusChip } from "./LeaveBits";
import { useLeaveAccess } from "./LeaveAccessContext";
import { useLeaveOverlays } from "./LeaveOverlays";

/**
 * `/leaves/home` (09-ui-ux/02 §7): balances, my next leave, approvals waiting, who is away today and the quick
 * actions (apply, claim comp-off, encash). Comp-off and encashment need the tenant's leave v2 cut-over.
 */
export function LeaveHome() {
  const { me } = useCan();
  const { access } = useLeaveAccess();
  const { openApply, openLeave } = useLeaveOverlays();
  const { data, error, loading, reload } = useApi(() => leaveApi.dashboard(), []);
  useLeaveChanged(() => void reload());

  const mine = !!me && canApplyLeave(me);
  const approver = !!me && canApproveLeave(me);
  const v2 = data?.v2_enabled ?? access?.v2_enabled ?? false;

  if (error) return <Card><ErrorState message={error.message} onRetry={() => void reload()} /></Card>;

  return (
    <div className="space-y-6" data-testid="leave-home">
      {/* quick actions */}
      <Stagger className="grid gap-3 sm:grid-cols-3">
        {mine && (
          <StaggerItem>
            <QuickAction icon={<CalendarPlus />} title="Apply leave" text="See each day and your balance before you send it." onClick={() => openApply()} testId="quick-apply" />
          </StaggerItem>
        )}
        {mine && v2 && (
          <StaggerItem>
            <QuickAction icon={<Timer />} title="Claim comp-off" text="Worked on a holiday or weekly off? Claim the day back." href="/leaves/balances?tab=comp-off" testId="quick-comp-off" />
          </StaggerItem>
        )}
        {mine && v2 && (
          <StaggerItem>
            <QuickAction icon={<Banknote />} title="Encash" text="Ask to be paid for unused leave your plan lets you encash." href="/leaves/balances?tab=encash" testId="quick-encash" />
          </StaggerItem>
        )}
      </Stagger>

      {mine && (
        <section aria-labelledby="home-balances">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="home-balances" className="text-lg font-semibold">My balances</h2>
            <Link href="/leaves/balances" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              Details <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
          <BalanceCards balances={data?.balances} loading={loading} onApply={(code) => openApply({ type: code })} />
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {mine && (
          <Card className="overflow-hidden" data-testid="home-next-leave">
            <CardHeader title="My next leave" />
            <div className="p-5">
              {loading && !data ? (
                <Skeleton className="h-16" />
              ) : data?.upcoming ? (
                <button type="button" onClick={() => openLeave(data.upcoming!.id)} className="group flex w-full items-start gap-3 text-start">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary transition-transform group-hover:scale-110">
                    <Palmtree className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium"><DateRangeText start={data.upcoming.start_date} end={data.upcoming.end_date} /></span>
                    <span className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                      {units(data.upcoming.units)} <LeaveStatusChip status={data.upcoming.status} />
                    </span>
                  </span>
                </button>
              ) : (
                <EmptyState className="py-6" icon={<CalendarClock />} title="Nothing booked" description="Time for a break? Apply in a few clicks." />
              )}
            </div>
          </Card>
        )}

        {(approver || (data?.approvals_waiting ?? 0) > 0) && (
          <Card className="overflow-hidden" data-testid="home-approvals">
            <CardHeader title="Waiting for my approval" />
            <div className="flex items-center justify-between gap-3 p-5">
              <div>
                <motion.p key={data?.approvals_waiting ?? -1} initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="font-display text-4xl font-semibold tabular-nums" data-testid="home-approvals-count">
                  {data ? data.approvals_waiting : "–"}
                </motion.p>
                <p className="text-sm text-muted-foreground">
                  leave requests and changes{data && data.comp_off_claims_waiting > 0 ? ` · ${data.comp_off_claims_waiting} comp-off claim${data.comp_off_claims_waiting === 1 ? "" : "s"}` : ""}
                </p>
              </div>
              <Link href="/leaves/approvals" className="inline-flex h-8 items-center gap-2 rounded-xl bg-primary-soft px-3 text-xs font-medium text-primary transition-colors hover:bg-primary/15" data-testid="home-open-inbox">
                <Inbox className="h-4 w-4" aria-hidden /> Open inbox
              </Link>
            </div>
          </Card>
        )}

        <Card className="overflow-hidden lg:col-span-1" data-testid="home-away-today">
          <CardHeader title="Away today" description={data ? fmtDate(data.date, "EEEE, d MMM") : undefined} action={<Link href="/leaves/calendar" className="text-sm font-medium text-primary hover:underline">Calendar</Link>} />
          <div className="p-5">
            {loading && !data ? (
              <Skeleton className="h-16" />
            ) : data?.away_today.length ? (
              <ul className="space-y-2.5">
                {data.away_today.map((p, i) => (
                  <motion.li key={`${p.name}-${i}`} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }} className="flex items-center gap-3 text-sm">
                    <Avatar name={p.name} size={30} />
                    <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                    <span className="text-xs text-muted-foreground">{p.label}</span>
                  </motion.li>
                ))}
              </ul>
            ) : (
              <EmptyState className="py-6" icon={<UsersRound />} title="Everyone is in" />
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function QuickAction({ icon, title, text, onClick, href, testId }: { icon: ReactNode; title: string; text: string; onClick?: () => void; href?: string; testId: string }) {
  const body = (
    <Card className="group flex h-full items-start gap-3 p-4 transition-shadow hover:shadow-lift">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary transition-transform duration-300 group-hover:scale-110 [&>svg]:h-5 [&>svg]:w-5" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-muted-foreground">{text}</span>
      </span>
    </Card>
  );
  return href ? (
    <Link href={href} className="block h-full rounded-2xl" data-testid={testId}>{body}</Link>
  ) : (
    <button type="button" onClick={onClick} className="block h-full w-full rounded-2xl text-start" data-testid={testId}>{body}</button>
  );
}
