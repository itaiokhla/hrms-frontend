"use client";

import { MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, MenuItem } from "@/components/ui/overlay";
import { Card } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { fmtDate } from "@/lib/format";

import { StatusChip } from "./StatusChip";

export interface PolicyAction {
  label: string;
  onSelect: () => void;
  tone?: "danger";
  icon?: ReactNode;
}

export interface PolicyCardProps {
  name: ReactNode;
  version: number | string;
  /** POLICY_VERSION status (DRAFT, ACTIVE, SUPERSEDED). */
  status?: string | null;
  /** ISO date the version applies from. */
  effectiveFrom?: string | null;
  /** Who it applies to, e.g. "Warehouse Weekly · 84 people" or "everyone else · 266 people". */
  population?: ReactNode;
  /** One-line summary ("Daily > 9 h · weekly > 48 h · 1.5× / 2× / 2×"). */
  summary: ReactNode;
  actions?: PolicyAction[];
  /** Open the policy (title becomes a button). */
  onOpen?: () => void;
  children?: ReactNode;
  className?: string;
}

/** A policy collapsed to one line (3.8 §5.16): name · version · effective date · population, summary, ⋯ menu. */
export function PolicyCard({ name, version, status, effectiveFrom, population, summary, actions, onOpen, children, className }: PolicyCardProps) {
  const heading = onOpen ? (
    <button type="button" onClick={onOpen} className="min-h-[44px] text-start font-semibold hover:underline sm:min-h-0">
      {name}
    </button>
  ) : (
    <span className="font-semibold">{name}</span>
  );
  return (
    <Card className={cn("p-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            {heading}
            <span className="text-muted-foreground">· v{version}</span>
            {effectiveFrom && (
              <span className="text-muted-foreground">
                · from <time dateTime={effectiveFrom}>{fmtDate(effectiveFrom)}</time>
              </span>
            )}
            {population && <span className="text-muted-foreground">· {population}</span>}
            {status && <StatusChip vocabulary="policy_version" code={status} />}
          </div>
          <p className="text-sm text-foreground/90">{summary}</p>
        </div>
        {actions && actions.length > 0 && (
          <DropdownMenu
            trigger={
              <Button variant="ghost" size="icon" className="h-11 w-11 sm:h-9 sm:w-9" aria-label="Policy actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            }
          >
            {actions.map((a) => (
              <MenuItem key={a.label} onSelect={a.onSelect} tone={a.tone} icon={a.icon}>
                {a.label}
              </MenuItem>
            ))}
          </DropdownMenu>
        )}
      </div>
      {children && <div className="mt-3 border-t border-border pt-3">{children}</div>}
    </Card>
  );
}
