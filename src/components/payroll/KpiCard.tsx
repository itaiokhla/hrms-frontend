"use client";

import * as Popover from "@radix-ui/react-popover";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import CountUp from "react-countup";

import { Card, MotionSafe, Skeleton } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { needsIsoCodes, type Money } from "@/lib/money";

import { CurrencyBadge } from "./CurrencyBadge";
import { Hint } from "./Hint";
import { MoneyText } from "./MoneyText";

export type KpiState = "DRAFT" | "APPROVED" | "FINAL";

const STATE_LABEL: Record<KpiState, { label: string; className: string }> = {
  DRAFT: { label: "Draft", className: "bg-muted text-muted-foreground" },
  APPROVED: { label: "Approved", className: "bg-info-soft text-info" },
  FINAL: { label: "Final", className: "bg-success-soft text-success" },
};

const TONES = {
  primary: "bg-primary-soft text-primary",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  accent: "bg-accent/10 text-accent",
};

export interface KpiCardProps {
  label: string;
  /** A whole-number count (count-up animation on first load only). */
  count?: number | null;
  /** Money per currency; never summed across currencies (EC-MON-04). */
  amounts?: Money[] | null;
  /** "Draft", "Approved" or "Final", from the state of the run the figures come from. */
  state?: KpiState | null;
  icon?: ReactNode;
  tone?: keyof typeof TONES;
  hint?: ReactNode;
  /** KPI definition shown as a glossary tooltip next to the label (3.8 §5.1). */
  definition?: string;
  /** Drill-down: the same query and scope as the figure (EC-UX-03). */
  href?: string;
  onClick?: () => void;
  loading?: boolean;
  /** Compact notation for money ("₹4.12Cr"); KPI cards are the only place it is allowed. Default true. */
  compact?: boolean;
  delay?: number;
  /** Extra content under the value, such as "3 → Assign". */
  footer?: ReactNode;
}

/**
 * Extends today's StatCard (3.8 §7): counts or per-currency money, a Draft/Approved/Final label,
 * compact notation, a per-currency breakdown popover with exact amounts, a drill-down link and a
 * loading state. Money never counts up (nothing animates amounts while you read them).
 */
export function KpiCard({
  label,
  count,
  amounts,
  state,
  icon,
  tone = "primary",
  hint,
  definition,
  href,
  onClick,
  loading,
  compact = true,
  delay = 0,
  footer,
}: KpiCardProps) {
  const reduceMotion = useReducedMotion();
  const money = amounts ?? [];
  const multi = money.length > 1;
  const useCode = needsIsoCodes(money.map((m) => m.currency));
  const stateLabel = state ? STATE_LABEL[state] : null;

  const value = loading ? (
    <Skeleton className="mt-2 h-8 w-28" />
  ) : amounts ? (
    money.length === 0 ? (
      <p className="mt-2 font-display text-3xl font-semibold text-muted-foreground">—</p>
    ) : (
      <div className={cn("mt-2 space-y-0.5", multi ? "text-lg" : "font-display text-3xl")}>
        {money.slice(0, 3).map((m) => (
          <p key={m.currency} className="font-semibold">
            <MoneyText money={m} compact={compact} useCode={useCode} negativeCue={false} />
          </p>
        ))}
        {money.length > 3 && <p className="text-xs text-muted-foreground">+{money.length - 3} more currencies</p>}
      </div>
    )
  ) : (
    <p className="mt-2 font-display text-3xl font-semibold tabular-nums">
      {count === null || count === undefined ? "—" : <CountUp end={count} duration={reduceMotion ? 0 : 1.1} preserveValue />}
    </p>
  );

  const body = (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {stateLabel && (
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", stateLabel.className)}>{stateLabel.label}</span>
        )}
      </div>
      {value}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );

  const interactive = href || onClick;
  const main = href ? (
    <Link href={href} className="block min-h-[44px] rounded-xl focus-visible:outline-none">
      {body}
    </Link>
  ) : onClick ? (
    <button type="button" onClick={onClick} className="block min-h-[44px] w-full rounded-xl text-start">
      {body}
    </button>
  ) : (
    body
  );

  return (
    <MotionSafe>
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay, ease: [0.22, 1, 0.36, 1] }}
        whileHover={interactive ? { y: -3 } : undefined}
      >
        <Card className={cn("group relative overflow-hidden p-5 transition-shadow", interactive && "hover:shadow-lift")}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">{main}</div>
            <div className="flex shrink-0 items-start gap-1">
              {definition && (
                <Hint content={definition}>
                  <span role="img" className="flex h-6 w-6 items-center justify-center rounded-full text-xs text-muted-foreground" aria-label={`About ${label}`}>
                    ⓘ
                  </span>
                </Hint>
              )}
              {icon && (
                <span className={cn("flex h-11 w-11 items-center justify-center rounded-2xl [&>svg]:h-5 [&>svg]:w-5", TONES[tone])} aria-hidden>
                  {icon}
                </span>
              )}
            </div>
          </div>
          {multi && !loading && (
            <Popover.Root>
              <Popover.Trigger asChild>
                <button
                  type="button"
                  className="mt-3 inline-flex min-h-[44px] items-center gap-1 rounded-lg text-xs font-medium text-primary hover:underline sm:min-h-0"
                >
                  By currency ({money.length})
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                </button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  align="start"
                  sideOffset={6}
                  className="z-50 min-w-[16rem] rounded-2xl border border-border bg-surface p-3 shadow-lift"
                  aria-label={`${label} by currency`}
                >
                  <p className="mb-2 text-xs text-muted-foreground">Each currency separately; amounts are never added across currencies.</p>
                  <ul className="space-y-1.5">
                    {money.map((m) => (
                      <li key={m.currency} className="flex items-center justify-between gap-4 text-sm">
                        <CurrencyBadge code={m.currency} />
                        <MoneyText money={m} useCode className="font-medium" />
                      </li>
                    ))}
                  </ul>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          )}
          {footer && <div className="mt-3 text-sm">{footer}</div>}
        </Card>
      </motion.div>
    </MotionSafe>
  );
}
