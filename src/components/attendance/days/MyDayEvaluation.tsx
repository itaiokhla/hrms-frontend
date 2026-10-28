"use client";

import Link from "next/link";

import { useCan } from "@/components/access/Can";
import { Badge, Card } from "@/components/ui/primitives";
import { todayISO } from "@/lib/format";
import { useApi } from "@/lib/hooks";

import { attendanceDaysApi, type DayResult } from "./api";

const LABELS: Record<DayResult, string> = {
  PRESENT: "Present", HALF_DAY: "Half day", ABSENT: "Absent", MISSING_PUNCH: "Missing punch", UNMARKED: "Unmarked",
  PENDING: "In progress", OFF: "Off",
};

/** My day with the evaluation (AS-M3; 04-attendance/03 §14): v2 tenants only, shows today's decided facts. */
export function MyDayEvaluation({ refreshKey }: { refreshKey?: unknown }) {
  const { me } = useCan();
  const employeeId = me?.employee?.id;
  const enabled = !!employeeId && me?.attendance?.v2 === true;
  const day = todayISO();
  const { data } = useApi(
    () => attendanceDaysApi.get(employeeId as number, day).catch(() => null), [employeeId, day, refreshKey],
    { enabled });
  const evaluation = data?.day;
  if (!enabled || !evaluation) return null;
  const late = evaluation.late_mark
    ? (evaluation.late_excused ? "late, excused" : `late by ${evaluation.late_minutes ?? 0} min`)
    : null;
  return (
    <Card className="flex flex-wrap items-center gap-3 p-4 lg:col-span-2" data-testid="my-day-evaluation">
      <span className="text-sm font-medium">Today</span>
      <Badge tone={evaluation.day_result === "PRESENT" ? "success" : evaluation.day_result === "PENDING" ? "info" : "warning"} dot>
        {LABELS[evaluation.day_result]}
      </Badge>
      {evaluation.net_minutes !== null && (
        <span className="text-sm text-muted-foreground">{Math.floor(evaluation.net_minutes / 60)} h {evaluation.net_minutes % 60} min worked</span>
      )}
      {late && <Badge tone="warning">{late}</Badge>}
      <Link href={`/attendance/days/${employeeId}/${day}`} className="ms-auto text-sm font-medium text-primary hover:underline">Details</Link>
    </Card>
  );
}
