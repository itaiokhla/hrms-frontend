"use client";

/**
 * Legend of the employee holiday calendar (LH 09-ui-ux/02 §16). Every kind has a glyph and a text code next to its
 * colour, so the marks never rely on colour alone (09-ui-ux/01 accessibility).
 */

import { MARK_LABEL, type MarkKind } from "@/lib/holiday/api";
import { cn } from "@/lib/cn";

export const MARK_STYLE: Record<MarkKind, string> = {
  public: "bg-danger-soft text-danger font-semibold",
  company: "bg-primary-soft text-primary font-semibold",
  optional: "border border-dashed border-warning text-warning",
  "optional-chosen": "bg-warning-soft text-warning font-semibold",
  half: "bg-gradient-to-br from-info-soft from-50% to-transparent to-50% text-info font-semibold",
  provisional: "border border-dashed border-danger text-danger",
  "weekly-off": "bg-muted text-muted-foreground",
  "working-day": "bg-success-soft text-success font-semibold",
  leave: "ring-2 ring-inset ring-info text-info",
  work: "text-foreground",
  none: "text-muted-foreground/40",
};

export const MARK_GLYPH: Record<MarkKind, string> = {
  public: "H",
  company: "H",
  optional: "OH",
  "optional-chosen": "OH✓",
  half: "◐H",
  provisional: "H~",
  "weekly-off": "W",
  "working-day": "WD",
  leave: "L",
  work: "",
  none: "",
};

export const LEGEND_ORDER: MarkKind[] = ["public", "company", "optional", "optional-chosen", "half", "provisional", "weekly-off", "working-day", "leave"];

export function MarkChip({ kind, className }: { kind: MarkKind; className?: string }) {
  return (
    <span
      className={cn("inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1 text-[10px] leading-none", MARK_STYLE[kind], className)}
      aria-hidden
    >
      {MARK_GLYPH[kind]}
    </span>
  );
}

export function HolidayLegend({ kinds = LEGEND_ORDER, className }: { kinds?: MarkKind[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground", className)} aria-label="Legend" data-testid="holiday-legend">
      {kinds.map((kind) => (
        <li key={kind} className="flex items-center gap-1.5" data-legend={kind}>
          <MarkChip kind={kind} />
          <span>{MARK_LABEL[kind]}</span>
        </li>
      ))}
    </ul>
  );
}
