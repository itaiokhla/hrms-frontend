"use client";

import { CheckCircle2, Circle } from "lucide-react";
import { useMemo, useState } from "react";

import { useCan } from "@/components/access/Can";
import { EmployeePicker, type PickedEmployee } from "@/components/shared/EmployeePicker";
import { Field, Input } from "@/components/ui/field";
import { Sheet } from "@/components/ui/overlay";
import { Skeleton } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { fmtDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Shift } from "@/lib/types";
import { useModalRoute } from "@/lib/useModalRoute";

import { shiftsApi, type ExplainCandidate, type ExplainDay } from "./api";
import { ShiftChip } from "./ShiftChip";
import { ShiftErrorNotice } from "./ShiftForm";
import { explainSummary, lossReason, timesInZone, todayIn } from "./shiftModel";

function candidateText(c: ExplainCandidate, code: (id?: number) => string): string {
  if (c.step === "RULE") return `Rule “${c.name ?? `#${c.rule_id}`}” (priority ${c.priority}) → ${code(c.shift_id)}`;
  if (c.step === "PLACEMENT") return `Placement shift ${code(c.shift_id)}`;
  return `${c.step.toLowerCase()} ${code(c.shift_id)}`;
}

/** Times in the work zone; an anchored version (D-AS-38) also shows its own clock ("09:00–18:00 America/New_York"). */
function localTimes(day: ExplainDay, shift?: Shift): string {
  const anchor = shift?.current_version?.id === day.shift_version_id ? shift?.current_version?.anchor_timezone : null;
  const zone = day.work_timezone ?? "";
  if (!anchor || !zone) return `${day.start_time}–${day.end_time}${zone ? ` ${zone}` : ""}`;
  const t = timesInZone(day.date, day.start_time!, day.end_time!, anchor, zone);
  return `${day.start_time}–${day.end_time} ${anchor} · ${t.start}–${t.end}${t.endDayOffset > 0 ? " (+1)" : ""} ${zone}`;
}

/** One date's resolution: the four steps (roster, rules, placement, none), the winner highlighted (§11.4, §17.6). */
export function ExplainDayView({ day, shifts }: { day: ExplainDay; shifts: Map<number, Shift> }) {
  const code = (id?: number | null) => (id ? shifts.get(id)?.code ?? `#${id}` : "—");
  const rules = day.candidates.filter((c) => c.step === "RULE");
  const placement = day.candidates.filter((c) => c.step === "PLACEMENT");
  const steps: { key: string; title: string; won: boolean; lines: { text: string; won: boolean; reason?: string | null }[] }[] = [
    { key: "roster", title: "Published roster", won: day.source === "ROSTER", lines: [] },
    { key: "rule", title: "Assignment rules", won: day.source === "RULE", lines: rules.map((c) => ({ text: candidateText(c, code), won: c.won, reason: c.reason })) },
    { key: "placement", title: "Placement shift", won: day.source === "PLACEMENT", lines: placement.map((c) => ({ text: candidateText(c, code), won: c.won, reason: c.reason })) },
    { key: "none", title: "No shift", won: day.source === "NONE", lines: [] },
  ];
  const shift = day.shift_id ? shifts.get(day.shift_id) : undefined;
  return (
    <article className="space-y-3" data-testid={`explain-${day.date}`}>
      <header>
        <h3 className="font-semibold">{fmtDate(day.date, "EEE d MMM yyyy")}</h3>
        <p className="text-sm" data-testid="explain-summary">{explainSummary(day)}</p>
        {day.shift_id && (
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <ShiftChip code={code(day.shift_id)} color={shift?.color_token} />
            {day.start_time && day.end_time ? localTimes(day, shift) : "No set times"}
          </p>
        )}
      </header>
      <ol className="space-y-2" aria-label="Resolution steps">
        {steps.map((s, i) => (
          <li key={s.key} className={cn("rounded-xl border px-3 py-2 text-sm", s.won ? "border-success/40 bg-success-soft" : "border-border")}>
            <p className="flex items-center gap-2 font-medium">
              {s.won ? <CheckCircle2 className="h-4 w-4 text-success" aria-hidden /> : <Circle className="h-4 w-4 text-muted-foreground" aria-hidden />}
              {i + 1}. {s.title}{s.won ? " — applies" : ""}
            </p>
            {s.lines.length > 0 ? (
              <ul className="mt-1 space-y-0.5 ps-6">
                {s.lines.map((l, j) => <li key={j}>{l.text}: {l.won ? "chosen" : lossReason(l.reason)}</li>)}
              </ul>
            ) : (
              <p className="ps-6 text-muted-foreground">{s.key === "roster" ? "No published roster entry." : s.key === "none" ? (s.won ? "Nothing matched." : "Not reached.") : "Nothing matched."}</p>
            )}
          </li>
        ))}
      </ol>
    </article>
  );
}

/**
 * "Which shift applies?" (`?modal=explain-resolution&kind=SHIFT&employee_id=&date=`): GET /shifts/resolve for one
 * employee and date, as the four steps with each loser's reason.
 */
export function ShiftExplainSheet({ shifts }: { shifts: Map<number, Shift> }) {
  const { me } = useCan();
  const route = useModalRoute("explain-resolution", { keys: ["kind", "employee_id", "date"] });
  const today = useMemo(() => todayIn(me?.company?.timezone), [me?.company?.timezone]);
  const urlEmployee = route.param("employee_id");
  const [picked, setPicked] = useState<PickedEmployee | null>(null);
  const [date, setDate] = useState<string>("");
  const employeeId = picked?.id ?? (urlEmployee && /^\d+$/.test(urlEmployee) ? Number(urlEmployee) : null);
  const day = date || route.param("date") || today;
  const { data, error, loading } = useApi(
    () => (employeeId && route.open ? shiftsApi.resolve(employeeId, day, day) : Promise.resolve(null)),
    [employeeId, day, route.open],
  );
  return (
    <Sheet open={route.open} onOpenChange={route.onOpenChange} width="max-w-xl" title="Which shift applies?">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Employee">
            <EmployeePicker value={picked ?? (employeeId ? { id: employeeId, full_name: `Employee #${employeeId}` } : null)} onChange={setPicked} />
          </Field>
          <Field label="Date">
            <Input type="date" value={day} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        {!employeeId ? <p className="text-sm text-muted-foreground">Choose an employee.</p>
          : error ? <ShiftErrorNotice error={error} />
          : loading || !data ? <Skeleton className="h-48 w-full" />
          : data.days.map((d) => <ExplainDayView key={d.date} day={d} shifts={shifts} />)}
      </div>
    </Sheet>
  );
}
