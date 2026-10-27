"use client";

import { MotionConfig, motion } from "framer-motion";

import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { ShiftVersion } from "@/lib/types";

import { VERSION_STATE_LABEL, breaksSummary, fmtMinutes, timesLabel, versionNetMinutes, versionState } from "./shiftModel";

const TONE = {
  IN_FORCE: "border-success/40 bg-success-soft text-success",
  SCHEDULED: "border-info/40 bg-info-soft text-info",
  ENDED: "border-border bg-surface-muted text-muted-foreground",
  VOIDED: "border-border bg-surface-muted text-muted-foreground line-through",
} as const;

/** "1 Jan 2000 – 30 Nov 2026", "from 1 Dec 2026". */
export function versionRange(v: Pick<ShiftVersion, "effective_from" | "effective_to">): string {
  return v.effective_to ? `${fmtDate(v.effective_from)} – ${fmtDate(v.effective_to)}` : `from ${fmtDate(v.effective_from)}`;
}

/**
 * The versions of one shift in date order (§17.2 Versions pane): number, dates, times, breaks, net minutes and
 * reason; the in-force row reads "In force", later ones "Scheduled" (state is text, the colour only repeats it).
 */
export function ShiftVersionTimeline({ versions, today, kind }: { versions: ShiftVersion[]; today: string; kind?: string | null }) {
  const rows = [...versions].sort((a, b) => a.effective_from.localeCompare(b.effective_from) || a.version_no - b.version_no);
  if (!rows.length) return <p className="text-sm text-muted-foreground">No versions yet.</p>;
  return (
    <MotionConfig reducedMotion="user">
      <ol aria-label="Version timeline" className="relative space-y-3 border-s border-border ps-5">
        {rows.map((v, i) => {
          const state = versionState(v, today);
          const net = versionNetMinutes(v, kind);
          return (
            <motion.li key={v.id} data-testid={`version-v${v.version_no}`} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2, delay: Math.min(i, 8) * 0.04 }} className="relative">
              <span aria-hidden className={cn("absolute -start-[1.6rem] top-1.5 h-3 w-3 rounded-full border-2 border-surface",
                state === "IN_FORCE" ? "bg-success" : state === "SCHEDULED" ? "bg-info" : "bg-muted-foreground/40")} />
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">v{v.version_no}</span>
                <span>
                  <time dateTime={v.effective_from}>{versionRange(v)}</time>
                </span>
                <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", TONE[state])}>{VERSION_STATE_LABEL[state]}</span>
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {timesLabel(v.start_time, v.end_time, kind)}
                {v.anchor_timezone ? ` ${v.anchor_timezone}` : ""}
                {v.core_start_time && v.core_end_time ? ` · core ${v.core_start_time}–${v.core_end_time}` : ""}
                {` · ${breaksSummary(v.break_rules, v.unpaid_break_minutes)}`}
                {net !== null ? ` · net ${fmtMinutes(net)}` : ""}
              </p>
              {v.reason && <p className="mt-0.5 text-xs text-muted-foreground">{v.reason}</p>}
            </motion.li>
          );
        })}
      </ol>
    </MotionConfig>
  );
}
