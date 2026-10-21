"use client";

import { motion, useReducedMotion } from "framer-motion";

import { MoneyText } from "@/components/payroll/MoneyText";

import { GRADE_POSITION } from "./format";
import { ToneChip } from "./shared";
import type { GradeRange } from "./types";

/** Position of a salary in its grade range (EC-CMP-23): a bar from min to max, with words (never colour alone). */
export function GradePosition({ range }: { range: GradeRange | null | undefined }) {
  const reduceMotion = useReducedMotion();
  if (!range) return null;
  const status = GRADE_POSITION[range.status] ?? { label: range.status, tone: "neutral" as const };
  const pct = range.position_pct !== null && range.position_pct !== undefined ? Math.max(0, Math.min(100, Number(range.position_pct))) : null;
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">{range.grade ? `Grade ${range.grade.code}` : "Grade range"}</span>
        <ToneChip label={status.label} tone={status.tone} />
        {range.position_pct !== null && <span className="tabular-nums text-muted-foreground">{range.position_pct}% of the range</span>}
      </div>
      {range.range && (
        <>
          <div className="relative h-2 rounded-full bg-muted" aria-hidden>
            {pct !== null && (
              <motion.span
                className="absolute top-1/2 h-4 w-1.5 -translate-y-1/2 rounded-full bg-primary"
                initial={false}
                animate={{ insetInlineStart: `${pct}%` }}
                transition={{ duration: reduceMotion ? 0 : 0.3 }}
              />
            )}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{range.range.min ? <MoneyText amount={range.range.min} currency={range.range.currency} /> : "No minimum"}</span>
            <span>{range.range.max ? <MoneyText amount={range.range.max} currency={range.range.currency} /> : "No maximum"}</span>
          </div>
        </>
      )}
    </div>
  );
}
