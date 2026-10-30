"use client";

import { History } from "lucide-react";

import { RosterApiError, rotationsApi, type RuleResult } from "@/components/rosters/api";
import { Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { fmtDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";

import {
  ISSUE_RULE_TEXT, OFF_TOKEN, ROTATION_ERROR_TEXT, VERSION_STATUS, autoPublishText, crewCodes, crewRow, cycleLength,
  lintLabel, type DraftValues,
} from "./rotationModel";

export function VersionBadge({ status }: { status: string }) {
  const s = VERSION_STATUS[status] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={s.tone} dot data-testid="version-status">{s.label}</Badge>;
}

interface Issue { code?: string; rule?: string | null; message?: string }

/**
 * A rotation refusal in plain words with every structural issue the API listed (§2.2: `issues[].rule` and its
 * message). `data-code` keeps the API code.
 */
export function RotationErrorNotice({ error, nameOf }: { error: unknown; nameOf?: (employeeId: number) => string }) {
  if (!error) return null;
  const code = error instanceof RosterApiError ? error.code : (error as { code?: string })?.code;
  const message = (code && ROTATION_ERROR_TEXT[code]) || (error instanceof Error ? error.message : "Something went wrong.");
  const issues = error instanceof RosterApiError ? (error.issues as Issue[]) : [];
  const fields = error instanceof RosterApiError ? error.fields ?? [] : [];
  const employee = error instanceof RosterApiError ? Number(error.details?.employee_id) : NaN;
  return (
    <div role="alert" className="space-y-2 rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm"
      data-testid="rotation-error" data-code={code}>
      <p className="font-medium text-danger">{message}</p>
      {issues.length > 0 && (
        <ul className="list-disc space-y-1 ps-5" data-testid="rotation-issues">
          {issues.map((i, n) => (
            <li key={n} data-rule={i.rule ?? i.code}>
              {i.rule && ISSUE_RULE_TEXT[i.rule] ? <span className="font-medium">{ISSUE_RULE_TEXT[i.rule]} </span> : null}
              <span className="text-muted-foreground">{i.message ?? i.code}</span>
            </li>
          ))}
        </ul>
      )}
      {issues.length === 0 && message !== (error as Error)?.message && error instanceof Error && (
        <p className="text-muted-foreground">{error.message}</p>
      )}
      {fields.length > 0 && (
        <ul className="list-disc ps-5 text-muted-foreground">{fields.map((f, n) => <li key={n}>{f.msg}</li>)}</ul>
      )}
      {Number.isFinite(employee) && employee > 0 && (
        <p className="text-muted-foreground">{nameOf ? nameOf(employee) : `Employee #${employee}`}</p>
      )}
    </div>
  );
}

/** Fatigue lints of the last save (§2.7): warnings only; each can be muted for this pattern on the next save. */
export function LintList({ lints, muted, onToggleMute, disabled }: {
  lints: RuleResult[];
  muted: string[];
  onToggleMute?: (key: string, mute: boolean) => void;
  disabled?: boolean;
}) {
  const keys = [...new Set(lints.map((l) => l.rule_key))];
  if (!keys.length) return <p className="text-sm text-muted-foreground" data-testid="lints-none">No fatigue warnings.</p>;
  return (
    <ul className="space-y-2" data-testid="lints">
      {keys.map((key) => {
        const crews = [...new Set(lints.filter((l) => l.rule_key === key)
          .map((l) => (l.details as { crew_code?: string } | undefined)?.crew_code).filter(Boolean))];
        const id = `mute-${key}`;
        return (
          <li key={key} className="rounded-xl border border-border px-3 py-2 text-sm" data-rule={key}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="warning">Warning</Badge>
              <span className="font-medium">{lintLabel(key)}</span>
              {crews.length > 0 && <span className="text-muted-foreground">Crew {crews.join(", ")}</span>}
            </div>
            {onToggleMute && (
              <label htmlFor={id} className="mt-1 inline-flex min-h-[32px] items-center gap-2 text-muted-foreground">
                <input id={id} type="checkbox" className="h-4 w-4" checked={muted.includes(key)} disabled={disabled}
                  onChange={(e) => onToggleMute(key, e.target.checked)} />
                Mute for this pattern (applies when you save)
              </label>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The cycle as a crew × day table (03-shifts/02 §2.1 worked example: "A+0 M M M M M M O O …"). Scrolls sideways in
 * its own focusable region, so the page never scrolls horizontally on a phone.
 */
export function CycleGrid({ draft, caption }: { draft: DraftValues; caption: string }) {
  const length = cycleLength(draft);
  if (!length) return null;
  const codes = crewCodes(draft);
  const rows = codes.length ? codes.map((code) => ({ code, row: crewRow(draft, code) })) : [{ code: "All", row: draft.tokens }];
  const offsets = new Map(draft.crewOffsets.map((c) => [c.code, c.offset]));
  return (
    <div role="region" aria-label={caption} tabIndex={0} data-testid="cycle-grid"
      className="scrollbar-thin max-w-full overflow-x-auto rounded-xl border border-border focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
      <table className="min-w-max border-collapse font-mono text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="sticky start-0 bg-surface px-2 py-1.5 text-start font-sans font-medium">Crew</th>
            {Array.from({ length }, (_, i) => (
              <th key={i} scope="col" className="px-1.5 py-1.5 text-center font-normal text-muted-foreground">{i + 1}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ code, row }) => (
            <tr key={code} className="border-b border-border/60 last:border-0">
              <th scope="row" className="sticky start-0 whitespace-nowrap bg-surface px-2 py-1.5 text-start font-sans font-medium">
                {code}{draft.mode === "BASE" && offsets.get(code) ? ` +${offsets.get(code)}` : ""}
              </th>
              {[...row].map((token, i) => (
                <td key={i} className={cn("px-1.5 py-1.5 text-center", token === OFF_TOKEN ? "text-muted-foreground" : "font-semibold")}>
                  {token}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The read-only "last auto-publish run" line (03-shifts/02 §3.5, EC AS-REL-06): progress while the daily
 * `roster.rotation_generate` job runs, the chunk summary after. Hidden when the viewer may not read it.
 */
export function LastAutoPublishRun({ refresh = 0 }: { refresh?: number }) {
  const { data, error, loading } = useApi(() => rotationsApi.lastAutoPublish(), [refresh]);
  if (error) return null;
  return (
    <p data-testid="last-auto-publish" className="mb-4 flex items-start gap-2 text-sm text-muted-foreground">
      <History className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>
        <span className="font-medium text-foreground">Last automatic publish</span>
        {data?.local_date ? ` (${fmtDate(data.local_date)})` : ""}: {loading && data === undefined ? "Loading…" : autoPublishText(data)}
      </span>
    </p>
  );
}
