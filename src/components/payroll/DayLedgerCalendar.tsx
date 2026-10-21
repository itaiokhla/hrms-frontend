"use client";

import Link from "next/link";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";

import { cn } from "@/lib/cn";

/** Slot classifications of the day ledger (hrms-backend app/payroll/ledger.py `Classification`). */
export type DayClass =
  | "PRESENT"
  | "HALF_DAY"
  | "ABSENT"
  | "LEAVE"
  | "LEAVE_EXCUSED"
  | "HOLIDAY"
  | "WEEKLY_OFF"
  | "MANUAL_LOP"
  | "SANDWICH_LOP"
  | "UNMARKED"
  | "MISSING_PUNCH_OUT"
  | "PRESUMED_PRESENT"
  | "NOT_EMPLOYED"
  | "SUSPENDED_UNPAID";

/** Label, a short symbol (so colour is never the only signal) and the cell style. */
export const DAY_CLASSES: Record<DayClass, { label: string; short: string; className: string }> = {
  PRESENT: { label: "Present", short: "P", className: "bg-success-soft text-success" },
  PRESUMED_PRESENT: { label: "Presumed present", short: "P?", className: "bg-success-soft text-success" },
  HALF_DAY: { label: "Half day", short: "½", className: "bg-warning-soft text-warning" },
  LEAVE: { label: "Leave", short: "L", className: "bg-info-soft text-info" },
  LEAVE_EXCUSED: { label: "Excused leave", short: "LE", className: "bg-info-soft text-info" },
  HOLIDAY: { label: "Holiday", short: "H", className: "bg-primary-soft text-foreground" },
  WEEKLY_OFF: { label: "Weekly off", short: "W", className: "bg-muted text-muted-foreground" },
  ABSENT: { label: "Absent", short: "A", className: "bg-danger-soft text-danger" },
  MANUAL_LOP: { label: "Loss of pay", short: "LOP", className: "bg-danger-soft text-danger" },
  SANDWICH_LOP: { label: "Sandwich loss of pay", short: "SL", className: "bg-danger-soft text-danger" },
  SUSPENDED_UNPAID: { label: "Suspended (unpaid)", short: "S", className: "bg-danger-soft text-danger" },
  UNMARKED: { label: "Unmarked", short: "?", className: "bg-warning-soft text-warning" },
  MISSING_PUNCH_OUT: { label: "Missing punch-out", short: "MP", className: "bg-warning-soft text-warning" },
  NOT_EMPLOYED: { label: "Not employed", short: "–", className: "bg-surface text-muted-foreground" },
};

function classMeta(code: string) {
  return DAY_CLASSES[code as DayClass] ?? { label: code.replace(/_/g, " ").toLowerCase(), short: "•", className: "bg-muted text-muted-foreground" };
}

export interface LedgerSource {
  label: string;
  /** Only links the viewer may open (EC-UX-08). */
  href?: string;
  kind?: string;
}

export interface LedgerDay {
  /** YYYY-MM-DD */
  date: string;
  am: DayClass | string;
  pm: DayClass | string;
  /** Whether each half is paid (shown in the drill-down). */
  paid?: { am: boolean; pm: boolean };
  note?: string;
  sources?: LedgerSource[];
}

export interface DayLedgerCalendarProps {
  /** First and last day of the attendance cycle (YYYY-MM-DD), e.g. 26 Oct – 25 Nov. */
  start: string;
  end: string;
  days: LedgerDay[];
  /** 1 = Monday (default), 0 = Sunday. */
  weekStartsOn?: 0 | 1;
  locale?: string;
  onSelectDay?: (day: LedgerDay | null, date: string) => void;
  className?: string;
  label?: string;
}

const DAY_MS = 86_400_000;
const parse = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * The day ledger of a pay period (3.8 §5.4): one cell per day with its AM and PM classification,
 * a legend in words and symbols, and a drill-down to the day's slots and source records.
 * Keyboard: arrow keys move by day and week, Home/End to the week's ends, Enter or Space opens a day.
 */
export function DayLedgerCalendar({ start, end, days, weekStartsOn = 1, locale, onSelectDay, className, label = "Attendance by day" }: DayLedgerCalendarProps) {
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const dates = useMemo(() => {
    const out: string[] = [];
    const from = parse(start);
    const to = parse(end);
    for (let t = from; t <= to && out.length < 400; t += DAY_MS) out.push(iso(t));
    return out;
  }, [start, end]);
  const lead = dates.length ? (new Date(parse(dates[0])).getUTCDay() - weekStartsOn + 7) % 7 : 0;
  const cells: (string | null)[] = [...Array<null>(lead).fill(null), ...dates];
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const fmtLong = (date: string) =>
    new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(parse(date));
  const weekdays = Array.from({ length: 7 }, (_, i) => {
    const sample = Date.UTC(2024, 0, 7 + ((weekStartsOn + i) % 7)); // 7 Jan 2024 is a Sunday
    return {
      short: new Intl.DateTimeFormat(locale, { weekday: "narrow", timeZone: "UTC" }).format(sample),
      long: new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(sample),
    };
  });

  const [focused, setFocused] = useState<string | null>(dates[0] ?? null);
  const [selected, setSelected] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLDivElement>());
  const used = useMemo(() => {
    const set = new Set<string>();
    days.forEach((d) => {
      set.add(d.am);
      set.add(d.pm);
    });
    return Array.from(set);
  }, [days]);

  const move = (date: string) => {
    setFocused(date);
    refs.current.get(date)?.focus();
  };
  const open = (date: string) => {
    const next = selected === date ? null : date;
    setSelected(next);
    onSelectDay?.(next ? byDate.get(next) ?? null : null, date);
  };
  const onKey = (date: string) => (e: KeyboardEvent<HTMLDivElement>) => {
    const index = dates.indexOf(date);
    const col = (lead + index) % 7;
    const rtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";
    let target = index;
    if (e.key === "ArrowRight") target = index + (rtl ? -1 : 1);
    else if (e.key === "ArrowLeft") target = index + (rtl ? 1 : -1);
    else if (e.key === "ArrowDown") target = index + 7;
    else if (e.key === "ArrowUp") target = index - 7;
    else if (e.key === "Home") target = index - col;
    else if (e.key === "End") target = index + (6 - col);
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open(date);
      return;
    } else return;
    e.preventDefault();
    const clamped = Math.max(0, Math.min(dates.length - 1, target));
    move(dates[clamped]);
  };

  const describe = (date: string) => {
    const day = byDate.get(date);
    if (!day) return `${fmtLong(date)}: no data`;
    const am = classMeta(day.am).label;
    const pm = classMeta(day.pm).label;
    return am === pm ? `${fmtLong(date)}: ${am}` : `${fmtLong(date)}: morning ${am}, afternoon ${pm}`;
  };
  const chosen = selected ? byDate.get(selected) : undefined;

  return (
    <div className={cn("space-y-3", className)}>
      <div role="grid" aria-label={label} className="w-full max-w-md">
        <div role="row" className="grid grid-cols-7 gap-1">
          {weekdays.map((w, i) => (
            <div key={i} role="columnheader" className="py-1 text-center text-xs font-medium text-muted-foreground">
              <abbr title={w.long} className="no-underline">
                {w.short}
              </abbr>
            </div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} role="row" className="mt-1 grid grid-cols-7 gap-1">
            {week.map((date, di) => {
              if (!date) return <div key={di} role="gridcell" aria-hidden className="aspect-square" />;
              const day = byDate.get(date);
              const am = classMeta(day?.am ?? "");
              const pm = classMeta(day?.pm ?? "");
              const same = day && day.am === day.pm;
              return (
                <div
                  key={date}
                  ref={(el) => {
                    if (el) refs.current.set(date, el);
                    else refs.current.delete(date);
                  }}
                  role="gridcell"
                  tabIndex={focused === date ? 0 : -1}
                  aria-selected={selected === date}
                  aria-label={describe(date)}
                  onKeyDown={onKey(date)}
                  onFocus={() => setFocused(date)}
                  onClick={() => {
                    setFocused(date);
                    open(date);
                  }}
                  className={cn(
                    "relative flex aspect-square min-h-[44px] cursor-pointer flex-col overflow-hidden rounded-lg border text-[10px] font-semibold leading-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected === date ? "border-primary ring-2 ring-primary/30" : "border-border",
                  )}
                >
                  <span className="absolute start-1 top-1 text-[10px] font-medium text-foreground/70" aria-hidden>
                    {Number(date.slice(8, 10))}
                  </span>
                  {day ? (
                    same ? (
                      <span className={cn("flex flex-1 items-end justify-center pb-1", am.className)} aria-hidden>
                        {am.short}
                      </span>
                    ) : (
                      <>
                        <span className={cn("flex flex-1 items-end justify-center", am.className)} aria-hidden>
                          {am.short}
                        </span>
                        <span className={cn("flex flex-1 items-center justify-center", pm.className)} aria-hidden>
                          {pm.short}
                        </span>
                      </>
                    )
                  ) : (
                    <span className="flex-1" aria-hidden />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {used.length > 0 && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs" aria-label="Legend">
          {used.map((code) => {
            const meta = classMeta(code);
            return (
              <li key={code} className="inline-flex items-center gap-1.5">
                <span className={cn("inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded px-1 text-[10px] font-semibold", meta.className)} aria-hidden>
                  {meta.short}
                </span>
                {meta.label}
              </li>
            );
          })}
          <li className="text-muted-foreground">Split cell: morning on top, afternoon below</li>
        </ul>
      )}

      <div aria-live="polite">
        {selected && (
          <div className="rounded-2xl border border-border bg-surface-muted/50 p-3 text-sm">
            <p className="font-medium">{fmtLong(selected)}</p>
            {chosen ? (
              <>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                  <dt className="text-muted-foreground">Morning</dt>
                  <dd>
                    {classMeta(chosen.am).label}
                    {chosen.paid && <span className="text-muted-foreground"> · {chosen.paid.am ? "paid" : "unpaid"}</span>}
                  </dd>
                  <dt className="text-muted-foreground">Afternoon</dt>
                  <dd>
                    {classMeta(chosen.pm).label}
                    {chosen.paid && <span className="text-muted-foreground"> · {chosen.paid.pm ? "paid" : "unpaid"}</span>}
                  </dd>
                </dl>
                {chosen.note && <p className="mt-2 text-muted-foreground">{chosen.note}</p>}
                {!!chosen.sources?.length && (
                  <ul className="mt-2 space-y-1">
                    {chosen.sources.map((s, i) => (
                      <li key={i}>
                        {s.kind && <span className="text-xs text-muted-foreground">{s.kind} · </span>}
                        {s.href ? (
                          <Link href={s.href} className="font-medium text-primary hover:underline">
                            {s.label}
                          </Link>
                        ) : (
                          s.label
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="mt-1 text-muted-foreground">No ledger entry for this day.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
