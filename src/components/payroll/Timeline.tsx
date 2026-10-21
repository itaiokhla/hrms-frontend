"use client";

import type { ReactNode } from "react";

import { EmptyState } from "@/components/ui/layout";
import { cn } from "@/lib/cn";
import { fmtDateTime } from "@/lib/format";
import type { StatusTone } from "@/lib/payroll/labels";

export interface TimelineItem {
  id: string | number;
  /** ISO timestamp. */
  at: string;
  title: ReactNode;
  actor?: ReactNode;
  body?: ReactNode;
  tone?: StatusTone;
  icon?: ReactNode;
}

const DOT: Record<StatusTone, string> = {
  neutral: "bg-muted-foreground/60",
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

/** Audit, approvals, payment events and compensation history (3.8 §7), newest first as given. */
export function Timeline({ items, empty, className, label = "Timeline" }: { items: TimelineItem[]; empty?: ReactNode; className?: string; label?: string }) {
  if (!items.length) return <>{empty ?? <EmptyState title="No events yet" />}</>;
  return (
    <ol className={cn("relative space-y-5 ps-6", className)} aria-label={label}>
      <span className="absolute bottom-1 start-[7px] top-1 w-px bg-border" aria-hidden />
      {items.map((item) => (
        <li key={item.id} className="relative">
          <span
            className={cn(
              "absolute -start-6 top-1 flex h-[15px] w-[15px] items-center justify-center rounded-full ring-4 ring-surface [&>svg]:h-2.5 [&>svg]:w-2.5",
              item.icon ? "bg-surface text-muted-foreground" : DOT[item.tone ?? "neutral"],
            )}
            aria-hidden
          >
            {item.icon}
          </span>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <p className="text-sm font-medium">{item.title}</p>
            <time dateTime={item.at} className="text-xs tabular-nums text-muted-foreground">
              <bdi dir="ltr">{fmtDateTime(item.at)}</bdi>
            </time>
          </div>
          {item.actor && <p className="text-xs text-muted-foreground">{item.actor}</p>}
          {item.body && <div className="mt-1 text-sm text-muted-foreground">{item.body}</div>}
        </li>
      ))}
    </ol>
  );
}
