"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { HelpCircle } from "lucide-react";
import { Fragment, useState } from "react";

import { ExplainPanel } from "@/components/payroll/ExplainPanel";
import { MoneyText } from "@/components/payroll/MoneyText";
import { cn } from "@/lib/cn";

import { kindLabel, methodLabel, TOTAL_LABEL } from "./format";
import { ComplianceBadges } from "./shared";
import type { Breakdown, BreakdownLine, StatutoryLine, TotalKey } from "./types";

export type Period = "monthly" | "annual";

const TOTAL_ORDER: TotalKey[] = ["gross", "deductions", "employer_contributions", "reimbursements", "ctc", "net_estimate"];

/**
 * A salary breakdown (structures.breakdown()): one row per component, monthly or annual, the totals
 * and the country-pack statutory estimates with their honesty badges. Every amount opens
 * "Why this amount?" with the engine's explanation. Amounts are rendered, never animated.
 */
export function BreakdownTable({ breakdown, period, names, caption = "Salary breakdown" }: { breakdown: Breakdown; period: Period; names?: Record<string, string>; caption?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();
  const label = (code: string) => names?.[code] ?? code;

  const row = (line: BreakdownLine | StatutoryLine, key: string, statutory = false) => {
    const money = line[period];
    const isOpen = open === key;
    const explanation = typeof line.explanation === "string" ? line.explanation : null;
    return (
      <Fragment key={key}>
        <tr className="border-b border-border/60">
          <th scope="row" className="py-2 pe-3 text-start font-normal">
            <span className="block font-medium">{label(line.component)}</span>
            <span className="text-xs text-muted-foreground">
              <bdi dir="ltr" className="font-mono">
                {line.component}
              </bdi>{" "}
              · {kindLabel(line.kind)}
              {"method" in line && line.method ? ` · ${methodLabel(line.method)}` : ""}
            </span>
            {statutory && (
              <span className="mt-1 block">
                <ComplianceBadges verified={(line as StatutoryLine).verified} fixture={(line as StatutoryLine).fixture} />
              </span>
            )}
          </th>
          <td className="py-2 text-end align-top">
            {money ? (
              <button
                type="button"
                aria-expanded={isOpen}
                aria-label={`Why this amount? ${label(line.component)}`}
                onClick={() => setOpen(isOpen ? null : key)}
                className="inline-flex min-h-[44px] items-center gap-1 rounded-lg px-1 hover:bg-surface-muted sm:min-h-[32px]"
              >
                <MoneyText money={money} negativeCue={line.kind === "DEDUCTION" ? false : undefined} />
                <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              </button>
            ) : (
              <span className="text-sm text-muted-foreground">Not calculated</span>
            )}
          </td>
        </tr>
        <AnimatePresence initial={false}>
          {isOpen && (
            <tr>
              <td colSpan={2} className="pb-3">
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: reduceMotion ? 0 : 0.18 }} className="overflow-hidden">
                  <ExplainPanel explanation={explanation ?? "The calculation trace for this line is not available."} />
                </motion.div>
              </td>
            </tr>
          )}
        </AnimatePresence>
      </Fragment>
    );
  };

  return (
    <div className="space-y-3">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <tbody>
          {breakdown.lines.map((l) => row(l, `l-${l.component}`))}
          {breakdown.statutory.lines.map((l) => row(l, `s-${l.component}`, true))}
        </tbody>
        <tfoot>
          {TOTAL_ORDER.filter((k) => breakdown.totals[k]).map((k) => (
            <tr key={k} className={cn(k === "ctc" || k === "gross" ? "font-semibold" : "", "border-t border-border/60")}>
              <th scope="row" className="py-2 text-start font-medium">
                {TOTAL_LABEL[k]}
              </th>
              <td className="py-2 text-end">
                <MoneyText money={breakdown.totals[k]![period]} emphasis={k === "ctc" || k === "net_estimate"} />
              </td>
            </tr>
          ))}
        </tfoot>
      </table>
      {breakdown.statutory.lines.length > 0 && !breakdown.statutory.verified && <p className="text-xs text-muted-foreground">{breakdown.statutory.note}</p>}
      {breakdown.issues.length > 0 && (
        <ul className="space-y-1 text-sm" aria-label="Calculation issues">
          {breakdown.issues.map((i, n) => (
            <li key={n} className={cn("rounded-xl px-3 py-2", i.severity === "BLOCKING" ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning")}>
              {i.component ? `${i.component}: ` : ""}
              {i.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
