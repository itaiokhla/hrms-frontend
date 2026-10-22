"use client";

import { ChevronDown, TrendingUp } from "lucide-react";
import { Fragment, useEffect, useMemo, useState, type FormEvent } from "react";
import toast from "react-hot-toast";

import { MoneyText } from "@/components/payroll/MoneyText";
import { useModalRoute } from "@/components/payroll/useModalRoute";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState, Pagination } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Skeleton } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useApi } from "@/lib/hooks";

import { runsApi } from "./api";
import { canAcknowledge, useRun } from "./context";
import { ChangeText } from "./EmployeesTab";
import { Notice, humanize } from "./shared";
import type { VarianceItem } from "./types";

const LIMIT = 50;

/** Run › Variance (3.8 §5.3): change versus last period per employee and component; acknowledge flags with a comment. */
export function VarianceTab() {
  const { run, me, version, reload } = useRun();
  const [sort, setSort] = useState<"percent" | "absolute" | "employee">("percent");
  const [onlyFlagged, setOnlyFlagged] = useState(true);
  const [skip, setSkip] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const ack = useModalRoute("acknowledge", { keys: ["employee"] });
  const params = useMemo(() => ({ sort, only_flagged: onlyFlagged, skip, limit: LIMIT }), [sort, onlyFlagged, skip]);
  const { data, error, reload: refetch } = useApi(() => runsApi.variance(run.id, params), [run.id, params, version]);
  const editable = canAcknowledge(me, run);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {data ? `${data.flagged} flagged · ${data.pending} waiting for acknowledgement` : "Comparing with the previous finalized period…"}
          {data && data.pending > 0 && " · Submission needs every flag acknowledged."}
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-h-[44px] items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={onlyFlagged} onChange={(e) => (setOnlyFlagged(e.target.checked), setSkip(0))} />
            Flagged only
          </label>
          <Field label="Sort by">
            <Select value={sort} onChange={(e) => (setSort(e.target.value as typeof sort), setSkip(0))}>
              <option value="percent">Largest % change</option>
              <option value="absolute">Largest amount change</option>
              <option value="employee">Employee</option>
            </Select>
          </Field>
        </div>
      </div>
      {error ? (
        <ErrorState message={error.message} onRetry={refetch} />
      ) : !data ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : data.items.length === 0 ? (
        <EmptyState icon={<TrendingUp />} title={onlyFlagged ? "No flagged changes" : "No calculated employees yet"} description={onlyFlagged ? "Nobody's pay moved beyond the review threshold." : undefined} />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">Net pay change per employee</caption>
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="px-4 py-3 text-start font-medium">
                  Employee
                </th>
                <th scope="col" className="px-4 py-3 text-end font-medium">
                  Previous net
                </th>
                <th scope="col" className="px-4 py-3 text-end font-medium">
                  Net
                </th>
                <th scope="col" className="px-4 py-3 text-end font-medium">
                  Change
                </th>
                <th scope="col" className="px-4 py-3 text-start font-medium">
                  Review
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <Fragment key={item.run_employee_id}>
                  <tr className="border-b border-border/60">
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        className="inline-flex min-h-[44px] items-center gap-1.5 text-start font-medium"
                        aria-expanded={open === item.run_employee_id}
                        onClick={() => setOpen(open === item.run_employee_id ? null : item.run_employee_id)}
                      >
                        <ChevronDown className={cn("h-4 w-4 transition-transform", open === item.run_employee_id && "rotate-180")} aria-hidden />
                        {item.employee_name ?? `Employee #${item.employee_id}`}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-end">
                      <MoneyText amount={item.net.previous} currency={item.currency} />
                    </td>
                    <td className="px-4 py-3 text-end">
                      <MoneyText amount={item.net.current} currency={item.currency} />
                    </td>
                    <td className="px-4 py-3 text-end">
                      <ChangeText value={item.net.change_percent} />
                    </td>
                    <td className="px-4 py-3">
                      <ReviewCell item={item} editable={editable} onAcknowledge={() => ack.openModal({ employee: item.run_employee_id })} />
                    </td>
                  </tr>
                  {open === item.run_employee_id && (
                    <tr className="border-b border-border/60 bg-surface-muted/40">
                      <td colSpan={5} className="px-4 py-3">
                        <ComponentChanges item={item} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pagination total={data.total} skip={skip} limit={LIMIT} onChange={setSkip} />}
      <AcknowledgeModal
        open={ack.open}
        item={data?.items.find((i) => String(i.run_employee_id) === ack.id) ?? null}
        onOpenChange={ack.onOpenChange}
        onDone={() => {
          void ack.close();
          reload();
        }}
      />
    </div>
  );
}

function ReviewCell({ item, editable, onAcknowledge }: { item: VarianceItem; editable: boolean; onAcknowledge: () => void }) {
  if (item.pending.length) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">⚑ needs acknowledgement</span>
        {editable && (
          <Button size="sm" variant="secondary" className="min-h-[44px] sm:min-h-[32px]" onClick={onAcknowledge}>
            Acknowledge<span className="sr-only"> {item.employee_name}</span>
          </Button>
        )}
      </span>
    );
  }
  if (item.acknowledged) return <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success">Acknowledged</span>;
  if (item.flagged) return <span className="rounded-full bg-muted px-2 py-0.5 text-xs">Flagged</span>;
  return <span className="text-xs text-muted-foreground">Within threshold</span>;
}

function ComponentChanges({ item }: { item: VarianceItem }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Compared with {item.previous_period ?? "no previous finalized period"}
        {item.threshold_percent ? ` · review threshold ${item.threshold_percent}%` : ""}
      </p>
      <ul className="grid gap-1 sm:grid-cols-2">
        {item.components.map((c) => (
          <li key={c.component} className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-surface px-3 py-1.5 text-sm">
            <span className="font-mono text-xs">{c.component}</span>
            <span className="flex items-baseline gap-2">
              <MoneyText amount={c.change} currency={item.currency} />
              <ChangeText value={c.change_percent} />
              {c.flagged && <span className="text-xs text-warning">⚑</span>}
            </span>
          </li>
        ))}
      </ul>
      {item.acknowledgments.length > 0 && (
        <ul className="text-xs text-muted-foreground">
          {item.acknowledgments.map((a, i) => (
            <li key={i}>
              {humanize(a.code)} acknowledged{a.comment ? `: “${a.comment}”` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AcknowledgeModal({ open, item, onOpenChange, onDone }: { open: boolean; item: VarianceItem | null; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const { run } = useRun();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) {
      setComment("");
      setTouched(false);
      setError(null);
    }
  }, [open]);
  const missing = !!item?.comment_required && !comment.trim();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!item || missing || busy) return;
    setBusy(true);
    try {
      const result = await runsApi.acknowledge(run.id, item.run_employee_id, comment.trim() || null);
      toast.success(result.remaining ? `Acknowledged — ${result.remaining} still to review` : "Acknowledged — every flag is reviewed");
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title="Acknowledge change"
      description={item?.employee_name ?? undefined}
      size="md"
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="ack-form" loading={busy} disabled={!item}>
            Acknowledge
          </Button>
        </>
      }
    >
      {!item ? (
        <p className="text-sm text-muted-foreground">This employee is not in the current list; change the filter and try again.</p>
      ) : (
        <form id="ack-form" onSubmit={submit} className="space-y-4" noValidate>
          <p className="text-sm">
            Net moves from <MoneyText amount={item.net.previous} currency={item.currency} /> to <MoneyText amount={item.net.current} currency={item.currency} /> (
            <ChangeText value={item.net.change_percent} />
            ).
          </p>
          {error && (
            <Notice tone="danger" title="That didn't work">
              {error}
            </Notice>
          )}
          <Field label={item.comment_required ? "Why is this right?" : "Comment (optional)"} required={item.comment_required} error={touched && missing ? "A net-pay change above the threshold needs a comment." : undefined}>
            <Textarea rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
        </form>
      )}
    </Modal>
  );
}
