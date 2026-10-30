"use client";

import { motion } from "framer-motion";
import { CalendarPlus, Hourglass, Snowflake } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/layout";
import { Badge, Card, MotionSafe, Skeleton } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { fmtDate } from "@/lib/format";
import { units } from "@/lib/leave/api";
import { leaveColor } from "@/lib/leave/colors";
import type { LeaveBalance } from "@/lib/leave/types";

/** One balance (BalanceView): available, the balance it comes from, pending, expiring lots, eligibility, frozen. */
export function BalanceCard({ b, index = 0, onApply }: { b: LeaveBalance; index?: number; onApply?: (code: string) => void }) {
  const available = b.available ?? b.balance;
  const base = Math.max(b.balance + b.used, available, 1);
  const pct = b.unlimited ? 100 : Math.max(0, Math.min(100, (available / base) * 100));
  const notYet = b.eligibility && b.eligibility !== "ELIGIBLE" && b.eligibility !== "ELIGIBLE_VERIFY";
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index, 10) * 0.05, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -3 }}
    >
      <Card className={cn("relative h-full overflow-hidden p-5 transition-shadow hover:shadow-lift", b.frozen && "opacity-80")} data-testid={`balance-card-${b.leave_type_code}`}>
        <span className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: leaveColor(b.color_token) }} aria-hidden />
        <div className="flex items-start justify-between gap-2">
          <p className="inline-flex items-center gap-2 text-sm font-medium">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: leaveColor(b.color_token) }} aria-hidden />
            {b.name}
          </p>
          <span className="flex flex-wrap justify-end gap-1">
            {b.frozen && <Badge tone="info"><Snowflake className="h-3 w-3" aria-hidden /> Frozen</Badge>}
            {!b.is_paid && <Badge>Unpaid</Badge>}
          </span>
        </div>
        <p className="mt-2 font-display text-3xl font-semibold tabular-nums" data-testid={`balance-available-${b.leave_type_code}`}>
          {b.unlimited ? "∞" : available}
          <span className="ms-1 text-sm font-normal text-muted-foreground">{b.unlimited ? "unlimited" : `${b.unit === "HOUR" ? "hours" : "days"} available`}</span>
        </p>
        {!b.unlimited && (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
            <motion.div className="h-full rounded-full" style={{ backgroundColor: leaveColor(b.color_token) }} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8, ease: "easeOut" }} />
          </div>
        )}
        <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div><dt className="text-muted-foreground">Balance</dt><dd className="font-medium tabular-nums">{b.unlimited ? "—" : b.balance}</dd></div>
          <div><dt className="text-muted-foreground">Pending</dt><dd className="font-medium tabular-nums">{b.pending}</dd></div>
          <div><dt className="text-muted-foreground">Used</dt><dd className="font-medium tabular-nums">{b.used}</dd></div>
        </dl>
        {b.reserved_encashment > 0 && <p className="mt-2 text-xs text-muted-foreground">{units(b.reserved_encashment)} set aside for encashment</p>}
        {b.expiring.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-xs text-warning" data-testid={`balance-expiring-${b.leave_type_code}`}>
            {b.expiring.slice(0, 2).map((lot) => (
              <li key={`${lot.expires_on}-${lot.units}`} className="inline-flex items-center gap-1"><Hourglass className="h-3 w-3" aria-hidden /> {units(lot.units)} expire {fmtDate(lot.expires_on)}</li>
            ))}
          </ul>
        )}
        {notYet && (
          <p className="mt-2 text-xs text-muted-foreground" data-testid={`balance-eligibility-${b.leave_type_code}`}>
            {b.available_from ? `Available from ${fmtDate(b.available_from)}` : b.eligibility === "ACCRUE_ONLY" ? "Building up; not usable yet" : "Not available to you yet"}
          </p>
        )}
        {b.frozen && <p className="mt-2 text-xs text-muted-foreground">Not in your current leave plan; the balance is kept.</p>}
        {b.cycle_start && b.cycle_end && <p className="mt-2 text-[11px] text-muted-foreground">Leave year {fmtDate(b.cycle_start, "d MMM yyyy")} – {fmtDate(b.cycle_end, "d MMM yyyy")}</p>}
        {onApply && !b.frozen && (
          <Button size="sm" variant="ghost" className="mt-3 -ms-2" onClick={() => onApply(b.leave_type_code)} aria-label={`Apply for ${b.name}`}>
            <CalendarPlus className="h-4 w-4" aria-hidden /> Apply
          </Button>
        )}
      </Card>
    </motion.div>
  );
}

export function BalanceCards({ balances, loading, onApply }: { balances?: LeaveBalance[]; loading?: boolean; onApply?: (code: string) => void }) {
  if (loading && !balances) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-44 rounded-2xl" />)}
      </div>
    );
  }
  if (!balances?.length) {
    return <Card><EmptyState title="No leave balances yet" description="Balances appear once HR assigns you a leave plan." /></Card>;
  }
  return (
    <MotionSafe>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="balance-cards">
        {balances.map((b, i) => <BalanceCard key={b.leave_type_code} b={b} index={i} onApply={onApply} />)}
      </div>
    </MotionSafe>
  );
}
