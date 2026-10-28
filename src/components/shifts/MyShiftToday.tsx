"use client";

import { CalendarClock } from "lucide-react";
import { useEffect, useState } from "react";

import { shiftsApi, type ExplainDay } from "@/components/shifts/api";
import { timesInZone } from "@/components/shifts/shiftModel";

/** "YYYY-MM-DD" of `zone` now. */
export function todayIn(zone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date());
}

/** One line on My day: the shift that resolves today (rule, placement), times in the work zone (AS-M1 exit 3 d–e). */
export function MyShiftToday({ employeeId, zone, date }: { employeeId: number; zone: string; date?: string }) {
  const [day, setDay] = useState<ExplainDay | null>(null);
  const on = date ?? todayIn(zone);
  useEffect(() => {
    let alive = true;
    shiftsApi.resolve(employeeId, on, on).then((r) => alive && setDay(r.days[0] ?? null)).catch(() => alive && setDay(null));
    return () => { alive = false; };
  }, [employeeId, on]);
  if (!day || !day.shift_id) return null;
  const work = day.work_timezone || zone;
  const times = day.start_time && day.end_time
    ? timesInZone(on, day.start_time, day.end_time, day.anchor_timezone, work) : null;
  return (
    <p className="mt-2 flex items-center gap-2 text-sm opacity-95" data-testid="my-shift-today">
      <CalendarClock className="h-4 w-4" aria-hidden />
      <span>
        Shift <span className="font-semibold">{day.shift_code}</span>
        {times && <> · {times.start}–{times.end}{times.endDayOffset > 0 ? " (+1)" : ""}</>}
      </span>
    </p>
  );
}
