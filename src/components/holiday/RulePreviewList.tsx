"use client";

import { motion } from "framer-motion";
import { CornerDownRight, Info } from "lucide-react";

import { Badge, Skeleton } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { WEEKDAYS, type PreviewRow, type RulePreview } from "@/lib/holiday/api";

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Tue 26 Jan 2027" for an ISO date (weekday Mon = 0, as the API sends it). */
export function longDate(iso: string, weekday?: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = weekday ?? (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return `${WEEKDAYS[wd]} ${String(d).padStart(2, "0")} ${MONTHS_SHORT[m - 1]} ${y}`;
}

function Row({ row }: { row: PreviewRow }) {
  const observed = row.observance === "OBSERVED";
  return (
    <li className={cn("flex flex-wrap items-center gap-2 text-sm", observed && "pl-4 text-muted-foreground")} data-testid={`preview-row-${row.date}`}>
      {observed && <CornerDownRight className="h-3.5 w-3.5" aria-hidden />}
      <span className="font-medium tabular-nums">{longDate(row.date, row.weekday)}</span>
      {observed && row.observed_from_date && <span className="text-xs">observed for {longDate(row.observed_from_date)}</span>}
      {row.sequence_index > 1 && <Badge tone="neutral">day {row.sequence_index}</Badge>}
      {row.status === "PROVISIONAL" && <Badge tone="warning">expected</Badge>}
    </li>
  );
}

/**
 * The generated dates of a rule for the next years (02 §3.8 "Preview"): one block per year, OBSERVED partners
 * indented under their date, skipped years and "date needed" notes shown as such. Empty years stay visible.
 */
export function RulePreviewList({ preview, loading, error }: { preview: RulePreview | null; loading?: boolean; error?: string | null }) {
  if (error) {
    return (
      <p className="rounded-xl border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
        {error}
      </p>
    );
  }
  if (!preview) return loading ? <Skeleton className="h-28 w-full" /> : null;
  return (
    <ol className={cn("space-y-2 transition-opacity", loading && "opacity-60")} data-testid="rule-preview" aria-busy={loading || undefined}>
      {preview.years.map((y) => (
        <motion.li key={y.year} layout className="flex gap-4 rounded-xl border border-border px-3 py-2" data-testid={`preview-year-${y.year}`}>
          <span className="w-12 shrink-0 font-semibold tabular-nums">{y.year}</span>
          <div className="min-w-0 flex-1 space-y-1">
            {y.rows.length === 0 && <p className="text-sm text-muted-foreground">No date this year</p>}
            <ul className="space-y-0.5">
              {y.rows.map((r) => (
                <Row key={`${r.date}-${r.observance}`} row={r} />
              ))}
            </ul>
            {y.notes.map((n) => (
              <p key={`${n.code}-${n.message}`} className="flex items-start gap-1 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden /> {n.message}
              </p>
            ))}
          </div>
        </motion.li>
      ))}
    </ol>
  );
}
