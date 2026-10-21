"use client";

import { ArrowDownToLine, Lock, PencilLine, Scale, Server } from "lucide-react";

import { cn } from "@/lib/cn";
import { inheritanceLabel, type InheritanceKind } from "@/lib/payroll/labels";
import type { ScopeLevel, SettingLevel } from "@/lib/settings.generated";

import { Hint } from "./Hint";

const STYLE: Record<InheritanceKind, { className: string; Icon: typeof Lock }> = {
  INHERITED: { className: "bg-muted text-muted-foreground", Icon: ArrowDownToLine },
  OVERRIDDEN: { className: "bg-info-soft text-info", Icon: PencilLine },
  LOCKED: { className: "bg-warning-soft text-warning", Icon: Lock },
  LEGAL: { className: "bg-danger-soft text-danger", Icon: Scale },
  DEFAULT: { className: "bg-muted text-muted-foreground", Icon: Server },
};

export interface InheritanceBadgeProps {
  kind: InheritanceKind;
  /** The level the value comes from (or that locked it). */
  level?: SettingLevel | ScopeLevel | string | null;
  /** Legal source for "Required by law", e.g. "IN pack 2026-09-17". */
  legalSource?: string | null;
  /** Who set or locked it, and why (shown in the tooltip). */
  by?: string | null;
  reason?: string | null;
  className?: string;
}

/**
 * Where a setting value comes from (3.8 §5.16): "Inherited from tenant", "Overridden here",
 * "Locked by tenant", "Required by law". Icon and words, never colour alone.
 */
export function InheritanceBadge({ kind, level, legalSource, by, reason, className }: InheritanceBadgeProps) {
  const { className: tone, Icon } = STYLE[kind];
  const label = inheritanceLabel(kind, level);
  const details = [legalSource && `Source: ${legalSource}`, by && `By ${by}`, reason].filter(Boolean).join(" · ");
  const badge = (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium", tone, className)} data-kind={kind}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </span>
  );
  return details ? <Hint content={details}>{badge}</Hint> : badge;
}
