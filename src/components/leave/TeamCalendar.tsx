"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CalendarDays, ChevronLeft, ChevronRight, Users } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/layout";
import { Avatar, Badge, Card, Skeleton } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { fmtDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { datesBetween, leaveApi } from "@/lib/leave/api";
import { leaveChipStyle, leaveColor } from "@/lib/leave/colors";
import { useLeaveChanged } from "@/lib/leave/events";
import type { CalendarLeave, CalendarPerson } from "@/lib/leave/types";

import { useLeaveAccess } from "./LeaveAccessContext";
import { useLeaveOverlays } from "./LeaveOverlays";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAY = ["S", "M", "T", "W", "T", "F", "S"];

function monthRange(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(last)}` };
}

function shift(ym: string, delta: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

/** Which part of `date` a leave covers: FULL, FIRST_HALF (ends at mid-day) or SECOND_HALF (starts at mid-day). */
export function coverOn(leave: CalendarLeave, date: string): "FULL" | "FIRST_HALF" | "SECOND_HALF" | null {
  if (date < leave.start_date || date > leave.end_date) return null;
  if (date === leave.start_date && leave.start_portion === "SECOND_HALF") return "SECOND_HALF";
  if (date === leave.end_date && leave.end_portion === "FIRST_HALF") return "FIRST_HALF";
  return "FULL";
}

function cellLabel(person: CalendarPerson, leave: CalendarLeave, date: string, part: string) {
  const bits = [`${person.name}: ${leave.label}`, fmtDate(date, "EEE d MMM")];
  if (part !== "FULL") bits.push(part === "FIRST_HALF" ? "first half" : "second half");
  if (leave.status !== "APPROVED") bits.push("pending");
  return bits.join(", ");
}

/**
 * `/leaves/calendar` — who is away, month by month (`GET /leaves/team-calendar`, at most 93 days): people × days on
 * wide screens, a day-by-day list on phones. Colleagues outside the viewer's scope show as "Away" (`leave-neutral`);
 * pending leave is lighter with a dashed edge; half days fill half a cell.
 */
export function TeamCalendar() {
  const { access } = useLeaveAccess();
  const { openLeave } = useLeaveOverlays();
  const today = access?.local_today ?? new Date().toISOString().slice(0, 10);
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const range = monthRange(month);
  const { data, error, loading, reload } = useApi(() => leaveApi.teamCalendar(range.start, range.end), [range.start, range.end]);
  useLeaveChanged(() => void reload());
  const days = useMemo(() => datesBetween(range.start, range.end), [range.start, range.end]);
  const [y, m] = month.split("-").map(Number);

  const people = data?.people ?? [];
  const withLeave = people.filter((p) => p.leaves.length > 0);

  return (
    <div className="space-y-4" data-testid="team-calendar">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" aria-label="Previous month" onClick={() => setMonth((v) => shift(v, -1))} data-testid="calendar-prev">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <AnimatePresence mode="wait" initial={false}>
            <motion.h2
              key={month}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.18 }}
              className="min-w-40 text-center text-lg font-semibold tabular-nums"
              aria-live="polite"
              data-testid="calendar-month-label"
            >
              {MONTHS[m - 1]} {y}
            </motion.h2>
          </AnimatePresence>
          <Button size="icon" variant="ghost" aria-label="Next month" onClick={() => setMonth((v) => shift(v, 1))} data-testid="calendar-next">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="secondary" className="ms-1" disabled={month === today.slice(0, 7)} onClick={() => setMonth(today.slice(0, 7))} data-testid="calendar-today">
            Today
          </Button>
        </div>
        <ul className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground" aria-label="Legend">
          <li className="inline-flex items-center gap-1.5"><span className="h-3 w-5 rounded border" style={leaveChipStyle("leave-1")} aria-hidden /> Approved</li>
          <li className="inline-flex items-center gap-1.5"><span className="h-3 w-5 rounded border" style={leaveChipStyle("leave-1", { pending: true })} aria-hidden /> Pending</li>
          <li className="inline-flex items-center gap-1.5"><span className="relative h-3 w-5 overflow-hidden rounded border border-border"><span className="absolute inset-y-0 start-0 w-1/2" style={{ backgroundColor: leaveColor("leave-1", 0.4) }} /></span> Half day</li>
          <li className="inline-flex items-center gap-1.5"><span className="h-3 w-5 rounded border" style={leaveChipStyle("leave-neutral")} aria-hidden /> Away</li>
        </ul>
      </Card>

      {error ? (
        <Card><ErrorState message={error.message} onRetry={() => void reload()} /></Card>
      ) : loading && !data ? (
        <Skeleton className="h-80 rounded-2xl" />
      ) : people.length === 0 ? (
        <Card><EmptyState icon={<Users />} title="No one to show" description="Your company shows the team calendar to your team only, or it is turned off." /></Card>
      ) : (
        <>
          {/* -------------------------------------------- grid (md and up) */}
          <Card className={cn("hidden overflow-hidden md:block", loading && "opacity-70")}>
            <div className="scrollbar-thin overflow-x-auto">
              <table className="w-full border-collapse text-xs" data-testid="calendar-grid">
                <caption className="sr-only">Team leave in {MONTHS[m - 1]} {y}</caption>
                <thead>
                  <tr>
                    <th scope="col" className="sticky start-0 z-10 min-w-44 border-b border-border bg-surface px-3 py-2 text-start font-medium text-muted-foreground">Person</th>
                    {days.map((d) => {
                      const wd = weekday(d);
                      return (
                        <th key={d} scope="col" className={cn("min-w-7 border-b border-border px-0 py-1.5 text-center font-medium", d === today ? "text-primary" : "text-muted-foreground")}>
                          <span className="block text-[10px]">{WEEKDAY[wd]}</span>
                          <span className={cn("mx-auto mt-0.5 flex h-5 w-5 items-center justify-center rounded-full tabular-nums", d === today && "bg-primary text-primary-foreground")}>{Number(d.slice(8))}</span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {people.map((p, row) => (
                    <motion.tr key={p.employee_id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(row, 15) * 0.02 }} data-testid={`calendar-row-${p.employee_id}`}>
                      <th scope="row" className="sticky start-0 z-10 border-b border-border/60 bg-surface px-3 py-1.5 text-start font-normal">
                        <span className="flex items-center gap-2">
                          <Avatar name={p.name} size={24} />
                          <span className={cn("truncate text-sm", p.is_me && "font-semibold")}>{p.name}{p.is_me && <span className="text-muted-foreground"> (you)</span>}</span>
                        </span>
                      </th>
                      {days.map((d) => {
                        const leave = p.leaves.find((l) => coverOn(l, d));
                        const base = cn("h-9 border-b border-border/60 p-0", d === today && "bg-primary/5");
                        if (!leave) return <td key={d} className={base} />;
                        const part = coverOn(leave, d)!;
                        const pending = leave.status !== "APPROVED";
                        const label = cellLabel(p, leave, d, part);
                        const block = (
                          <span
                            className={cn("absolute inset-y-1 border", part === "FULL" ? "inset-x-0" : part === "FIRST_HALF" ? "start-0 w-1/2 rounded-e-md" : "end-0 w-1/2 rounded-s-md",
                              d === leave.start_date && part === "FULL" && "ms-0.5 rounded-s-md", d === leave.end_date && part === "FULL" && "me-0.5 rounded-e-md")}
                            style={leaveChipStyle(leave.color_token, { pending })}
                          />
                        );
                        return (
                          <td key={d} className={base} data-testid={`calendar-cell-${p.employee_id}-${d}`} data-status={leave.status} data-part={part}>
                            {leave.id ? (
                              <button type="button" className="relative block h-9 w-full focus-visible:z-10" onClick={() => openLeave(leave.id!)} aria-label={label} title={label}>
                                {block}
                              </button>
                            ) : (
                              <span className="relative block h-9 w-full" role="img" aria-label={label} title={label}>{block}</span>
                            )}
                          </td>
                        );
                      })}
                    </motion.tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" className="sticky start-0 z-10 bg-surface px-3 py-2 text-start text-xs font-medium text-muted-foreground">Away</th>
                    {days.map((d) => {
                      const n = data?.away_by_day[d] ?? 0;
                      return <td key={d} className={cn("py-2 text-center tabular-nums", n ? "font-semibold text-foreground" : "text-muted-foreground/50")}>{n || "·"}</td>;
                    })}
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          {/* -------------------------------------------- list (phones) */}
          <div className="space-y-3 md:hidden" data-testid="calendar-list">
            {withLeave.length === 0 ? (
              <Card><EmptyState icon={<CalendarDays />} title={`No leave in ${MONTHS[m - 1]}`} /></Card>
            ) : (
              days
                .map((d) => ({ d, items: withLeave.flatMap((p) => p.leaves.filter((l) => coverOn(l, d)).map((l) => ({ p, l }))) }))
                .filter((x) => x.items.length > 0)
                .map(({ d, items }, i) => (
                  <motion.div key={d} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 10) * 0.03 }}>
                    <Card className={cn("p-4", d === today && "ring-2 ring-primary/40")} data-testid={`calendar-day-${d}`}>
                      <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
                        {fmtDate(d, "EEE, d MMM")}
                        {d === today && <Badge tone="primary">Today</Badge>}
                      </p>
                      <ul className="space-y-2">
                        {items.map(({ p, l }) => {
                          const part = coverOn(l, d)!;
                          const pending = l.status !== "APPROVED";
                          return (
                            <li key={`${p.employee_id}-${l.start_date}`}>
                              <button type="button" disabled={!l.id} onClick={() => l.id && openLeave(l.id)}
                                className="flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-start text-sm disabled:cursor-default"
                                style={leaveChipStyle(l.color_token, { pending })}>
                                <Avatar name={p.name} size={24} />
                                <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                                <span className="text-xs text-muted-foreground">
                                  {l.label}{part !== "FULL" ? ` · ${part === "FIRST_HALF" ? "first half" : "second half"}` : ""}{pending ? " · pending" : ""}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </Card>
                  </motion.div>
                ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
