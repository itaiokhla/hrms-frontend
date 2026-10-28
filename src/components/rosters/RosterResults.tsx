"use client";

import { Badge } from "@/components/ui/primitives";

import { RosterApiError, type RuleResult } from "./api";
import { ROSTER_ERROR_TEXT, dateLabel, measuredText, ruleLabel, severityLabel } from "./rosterModel";

const TONE: Record<string, "danger" | "warning" | "info"> = { BLOCK: "danger", REQUIRE_REASON: "warning", WARN: "info" };

/**
 * Rule results as a list (§6.1): rule, severity, employee, dates and measured vs limit. Used by Validate, the
 * publish preview and the issues of a publish refusal.
 */
export function ResultList({ results, nameOf, testId = "validation-results" }: {
  results: RuleResult[];
  nameOf: (employeeId: number) => string;
  testId?: string;
}) {
  return (
    <ul className="space-y-2" data-testid={testId}>
      {results.map((r, n) => {
        const measured = measuredText(r);
        return (
          <li key={`${r.rule_key}-${r.employee_id}-${n}`} data-testid="validation-result" data-rule={r.rule_key} data-severity={r.severity}
            className="rounded-xl border border-border px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={TONE[r.severity] ?? "neutral"}>{severityLabel(r.severity)}</Badge>
              <span className="font-medium">{ruleLabel(r.rule_key)}</span>
              <span className="font-mono text-xs text-muted-foreground">{r.rule_key}</span>
            </div>
            <p className="mt-1 text-muted-foreground">
              {r.employee_id != null && <span className="text-foreground">{nameOf(r.employee_id)}</span>}
              {r.dates?.length ? <> · {r.dates.map((d) => dateLabel(String(d).slice(0, 10))).join(", ")}</> : null}
              {measured && <> · {measured}</>}
            </p>
            {r.message && <p className="mt-1 text-muted-foreground">{r.message}</p>}
          </li>
        );
      })}
    </ul>
  );
}

/** A roster refusal in plain words (`data-code` keeps the API code), with its issues or stale cells listed. */
export function RosterErrorNotice({ error, nameOf }: { error: unknown; nameOf: (employeeId: number) => string }) {
  if (!error) return null;
  const code = error instanceof RosterApiError ? error.code : (error as { code?: string })?.code;
  const message = (code && ROSTER_ERROR_TEXT[code]) || (error instanceof Error ? error.message : "Something went wrong.");
  const issues = error instanceof RosterApiError ? (error.issues as unknown as RuleResult[]) : [];
  const stale = error instanceof RosterApiError && Array.isArray(error.details?.cells)
    ? (error.details!.cells as { employee_id: number; shift_date: string }[]) : [];
  return (
    <div role="alert" className="space-y-2 rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm" data-testid="roster-error" data-code={code}>
      <p className="font-medium text-danger">{message}</p>
      {code && <p className="font-mono text-xs text-muted-foreground">{code}</p>}
      {issues.length > 0 && issues.some((i) => i.rule_key) && <ResultList results={issues} nameOf={nameOf} testId="roster-error-issues" />}
      {stale.length > 0 && (
        <ul className="list-disc ps-5 text-muted-foreground" data-testid="roster-error-cells">
          {stale.map((c) => <li key={`${c.employee_id}-${c.shift_date}`}>{nameOf(c.employee_id)} · {dateLabel(c.shift_date)}</li>)}
        </ul>
      )}
    </div>
  );
}
