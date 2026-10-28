"use client";

import { CalendarClock, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

import { useCan } from "@/components/access/Can";
import { WorkspaceHeader } from "@/components/payroll/inputs/shared";
import { addDays, todayIn } from "@/components/shifts/shiftModel";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/layout";
import { Badge, Card, Skeleton } from "@/components/ui/primitives";
import { fmtDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { cn } from "@/lib/cn";

import { rostersApi, type ScheduleDay } from "./api";
import { dateLabel, isWeekend, scheduleText, scheduleTimes } from "./rosterModel";

const RANGE_DAYS = 14;
const SOURCE_TEXT: Record<string, string> = { ROSTER: "Roster", RULE: "Assignment rule", PLACEMENT: "Your usual shift" };

function DayRow({ day, today, zone }: { day: ScheduleDay; today: string; zone: string }) {
  const text = scheduleText(day);
  const times = day.kind === "OFF" ? null : scheduleTimes(day, zone);
  const kind = day.kind === "OFF" ? "off" : day.shift_id ? "work" : "none";
  return (
    <li data-testid={`schedule-day-${day.date}`} data-kind={kind}
      className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm", isWeekend(day.date) && "bg-muted/30",
        day.date === today && "bg-primary-soft/40")}>
      <span className="w-40 shrink-0 font-medium">
        {dateLabel(day.date)}
        {day.date === today && <Badge tone="primary" className="ms-2">Today</Badge>}
      </span>
      {kind === "work" ? (
        <span className="flex flex-wrap items-center gap-3">
          <span className="rounded-lg bg-primary-soft px-2 py-0.5 font-mono text-sm font-semibold text-primary" data-testid="schedule-shift">{text}</span>
          <span data-testid="schedule-times">{times ?? "No set times"}</span>
          {day.work_timezone && times && <span className="text-xs text-muted-foreground">{day.work_timezone}</span>}
        </span>
      ) : (
        <span className={cn(kind === "off" ? "font-medium text-muted-foreground" : "text-muted-foreground/80")} data-testid="schedule-shift">{text}</span>
      )}
      {day.source !== "NONE" && SOURCE_TEXT[day.source] && <span className="ms-auto text-xs text-muted-foreground">{SOURCE_TEXT[day.source]}</span>}
    </li>
  );
}

/**
 * `/rosters/my-schedule` (§13 My schedule): the caller's days, two weeks at a time, from published roster entries,
 * then assignment rules and placements. Anchored shift times are converted to the work zone (`timesInZone`).
 */
export function MySchedule() {
  const { me } = useCan();
  const zone = me?.company?.timezone || "UTC";
  // null = the API default (the employee-local today and 13 days after it).
  const [from, setFrom] = useState<string | null>(null);
  const { data, error, loading, reload } = useApi(
    () => rostersApi.mySchedule(from ?? undefined, from ? addDays(from, RANGE_DAYS - 1) : undefined), [from]);
  const today = useMemo(() => todayIn(data?.days.find((d) => d.work_timezone)?.work_timezone || zone), [data, zone]);
  const weeks = useMemo(() => {
    const days = data?.days ?? [];
    const out: ScheduleDay[][] = [];
    for (let i = 0; i < days.length; i += 7) out.push(days.slice(i, i + 7));
    return out;
  }, [data]);
  const start = data?.from ?? from;
  const shift = (days: number) => start && setFrom(addDays(start, days));

  return (
    <div>
      <WorkspaceHeader eyebrow="Attendance" title="My schedule" showHideAmounts={false}
        description={data ? <span data-testid="schedule-range">{fmtDate(data.from)} – {fmtDate(data.to)}</span> : "Your shifts for the next two weeks."}
        actions={<>
          <Button variant="secondary" data-testid="schedule-prev" disabled={!start || loading} onClick={() => shift(-RANGE_DAYS)}>
            <ChevronLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden /> Previous 2 weeks
          </Button>
          {from !== null && <Button variant="ghost" data-testid="schedule-today" onClick={() => setFrom(null)}>Today</Button>}
          <Button variant="secondary" data-testid="schedule-next" disabled={!start || loading} onClick={() => shift(RANGE_DAYS)}>
            Next 2 weeks <ChevronRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
          </Button>
        </>} />
      {error ? (
        error.status === 404
          ? <Card><EmptyState icon={<CalendarClock />} title="No employee profile" description="Your sign-in isn't linked to an employee, so there is no schedule to show." /></Card>
          : <ErrorState message={error.message} onRetry={reload} />
      ) : !data ? (
        <Card className="space-y-2 p-4" aria-busy="true">{Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}</Card>
      ) : (
        <div className={cn("space-y-4", loading && "opacity-60")} data-testid="my-schedule">
          {weeks.map((week) => (
            <Card key={week[0].date} className="overflow-hidden">
              <h2 className="border-b border-border px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Week of {fmtDate(week[0].date)}
              </h2>
              <ul className="divide-y divide-border">
                {week.map((day) => <DayRow key={day.date} day={day} today={today} zone={zone} />)}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
