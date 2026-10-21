"use client";

import { AlertCircle, HelpCircle, Lock, Scale } from "lucide-react";
import { useId, type ReactNode } from "react";

import { Switch } from "@/components/ui/field";
import { Card } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { InheritanceBadge, type InheritanceBadgeProps } from "./InheritanceBadge";

/** Why a switch can't be changed here (or needs a decision first). */
export type SwitchLock = "LAW" | "TENANT" | "DECISION";

const LOCKS: Record<SwitchLock, { label: string; className: string; Icon: typeof Lock }> = {
  LAW: { label: "Required by law", className: "bg-danger-soft text-danger", Icon: Scale },
  TENANT: { label: "Locked by tenant", className: "bg-warning-soft text-warning", Icon: Lock },
  DECISION: { label: "Decision required", className: "bg-info-soft text-info", Icon: HelpCircle },
};

export interface SwitchCardProps {
  title: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (value: boolean) => void;
  /** Consequence text (3.1 §4): what happens with the switch ON and OFF. */
  whenOn: ReactNode;
  whenOff: ReactNode;
  lock?: SwitchLock | null;
  /** Why it's locked, e.g. "for factory workers in India (IN pack 2026-09-17) — locked ON for them". */
  lockReason?: ReactNode;
  inheritance?: Omit<InheritanceBadgeProps, "className"> | null;
  /** Inline validation error (V-01…V-16), linked to the switch. */
  error?: string | null;
  disabled?: boolean;
  /** Extra content, such as the policies under the switch. */
  children?: ReactNode;
  className?: string;
}

/**
 * A payroll switch with its consequences (3.8 §5.16): the switch, "When ON / When OFF" text with the
 * current one highlighted, lock badges ("Required by law", "Locked by tenant", "Decision required"),
 * the inheritance badge and inline validation errors. LAW and TENANT locks disable the switch.
 */
export function SwitchCard({
  title,
  description,
  checked,
  onChange,
  whenOn,
  whenOff,
  lock,
  lockReason,
  inheritance,
  error,
  disabled,
  children,
  className,
}: SwitchCardProps) {
  const id = useId();
  const locked = lock === "LAW" || lock === "TENANT";
  const lockInfo = lock ? LOCKS[lock] : null;
  const describedBy = [`${id}-effect`, lockInfo && `${id}-lock`, error && `${id}-error`].filter(Boolean).join(" ");
  return (
    <Card className={cn("p-5", error && "border-danger/50", className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h3 id={`${id}-title`} className="text-[15px] font-semibold">
            {title}
          </h3>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {lockInfo && (
              <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium", lockInfo.className)} data-lock={lock}>
                <lockInfo.Icon className="h-3.5 w-3.5" aria-hidden />
                {lockInfo.label}
              </span>
            )}
            {inheritance && <InheritanceBadge {...inheritance} />}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-sm font-semibold" aria-hidden>
            {checked ? "ON" : "OFF"}
          </span>
          {/* 44 px touch target around the 24 px switch. */}
          <span className="flex h-11 items-center">
            <Switch
              checked={checked}
              onChange={onChange}
              disabled={disabled || locked}
              aria-labelledby={`${id}-title`}
              aria-describedby={describedBy}
            />
          </span>
        </div>
      </div>
      <dl id={`${id}-effect`} className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <div className={cn("rounded-xl border px-3 py-2", checked ? "border-primary/40 bg-primary-soft/60" : "border-border")}>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            When ON{checked && <span className="ms-1 normal-case tracking-normal">(current)</span>}
          </dt>
          <dd className="mt-0.5 text-foreground">{whenOn}</dd>
        </div>
        <div className={cn("rounded-xl border px-3 py-2", !checked ? "border-primary/40 bg-primary-soft/60" : "border-border")}>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            When OFF{!checked && <span className="ms-1 normal-case tracking-normal">(current)</span>}
          </dt>
          <dd className="mt-0.5 text-foreground">{whenOff}</dd>
        </div>
      </dl>
      {lockInfo && lockReason && (
        <p id={`${id}-lock`} className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
          <lockInfo.Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            <span className="font-medium text-foreground">{lockInfo.label}: </span>
            {lockReason}
          </span>
        </p>
      )}
      {lockInfo && !lockReason && <span id={`${id}-lock`} className="sr-only">{lockInfo.label}</span>}
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-3 flex items-start gap-2 text-sm font-medium text-danger">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}
      {children && <div className="mt-4">{children}</div>}
    </Card>
  );
}
