"use client";

/**
 * "My calendar" of `/holidays` (LH 09-ui-ux/02 §16; LH-M1 WI-1.12): the viewer's own day marks from
 * `GET /me/calendar` — statutory (public) and company holidays, optional holidays, half days, weekly offs, declared
 * working days and own leave — as a year grid or an upcoming list. Dates are the employee's local dates (LH-TZ-04);
 * only published calendar years appear.
 */

import { AnimatePresence, motion } from "framer-motion";
import { CalendarDays, ChevronLeft, ChevronRight, Globe2, List } from "lucide-react";
import { useMemo, useState } from "react";

import { HolidayLegend, MarkChip } from "@/components/holiday/HolidayLegend";
import { HolidayYearGrid, describeDay } from "@/components/holiday/HolidayYearGrid";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/layout";
import { Badge, Card, Skeleton } from "@/components/ui/primitives";
import { Segmented } from "@/components/ui/segmented";
import { CATEGORY_LABEL, MARK_LABEL, MONTHS, WEEKDAY_NAMES, dayMarksApi, markKind, type DayMark, type MyCalendar } from "@/lib/holiday/api";
import { useApi } from "@/lib/hooks";

type View = "year" | "list";

const YEAR_STATUS: Record<string, string> = { PUBLISHED: "Published", DRAFT: "Not published yet", PENDING_APPROVAL: "Awaiting approval" };

function longDate(isoDate: string) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return `${WEEKDAY_NAMES[(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7]}, ${d} ${MONTHS[m - 1]} ${y}`;
}

export function MyHolidayCalendar() {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [view, setView] = useState<View>("year");
  const [showPast, setShowPast] = useState(false);
  const [selected, setSelected] = useState<DayMark | null>(null);
  const { data, loading, error } = useApi<MyCalendar>(() => dayMarksApi.me(`${year}-01-01`, `${year}-12-31`), [year]);

  const holidays = useMemo(() => (data?.days ?? []).filter((d) => d.holiday), [data]);
  const calendars = useMemo(() => (data?.calendars ?? []).filter((c) => c.id !== null), [data]);
  const weekendNames = (data?.weekend ?? []).map((d) => WEEKDAY_NAMES[d]).join(" & ");

  return (
    <div className="space-y-5" data-testid="my-calendar">
      <Card className="flex flex-wrap items-end justify-between gap-4 p-4">
        <div className="flex items-center gap-2">
          <Button size="icon" variant="ghost" aria-label="Previous year" onClick={() => { setYear((y) => y - 1); setSelected(null); }}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <motion.span key={year} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="min-w-16 text-center text-xl font-semibold tabular-nums" data-testid="calendar-year">
            {year}
          </motion.span>
          <Button size="icon" variant="ghost" aria-label="Next year" onClick={() => { setYear((y) => y + 1); setSelected(null); }}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Segmented<View>
          label="View"
          value={view}
          onChange={setView}
          options={[
            { value: "year", label: "Year" },
            { value: "list", label: "Upcoming" },
          ]}
        />
      </Card>

      {data && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground" data-testid="calendar-context">
          {calendars.length === 0 ? (
            <span>No holiday calendar applies to you yet.</span>
          ) : (
            calendars.map((c) => {
              const y = c.years[String(year)];
              return (
                <span key={`${c.id}-${c.from}`} className="inline-flex items-center gap-1.5">
                  <CalendarDays className="h-4 w-4 text-primary" />
                  <span className="font-medium text-foreground">{c.name}</span>
                  {c.code && <span className="font-mono text-xs">{c.code}</span>}
                  {y ? <Badge tone={y.status === "PUBLISHED" ? "success" : "warning"}>{YEAR_STATUS[y.status] ?? y.status}{y.status === "PUBLISHED" ? ` · v${y.version}` : ""}</Badge> : null}
                </span>
              );
            })
          )}
          {weekendNames && <span data-testid="weekly-off-line">Weekly off: <span className="text-foreground">{weekendNames}</span></span>}
          {data.timezone && (
            <span className="inline-flex items-center gap-1">
              <Globe2 className="h-4 w-4" /> {data.timezone} · today {longDate(data.local_today)}
            </span>
          )}
        </div>
      )}

      <HolidayLegend />

      {loading && !data && <Skeleton className="h-96 rounded-2xl" />}
      {error && !data && <Card><EmptyState icon={<CalendarDays />} title="Your calendar could not be loaded" description={error.message} /></Card>}

      {data && view === "year" && (
        <div className="grid gap-5 2xl:grid-cols-[1fr_18rem]">
          <HolidayYearGrid
            year={year}
            days={data.days}
            weekStart={data.week_start}
            weekend={data.weekend}
            localToday={data.local_today}
            selected={selected?.date ?? null}
            onSelect={(d) => setSelected((s) => (s?.date === d.date ? null : d))}
          />
          <AnimatePresence>{selected && <DayPanel key={selected.date} day={selected} onClose={() => setSelected(null)} />}</AnimatePresence>
        </div>
      )}

      {data && view === "list" && (
        <UpcomingList days={holidays} today={data.local_today} showPast={showPast} onShowPast={setShowPast} year={year} />
      )}
    </div>
  );
}

function DayPanel({ day, onClose }: { day: DayMark; onClose: () => void }) {
  const kind = markKind(day);
  return (
    <motion.aside
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 16 }}
      className="h-fit rounded-2xl border border-border bg-surface p-4 shadow-card"
      aria-label="Selected day"
      data-testid="day-panel"
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <p className="font-semibold">{longDate(day.date)}</p>
        <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <MarkChip kind={kind} />
        <span>{MARK_LABEL[kind]}</span>
      </div>
      {day.holiday && (
        <dl className="mt-3 space-y-1 text-sm">
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Holiday</dt><dd className="text-right font-medium">{day.holiday.name}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Category</dt><dd>{CATEGORY_LABEL[day.holiday.category] ?? day.holiday.category}</dd></div>
          {day.holiday.observance === "EMPLOYEE_SUBSTITUTE" && day.holiday.observed_from_date && (
            <p className="text-xs text-muted-foreground">Substitute day for the holiday on {longDate(day.holiday.observed_from_date)}, which fell on your day off.</p>
          )}
          {day.holiday.observance === "OBSERVED" && day.holiday.observed_from_date && (
            <p className="text-xs text-muted-foreground">Observed for {longDate(day.holiday.observed_from_date)}.</p>
          )}
        </dl>
      )}
      {day.observed_elsewhere && <p className="mt-3 text-xs text-muted-foreground">This holiday is observed on {longDate(day.observed_elsewhere)}.</p>}
      {(day.leave ?? []).map((l) => (
        <p key={`${l.leave_id}-${l.status}`} className="mt-2 text-sm">
          {l.label} <Badge tone={l.status === "APPROVED" ? "success" : "warning"}>{l.status === "APPROVED" ? "Approved" : "Pending"}</Badge>
        </p>
      ))}
      <p className="mt-3 text-xs text-muted-foreground">
        {day.working_portion === "NONE" ? "Not a working day for you." : day.working_portion === "FULL" ? "Working day." : day.working_portion === "FIRST_HALF" ? "You work the morning." : "You work the afternoon."}
      </p>
      <p className="sr-only">{describeDay(day)}</p>
    </motion.aside>
  );
}

function UpcomingList({ days, today, showPast, onShowPast, year }: { days: DayMark[]; today: string; showPast: boolean; onShowPast: (v: boolean) => void; year: number }) {
  const visible = showPast ? days : days.filter((d) => d.date >= today);
  const next = days.find((d) => d.date >= today)?.date;
  const months = visible.reduce<Record<number, DayMark[]>>((acc, d) => {
    (acc[Number(d.date.slice(5, 7))] ||= []).push(d);
    return acc;
  }, {});
  return (
    <div className="space-y-4" data-testid="holiday-list">
      <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <input type="checkbox" checked={showPast} onChange={(e) => onShowPast(e.target.checked)} className="h-4 w-4 rounded border-border" />
        Show past holidays
      </label>
      {visible.length === 0 && <Card><EmptyState icon={<List />} title={`No ${showPast ? "" : "upcoming "}holidays in ${year}`} /></Card>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Object.entries(months).map(([month, items], i) => (
          <motion.div key={month} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
            <Card className="p-5">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-primary">{MONTHS[Number(month) - 1]}</p>
              <ul className="space-y-3">
                {items.map((d) => {
                  const kind = markKind(d);
                  return (
                    <li key={d.date} className={`flex items-start gap-3 ${d.date < today ? "opacity-60" : ""}`} data-testid={`list-${d.date}`} data-kind={kind}>
                      <div className="flex w-12 shrink-0 flex-col items-center rounded-xl bg-primary-soft py-1.5 text-primary">
                        <span className="text-lg font-semibold leading-none">{Number(d.date.slice(8))}</span>
                        <span className="text-[10px] uppercase">{WEEKDAY_NAMES[d.weekday].slice(0, 3)}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{d.holiday!.name}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <MarkChip kind={kind} />
                          <span className="text-xs text-muted-foreground">{MARK_LABEL[kind]}</span>
                          {d.weekly_off && <Badge>On a weekly off</Badge>}
                          {d.holiday!.observance === "EMPLOYEE_SUBSTITUTE" && <Badge tone="info">Your substitute day</Badge>}
                          {d.date === next && <Badge tone="primary">Next</Badge>}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

