"use client";

/**
 * Year view of the employee holiday calendar (LH 09-ui-ux/02 §16; LH-M1 WI-1.12): twelve mini-months (4×3 on wide
 * screens, 3×4, 2×6, one column on phones), weeks starting on the day after the employee's weekend (Fri–Sat → Sunday),
 * weekend columns tinted, today ringed on the employee's local date (LH-TZ-04), every date a button with the full
 * description in its accessible name. Holiday names are listed once under each month.
 */

import { motion } from "framer-motion";
import { useMemo } from "react";

import { MARK_STYLE, MarkChip } from "@/components/holiday/HolidayLegend";
import { MARK_LABEL, MONTHS, WEEKDAYS, WEEKDAY_NAMES, markKind, type DayMark, type MarkKind } from "@/lib/holiday/api";
import { cn } from "@/lib/cn";

/** Shape cue on a date cell next to its colour (the full glyphs are in the legend and the month list). */
const CELL_SUFFIX: Partial<Record<MarkKind, string>> = { optional: "○", "optional-chosen": "✓", half: "◐", provisional: "~" };
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
/** 0 = Monday, as the API's weekday. */
const weekdayOf = (y: number, m: number, d: number) => (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function describeDay(d: DayMark): string {
  const [y, m, day] = d.date.split("-").map(Number);
  const parts = [`${day} ${MONTHS[m - 1]} ${y}, ${WEEKDAY_NAMES[d.weekday]}`, MARK_LABEL[markKind(d)]];
  if (d.holiday) {
    parts.push(d.holiday.name);
    if (d.holiday.observance === "EMPLOYEE_SUBSTITUTE" && d.holiday.observed_from_date) parts.push(`substitute for ${d.holiday.observed_from_date}`);
    if (d.holiday.observance === "OBSERVED" && d.holiday.observed_from_date) parts.push(`observed for ${d.holiday.observed_from_date}`);
    if (d.weekly_off) parts.push("on a weekly off");
  }
  if (d.observed_elsewhere) parts.push(`holiday observed on ${d.observed_elsewhere}`);
  for (const l of d.leave ?? []) parts.push(`${l.label} ${l.status === "PENDING" ? "(pending)" : ""}`.trim());
  return parts.join(" · ");
}

export interface HolidayYearGridProps {
  year: number;
  days: DayMark[];
  weekStart: number;
  weekend: number[];
  localToday: string;
  selected?: string | null;
  onSelect?: (day: DayMark) => void;
}

export function HolidayYearGrid({ year, days, weekStart, weekend, localToday, selected, onSelect }: HolidayYearGridProps) {
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const columns = useMemo(() => Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7), [weekStart]);
  const off = useMemo(() => new Set(weekend), [weekend]);

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid="holiday-year-grid" data-week-start={weekStart}>
      {MONTHS.map((name, index) => {
        const month = index + 1;
        const lead = (weekdayOf(year, month, 1) - weekStart + 7) % 7;
        const count = daysIn(year, month);
        const holidays = Array.from({ length: count }, (_, i) => byDate.get(iso(year, month, i + 1))).filter(
          (d): d is DayMark => !!d?.holiday,
        );
        return (
          <motion.section
            key={name}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.025, duration: 0.25 }}
            className="rounded-2xl border border-border bg-surface p-3 shadow-card"
            aria-label={`${name} ${year}`}
            data-testid={`month-${year}-${pad(month)}`}
          >
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">{name}</h3>
            <div role="grid" aria-label={`${name} ${year}`} className="grid grid-cols-7 gap-0.5 text-center text-[11px]">
              <div role="row" className="contents">
                {columns.map((wd) => (
                  <div
                    key={wd}
                    role="columnheader"
                    aria-label={WEEKDAY_NAMES[wd]}
                    data-testid="weekday-header"
                    data-weekday={wd}
                    data-weekend={off.has(wd) ? "true" : "false"}
                    className={cn("py-1 font-medium text-muted-foreground", off.has(wd) && "rounded-md bg-muted/70 text-foreground")}
                  >
                    {WEEKDAYS[wd].slice(0, 2)}
                  </div>
                ))}
              </div>
              <div role="row" className="contents">
                {Array.from({ length: lead }, (_, i) => (
                  <div key={`lead-${i}`} aria-hidden className={cn("h-7", off.has(columns[i]) && "bg-muted/30")} />
                ))}
                {Array.from({ length: count }, (_, i) => {
                  const date = iso(year, month, i + 1);
                  const day = byDate.get(date);
                  const column = (lead + i) % 7;
                  const kind = day ? markKind(day) : "none";
                  const weekendColumn = off.has(columns[column]);
                  return (
                    <button
                      key={date}
                      type="button"
                      role="gridcell"
                      data-testid={`day-${date}`}
                      data-kind={kind}
                      data-col={column}
                      data-weekend={weekendColumn ? "true" : "false"}
                      data-today={date === localToday ? "true" : undefined}
                      aria-label={day ? describeDay(day) : date}
                      aria-selected={selected === date}
                      disabled={!day}
                      onClick={() => day && onSelect?.(day)}
                      className={cn(
                        "relative flex h-7 items-center justify-center rounded-md tabular-nums transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                        weekendColumn && kind === "work" && "bg-muted/30",
                        MARK_STYLE[kind],
                        date === localToday && "outline outline-2 outline-offset-1 outline-primary",
                        selected === date && "scale-110 shadow-md",
                        day && "hover:brightness-95",
                      )}
                    >
                      {i + 1}
                      {CELL_SUFFIX[kind] && (
                        <span aria-hidden className="absolute -right-0.5 -top-1 text-[8px] font-bold leading-none">
                          {CELL_SUFFIX[kind]}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            {holidays.length > 0 && (
              <ul className="mt-2 space-y-1 border-t border-border pt-2 text-xs" data-testid={`month-holidays-${year}-${pad(month)}`}>
                {holidays.map((d) => (
                  <li key={d.date} className="flex items-center gap-2">
                    <MarkChip kind={markKind(d)} />
                    <span className="w-5 shrink-0 tabular-nums text-muted-foreground">{Number(d.date.slice(8))}</span>
                    <span className="truncate">{d.holiday!.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </motion.section>
        );
      })}
    </div>
  );
}
