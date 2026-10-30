"use client";

import { ArrowLeft, CheckCircle2, Save, Send, Trash2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { DetailGate, NotFoundState, WorkspaceHeader } from "@/components/payroll/inputs/shared";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/overlay";
import { Card } from "@/components/ui/primitives";
import { can } from "@/lib/access";
import { isIdSegment } from "@/lib/attendance-routes";
import { fmtDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";
import { useModalRoute } from "@/lib/useModalRoute";

import { rostersApi, type PublishPreview } from "./api";
import { PublishModal } from "./PublishModal";
import { RosterGrid } from "./RosterGrid";
import { PeriodStatusBadge, useBranches } from "./RosterPeriods";
import { ResultList, RosterErrorNotice } from "./RosterResults";
import { buildCells, periodDates, resultsByCell, toDraftCells, type PaletteValue } from "./rosterModel";

const CLOSED = new Set(["CLOSED", "CANCELLED"]);

/**
 * `/rosters/{period_id}` (§13): the Roster Grid of one period. Edits stay on screen until "Save changes"
 * (`PUT /drafts`, the period's row_version); "Validate" runs the publish rules as a dry run and badges the cells;
 * "Publish…" opens `PublishModal`; "Discard drafts" drops every saved draft of the period.
 */
export function RosterPeriodView({ id }: { id: string }) {
  const { me } = useCan();
  const confirm = useConfirm();
  const valid = isIdSegment(id);
  const { data, error, loading, reload } = useApi(() => (valid ? rostersApi.grid(id) : Promise.resolve(null)), [id]);
  const branches = useBranches();
  const publishRoute = useModalRoute("roster-publish", { keys: [] });
  const [pending, setPending] = useState<Map<string, PaletteValue>>(new Map());
  const [validation, setValidation] = useState<PublishPreview | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [busy, setBusy] = useState<"save" | "validate" | "discard" | null>(null);

  const period = data?.period;
  // §5.2: while a publication waits for approval the drafts are frozen; with approval on, planners send for approval.
  const frozen = !!data?.approval_pending;
  const viaApproval = !!data?.publish_requires_approval;
  const plan = can(me, P.ROSTER_PLAN) && !!period && !CLOSED.has(period.status) && !frozen;
  const publish = (can(me, P.ROSTER_PUBLISH) || (viaApproval && can(me, P.ROSTER_PLAN))) && !!period
    && !CLOSED.has(period.status) && !frozen;
  const dates = useMemo(() => (period ? periodDates(period.start_date, period.end_date) : []), [period]);
  const cells = useMemo(() => buildCells(data?.entries ?? [], data?.drafts ?? []), [data]);
  const badges = useMemo(() => resultsByCell(validation?.results), [validation]);
  const names = useMemo(() => new Map((data?.employees ?? []).map((e) => [e.id, e.name])), [data]);
  const nameOf = useCallback((employeeId: number) => names.get(employeeId) ?? `Employee #${employeeId}`, [names]);
  const unsaved = pending.size;

  const refresh = async () => {
    setValidation(null);
    await reload();
  };

  const save = async () => {
    if (!period || !unsaved) return;
    setBusy("save");
    setActionError(null);
    try {
      const result = await rostersApi.putDrafts(period.id, toDraftCells(pending), period.row_version);
      toast.success(`Saved ${result.saved} ${result.saved === 1 ? "cell" : "cells"} as drafts.`);
      setPending(new Map());
      await refresh();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(null);
    }
  };

  const validate = async () => {
    if (!period) return;
    setBusy("validate");
    setActionError(null);
    try {
      const result = await rostersApi.validate(period.id);
      setValidation(result);
      if (result.nothing_to_publish) toast("No drafts to check.");
      else if (!result.results.length) toast.success("No rule findings.");
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(null);
    }
  };

  const discard = async () => {
    if (!period) return;
    const ok = await confirm({ title: "Discard all drafts?", message: `The ${period.drafts} saved draft ${period.drafts === 1 ? "cell" : "cells"} of this period will be removed. Published cells stay as they are.`,
      confirmLabel: "Discard drafts", tone: "danger" });
    if (!ok) return;
    setBusy("discard");
    setActionError(null);
    try {
      await rostersApi.discardDrafts(period.id, period.row_version);
      toast.success("Drafts discarded.");
      setPending(new Map());
      await refresh();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(null);
    }
  };

  if (!valid) return <NotFoundState what="Roster period" backHref="/rosters" backLabel="Back to Rosters" />;
  return (
    <DetailGate loading={loading} error={error} hasData={!!data} onRetry={reload} what="Roster period" backHref="/rosters" backLabel="Back to Rosters">
      {data && period && (
        <div className="space-y-5">
          <Link href="/rosters" className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden /> Back to Rosters
          </Link>
          <WorkspaceHeader eyebrow="Rosters" showHideAmounts={false}
            title={<span className="flex flex-wrap items-center gap-3">{period.name}<PeriodStatusBadge status={period.status} /></span>}
            description={<span data-testid="period-summary">
              <span className="font-mono">{period.code}</span> · {branches.name(period.branch_id)} · {fmtDate(period.start_date)} – {fmtDate(period.end_date)}
              {" · "}{period.drafts ? `${period.drafts} ${period.drafts === 1 ? "draft" : "drafts"} waiting` : "No drafts"}
            </span>}
            actions={<>
              {plan && unsaved > 0 && <Button variant="ghost" onClick={() => setPending(new Map())}><Undo2 className="h-4 w-4" aria-hidden /> Undo changes</Button>}
              {plan && <Button data-testid="save-drafts" disabled={!unsaved} loading={busy === "save"} onClick={() => void save()}>
                <Save className="h-4 w-4" aria-hidden /> {unsaved ? `Save changes (${unsaved})` : "Save changes"}
              </Button>}
              {plan && <Button variant="secondary" data-testid="validate" disabled={unsaved > 0 || !period.drafts} loading={busy === "validate"}
                title={unsaved ? "Save your changes first" : undefined} onClick={() => void validate()}>
                <CheckCircle2 className="h-4 w-4" aria-hidden /> Validate
              </Button>}
              {plan && period.drafts > 0 && <Button variant="danger-ghost" data-testid="discard-drafts" loading={busy === "discard"} disabled={unsaved > 0}
                onClick={() => void discard()}>
                <Trash2 className="h-4 w-4" aria-hidden /> Discard drafts
              </Button>}
              {publish && <Button variant="secondary" data-testid="open-publish" disabled={unsaved > 0 || !period.drafts}
                title={unsaved ? "Save your changes first" : undefined} onClick={() => publishRoute.openModal()}>
                <Send className="h-4 w-4" aria-hidden /> {viaApproval ? "Send for approval…" : "Publish…"}
              </Button>}
            </>} />

          {frozen && (
            <p className="rounded-xl border border-info/40 bg-info-soft px-4 py-3 text-sm" role="status" data-testid="approval-pending">
              This roster is waiting for publication approval, so its drafts are locked.{" "}
              <Link className="font-medium text-primary underline" href="/approvals?module=roster_publish">Open approvals</Link>
            </p>
          )}

          <RosterErrorNotice error={actionError} nameOf={nameOf} />

          <Card className="p-4">
            {data.employees.length === 0 ? (
              <p className="text-sm text-muted-foreground">No employees are in this period&apos;s branch yet.</p>
            ) : (
              <RosterGrid employees={data.employees} dates={dates} cells={cells} shifts={data.shifts} pending={pending}
                onPendingChange={setPending} results={badges} readOnly={!plan} />
            )}
          </Card>

          {validation && !validation.nothing_to_publish && (
            <Card className="space-y-3 p-5" data-testid="validation-panel">
              <h2 className="font-display text-base font-semibold">Validation</h2>
              {validation.results.length === 0
                ? <p className="text-sm text-success" data-testid="validation-clean">No rule findings. The drafts are ready to publish.</p>
                : <>
                  <p className="text-sm text-muted-foreground">
                    {validation.results.length} {validation.results.length === 1 ? "finding" : "findings"}
                    {validation.blocking?.length ? `, ${validation.blocking.length} blocking publication` : ""}. Flagged cells carry a badge.
                  </p>
                  <ResultList results={validation.results} nameOf={nameOf} />
                </>}
            </Card>
          )}

          {publish && <PublishModal periodId={period.id} nameOf={nameOf} onPublished={() => void refresh()} />}
        </div>
      )}
    </DetailGate>
  );
}
