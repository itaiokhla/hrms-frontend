"use client";

import { motion } from "framer-motion";
import { AlertTriangle, CalendarCheck2, Info, Minus, Pencil, Plus, ShieldCheck, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";

import { Notice } from "@/components/payroll/inputs/shared";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { Badge, Skeleton } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { HolidayApiError, yearsApi, type YearChangeResult, type YearImpact, type YearView } from "@/lib/holiday/api";
import { useSession } from "@/store/session";

import { longDate } from "./RulePreviewList";

const CHANGE_ICON = { added: Plus, removed: Minus, changed: Pencil } as const;
const CHANGE_TONE = { added: "text-success", removed: "text-danger", changed: "text-warning" } as const;

export type PublishMode = "publish" | "approve-amendment";

/** The confirm-warnings still to tick before the commit (DR-24 d: the primary stays disabled until then). */
export function missingAcknowledgements(impact: YearImpact | null, ticked: Set<string>): string[] {
  if (!impact) return [];
  return impact.warnings.filter((w) => w.confirm && !ticked.has(w.code)).map((w) => w.code);
}

/** What the primary button says and whether this viewer may press it (V3-027 second person). */
export function primaryAction(year: Pick<YearView, "year" | "requires_second_person" | "pending_request">, mode: PublishMode, userId?: number) {
  const pending = year.pending_request;
  if (mode === "approve-amendment") {
    if (!pending) return { label: "Nothing to approve", allowed: false };
    return pending.requested_by_user_id === userId
      ? { label: "Awaiting another publisher", allowed: false }
      : { label: "Approve change", allowed: true };
  }
  if (year.requires_second_person) {
    if (!pending) return { label: "Request publication", allowed: true };
    return pending.requested_by_user_id === userId
      ? { label: "Awaiting approval by another publisher", allowed: false }
      : { label: "Approve publication", allowed: true };
  }
  return { label: `Publish ${year.year}`, allowed: true };
}

/**
 * Modal `publish-year` (04-holiday/01 §6.2-§6.3, §9.4; 09-ui-ux/02 §18): the dry run's impact — the diff against what
 * employees have now, people, leave to recount, locked payroll periods, warnings (confirm ones need a tick) — then
 * the commit with the reviewed content hash (a change in between answers 409 and the preview reloads). With
 * `holiday.publish.requires_second_person` the first publisher requests, another approves.
 */
export function PublishYearPanel({
  calendarId,
  year,
  mode = "publish",
  onDone,
  onCancel,
}: {
  calendarId: number;
  year: YearView;
  mode?: PublishMode;
  onDone: (result: YearChangeResult) => void;
  onCancel: () => void;
}) {
  const me = useSession((s) => s.me);
  const [impact, setImpact] = useState<YearImpact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = year.pending_request;
  const action = primaryAction(year, mode, me?.user.id);

  const review = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result =
        mode === "publish"
          ? await yearsApi.publish(calendarId, year.year, { dry_run: true })
          : await yearsApi.amend(calendarId, year.year, {
              dry_run: true,
              operations: (pending?.operations ?? []) as never,
              reason: pending?.reason ?? undefined,
            });
      setImpact(result.impact);
    } catch (e) {
      setImpact(null);
      setError(e instanceof Error ? e.message : "The review failed.");
    } finally {
      setLoading(false);
    }
  }, [calendarId, year.year, mode, pending]);

  useEffect(() => {
    void review();
  }, [review]);

  const missing = missingAcknowledgements(impact, ticked);
  const blocked = !!impact?.errors.length;

  const commit = async () => {
    if (!impact) return;
    setBusy(true);
    setError(null);
    try {
      const acknowledged = impact.warnings.filter((w) => w.confirm).map((w) => w.code);
      const result =
        mode === "publish"
          ? await yearsApi.publish(calendarId, year.year, {
              acknowledged_warnings: acknowledged,
              note: note.trim() || undefined,
              reason: reason.trim() || undefined,
              content_hash: impact.content_hash,
            })
          : await yearsApi.amend(calendarId, year.year, { complete_request: true });
      if (result.status === "PENDING_SECOND_PERSON") toast.success("Publication requested: another holiday publisher completes it.");
      else toast.success(mode === "publish" ? `${year.year} published` : `${year.year} changed (v${result.year.version})`);
      onDone(result);
    } catch (e) {
      if (e instanceof HolidayApiError && e.code === "ROW_VERSION_CONFLICT") {
        toast.error("The calendar changed while you were reviewing it. The impact has been refreshed.");
        setTicked(new Set());
        void review();
      } else {
        setError(e instanceof Error ? e.message : "Publishing failed.");
      }
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    setBusy(true);
    try {
      await yearsApi.decline(calendarId, year.year, pending?.requested_by_user_id === me?.user.id ? "Withdrawn" : "Declined");
      toast.success(pending?.requested_by_user_id === me?.user.id ? "Request withdrawn" : "Request declined");
      onCancel();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="publish-year-panel">
      {pending && (
        <Notice tone="info" title={`${pending.kind === "PUBLISH" ? "Publication" : "A change"} requested by ${pending.requested_by ?? "a publisher"}`}>
          {pending.reason}
        </Notice>
      )}
      {loading && !impact ? (
        <Skeleton className="h-48 w-full" />
      ) : impact ? (
        <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className={cn("space-y-4", loading && "opacity-60")}>
          <div className="grid gap-2 sm:grid-cols-3" data-testid="impact-summary">
            <div className="rounded-xl border border-border p-3">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarCheck2 className="h-3.5 w-3.5" aria-hidden /> Holidays
              </p>
              <p className="text-lg font-semibold" data-testid="impact-holidays">
                {impact.holidays.own}
                {impact.holidays.expected ? <span className="text-sm font-normal text-muted-foreground"> ({impact.holidays.expected} expected)</span> : null}
              </p>
            </div>
            <div className="rounded-xl border border-border p-3">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Users className="h-3.5 w-3.5" aria-hidden /> People affected
              </p>
              <p className="text-lg font-semibold" data-testid="impact-people">
                {impact.people.employees}
              </p>
              <p className="text-xs text-muted-foreground">
                {Object.entries(impact.people.by_branch)
                  .map(([b, n]) => `${b} ${n}`)
                  .join(" · ") || "No one resolves to it yet"}
              </p>
            </div>
            <div className="rounded-xl border border-border p-3">
              <p className="text-xs text-muted-foreground">Leave recounted</p>
              <p className="text-lg font-semibold" data-testid="impact-leave">
                {impact.leave.approved_requests}
              </p>
              <p className="text-xs text-muted-foreground">
                {impact.leave.dates} day(s) · {impact.leave.pending_requests} pending to re-check
              </p>
            </div>
          </div>
          <section>
            <p className="mb-1.5 text-sm font-medium">What changes</p>
            {impact.diff.length === 0 ? (
              <p className="text-sm text-muted-foreground">No date changes for anyone.</p>
            ) : (
              <ul className="max-h-56 space-y-1 overflow-y-auto pr-1" data-testid="impact-diff">
                {impact.diff.map((d) => {
                  const Icon = CHANGE_ICON[d.change];
                  return (
                    <li key={`${d.calendar_code}-${d.date}-${d.change}-${d.name}`} className="flex flex-wrap items-center gap-2 text-sm">
                      <Icon className={cn("h-3.5 w-3.5", CHANGE_TONE[d.change])} aria-label={d.change} />
                      <span className="tabular-nums">{longDate(d.date)}</span>
                      <span className="font-medium">{d.name}</span>
                      <Badge tone="neutral">{d.calendar_code}</Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <section>
            <p className="mb-1.5 text-sm font-medium">Payroll</p>
            {impact.payroll.locked_periods.length === 0 ? (
              <p className="text-sm text-muted-foreground">No locked payroll periods affected.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {impact.payroll.locked_periods.map((p) => (
                  <li key={`${p.pay_group}-${p.period_start}`}>
                    {p.pay_group ?? "Pay group"} {p.period_start} – {p.period_end}: <Badge tone="warning">{p.state.toLowerCase().replace("_", " ")}</Badge> (goes
                    to retro)
                  </li>
                ))}
              </ul>
            )}
          </section>
          {impact.errors.map((e) => (
            <Notice key={`${e.code}-${e.message}`} tone="danger" title={e.message} />
          ))}
          {impact.warnings.length > 0 && (
            <ul className="space-y-2" data-testid="impact-warnings">
              {impact.warnings.map((w) => (
                <li key={w.code} className={cn("rounded-xl border px-3 py-2 text-sm", w.confirm ? "border-warning/50 bg-warning-soft" : "border-border")}>
                  <p className="flex items-start gap-2">
                    {w.confirm ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
                    <span>{w.message}</span>
                  </p>
                  {w.confirm && (
                    <label className="mt-1.5 flex items-center gap-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={ticked.has(w.code)}
                        onChange={(e) => {
                          const next = new Set(ticked);
                          if (e.target.checked) next.add(w.code);
                          else next.delete(w.code);
                          setTicked(next);
                        }}
                        data-testid={`ack-${w.code}`}
                      />
                      I understand
                    </label>
                  )}
                </li>
              ))}
            </ul>
          )}
          {mode === "publish" && !pending && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Change reason" hint="Kept in the calendar history.">
                <Textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="publish-reason" />
              </Field>
              <Field label="Note to employees (optional)">
                <Textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} data-testid="publish-note" />
              </Field>
            </div>
          )}
        </motion.div>
      ) : null}
      {error && <Notice tone="danger" title={error} />}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
        {pending && (
          <Button variant="ghost" onClick={() => void decline()} disabled={busy}>
            {pending.requested_by_user_id === me?.user.id ? "Withdraw request" : "Decline request"}
          </Button>
        )}
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          onClick={() => void commit()}
          loading={busy}
          disabled={!action.allowed || !impact || loading || blocked || missing.length > 0}
          data-testid="publish-confirm"
        >
          <ShieldCheck className="h-4 w-4" /> {loading ? "Checking…" : action.label}
        </Button>
      </div>
    </div>
  );
}
