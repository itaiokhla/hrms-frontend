"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { OCCURRENCES, WEEKDAY_NAMES, WEEKDAYS, type PreviewDay } from "@/lib/holiday/api";
import { shiftMonth } from "@/lib/holiday/workWeekRules";

const ORDINAL = Object.fromEntries(OCCURRENCES.map((o) => [o.value, o.label]));

function monthTitle(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

function dayLabel(day: PreviewDay): string {
  const name = WEEKDAY_NAMES[day.weekday];
  const date = new Date(`${day.date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const what =
    day.portion === "FULL"
      ? "weekly off"
      : day.portion === "FIRST_HALF"
        ? "morning off"
        : day.portion === "SECOND_HALF"
          ? "afternoon off"
          : "working day";
  const nth = day.cycle_day === null ? `${ORDINAL[day.occurrence]} ${name}` : `cycle day ${day.cycle_day + 1}`;
  return `${name} ${date} (${nth}): ${what}${day.changed ? ", changes with this version" : ""}`;
}

/**
 * Month grid of a work-week preview (09-ui-ux/02 §19): full weekly offs shaded, half-day offs half-shaded, the
 * occurrence shown on offs that are not every week (e.g. "2nd" Saturday), dates that change in a version outlined.
 * Weeks start on Monday. Holidays are not mixed in (they belong to calendars).
 */
export function WorkWeekPreview({
  month,
  days,
  loading,
  onMonthChange,
  weekStart = 0,
}: {
  month: string;
  days: PreviewDay[] | undefined;
  loading?: boolean;
  onMonthChange: (month: string) => void;
  /** 0 = Monday (default), 6 = Sunday (Gulf weeks, DR-74). */
  weekStart?: number;
}) {
  const inMonth = useMemo(() => (days ?? []).filter((d) => d.date.startsWith(month)), [days, month]);
  const leading = inMonth.length ? (inMonth[0].weekday - weekStart + 7) % 7 : 0;
  const headers = Array.from({ length: 7 }, (_, i) => WEEKDAYS[(i + weekStart) % 7]);
  // Weekdays that are off on some occurrences only: show the ordinal on those offs.
  const partial = useMemo(() => {
    const out = new Set<number>();
    for (let w = 0; w < 7; w++) {
      const same = inMonth.filter((d) => d.weekday === w);
      const off = same.filter((d) => d.portion !== null).length;
      if (off > 0 && off < same.length) out.add(w);
    }
    return out;
  }, [inMonth]);
  const full = inMonth.filter((d) => d.portion === "FULL").length;
  const half = inMonth.filter((d) => d.portion === "FIRST_HALF" || d.portion === "SECOND_HALF").length;
  const workingDays = inMonth.length - full - half / 2;

  return (
    <div className="rounded-2xl border border-border bg-surface p-4" data-testid="work-week-preview">
      <div className="mb-3 flex items-center justify-between gap-2">
        <Button variant="ghost" size="icon" aria-label="Previous month" onClick={() => onMonthChange(shiftMonth(month, -1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <p className="font-display text-sm font-semibold" aria-live="polite" data-testid="preview-month">
          {monthTitle(month)}
        </p>
        <Button variant="ghost" size="icon" aria-label="Next month" onClick={() => onMonthChange(shiftMonth(month, 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground" aria-hidden>
        {headers.map((h) => (
          <div key={h}>{h.slice(0, 2)}</div>
        ))}
      </div>
      {loading && !inMonth.length ? (
        <div className="mt-1 grid grid-cols-7 gap-1">
          {Array.from({ length: 35 }, (_, i) => (
            <Skeleton key={i} className="aspect-square rounded-xl" />
          ))}
        </div>
      ) : (
        <AnimatePresence mode="wait" initial={false}>
          <motion.ol
            key={month}
            role="list"
            aria-label={`Weekly offs in ${monthTitle(month)}`}
            className={cn("mt-1 grid grid-cols-7 gap-1 transition-opacity", loading && "opacity-60")}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.18 }}
          >
            {Array.from({ length: leading }, (_, i) => (
              <li key={`pad-${i}`} aria-hidden />
            ))}
            {inMonth.map((day) => {
              const n = Number(day.date.slice(8));
              const isHalf = day.portion === "FIRST_HALF" || day.portion === "SECOND_HALF";
              return (
                <li
                  key={day.date}
                  data-testid={`ww-day-${day.date}`}
                  data-portion={day.portion ?? "WORKING"}
                  data-changed={day.changed ? "true" : "false"}
                  title={dayLabel(day)}
                  aria-label={dayLabel(day)}
                  className={cn(
                    "relative flex aspect-square flex-col items-center justify-center overflow-hidden rounded-xl border text-sm tabular-nums",
                    day.portion === "FULL" && "border-primary/40 bg-primary-soft font-semibold text-primary",
                    isHalf && "border-warning/40 text-foreground",
                    day.portion === null && "border-border/60 text-foreground/80",
                    day.changed && "ring-2 ring-info ring-offset-1 ring-offset-surface",
                    !day.in_effect && "opacity-60",
                  )}
                >
                  {isHalf && (
                    <span
                      aria-hidden
                      className={cn("absolute inset-x-0 bg-warning-soft", day.portion === "FIRST_HALF" ? "top-0 h-1/2" : "bottom-0 h-1/2")}
                    />
                  )}
                  <span className="relative">{n}</span>
                  {day.portion === "FULL" && partial.has(day.weekday) && day.cycle_day === null && (
                    <span className="relative text-[9px] font-medium leading-none">{ORDINAL[day.occurrence]}</span>
                  )}
                  {day.cycle_day !== null && <span className="relative text-[9px] leading-none text-muted-foreground">d{day.cycle_day + 1}</span>}
                </li>
              );
            })}
          </motion.ol>
        </AnimatePresence>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded border border-primary/40 bg-primary-soft" aria-hidden /> Weekly off
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="relative h-3 w-3 overflow-hidden rounded border border-warning/40" aria-hidden>
            <span className="absolute inset-x-0 bottom-0 h-1/2 bg-warning-soft" />
          </span>
          Half day off
        </span>
        {inMonth.some((d) => d.changed) && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded ring-2 ring-info" aria-hidden /> Changes
          </span>
        )}
      </div>
      <p className="mt-2 text-sm" data-testid="preview-totals">
        <span className="font-semibold">Working days: {workingDays}</span>
        <span className="text-muted-foreground"> · Offs: {full}{half ? ` · Half offs: ${half}` : ""}</span>
      </p>
    </div>
  );
}
