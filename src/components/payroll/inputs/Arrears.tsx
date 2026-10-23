"use client";

import { Calculator, ExternalLink, PlayCircle, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { MoneyText } from "@/components/payroll/MoneyText";
import { useModalRoute } from "@/components/payroll/useModalRoute";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Column, DataTable, EmptyState, ErrorState, Pagination } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Card, Skeleton } from "@/components/ui/primitives";
import { canBeyondSelf } from "@/lib/access";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Money } from "@/lib/money";
import { newIdempotencyKey } from "@/lib/payroll/api";
import { P } from "@/lib/permissions.generated";

import { arrearsApi, type DetectBody } from "./api";
import {
  ConflictBanner,
  DecisionModal,
  EmployeeField,
  ErrorSummary,
  FilterBar,
  LocalStatusChip,
  Notice,
  fieldErrors,
  isNotFound,
  localStatus,
  useEmployeeDirectory,
} from "./shared";
import {
  ARREARS_STATUSES,
  ARREARS_TRIGGERS,
  type ArrearsIssue,
  type ArrearsLine,
  type ArrearsPreviewItem,
  type ArrearsProposal,
  type ArrearsTrigger,
  type PayGroupOption,
} from "./types";

const LIMIT = 50;
/** routes/corrections.py caps a page of arrears proposals at 200. */
const PERIOD_SCAN = 200;

export const TRIGGER_LABELS: Record<string, string> = {
  COMPENSATION: "Salary change",
  ATTENDANCE: "Attendance correction",
  LEAVE: "Leave correction",
  OVERTIME: "Overtime correction",
  TASK: "Task pay correction",
  SETTING: "Payroll setting change",
  POLICY: "Policy change",
  INPUT: "Wage input correction",
};

const PAYMENT_MODE_LABELS: Record<string, string> = {
  NEXT_REGULAR_RUN: "Next regular run",
  OFF_CYCLE: "Retro run (off-cycle)",
};

const RECOVERY_MODE_LABELS: Record<string, string> = {
  NEXT_RUN: "Recovered in the next run",
  INSTALMENTS: "Recovered in instalments",
  MANUAL: "Recovered by hand (never deducted automatically)",
};

const human = (s: string | null | undefined) => (s ? s.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()) : "—");
const triggerLabel = (t: string) => TRIGGER_LABELS[t] ?? human(t);
const periodText = (start: string, end: string) => `${fmtDate(start, "d MMM")} – ${fmtDate(end, "d MMM yyyy")}`;
const issueText = (i: ArrearsIssue) => i.message ?? human(i.code);
const statusLabel = (code: string) => localStatus("arrears", code).label;

/** Deep-link modal names (`/payroll/inputs?tab=arrears&modal=…`). */
export const ARREARS_MODALS = {
  detail: "arrears",
  approve: "arrears-approve",
  reject: "arrears-reject",
  detect: "arrears-detect",
  retroRun: "retro-run",
} as const;

/* ------------------------------------------------------------------ money pieces */

function Totals({ totals, className }: { totals: ArrearsProposal["totals"]; className?: string }) {
  const cells: [string, Money | undefined][] = [
    ["Arrears", totals.arrears],
    ["Recovery", totals.recovery],
    ["Net change", totals.net_change],
  ];
  return (
    <dl className={className ?? "grid grid-cols-3 gap-3 rounded-xl bg-muted/60 p-3 text-sm"}>
      {cells.map(([label, money]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="font-medium">
            <MoneyText money={money ?? null} emphasis={label === "Net change"} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Per-component differences: original (as corrected so far), recalculated, and the delta (employee's view). */
export function DeltaTable({ lines, caption }: { lines: Pick<ArrearsLine, "component_code" | "direction" | "original" | "recalculated" | "delta">[]; caption: string }) {
  if (!lines.length) return <p className="text-sm text-muted-foreground">No component changes.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface-muted text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 text-start font-medium">Component</th>
            <th scope="col" className="px-3 py-2 text-end font-medium">Paid</th>
            <th scope="col" className="px-3 py-2 text-end font-medium">Recalculated</th>
            <th scope="col" className="px-3 py-2 text-end font-medium">Difference</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={`${l.component_code}-${i}`} className="border-t border-border" data-direction={l.direction}>
              <th scope="row" className="px-3 py-2 text-start font-mono text-xs font-normal">{l.component_code}</th>
              <td className="px-3 py-2 text-end"><MoneyText money={l.original} /></td>
              <td className="px-3 py-2 text-end"><MoneyText money={l.recalculated} /></td>
              <td className="px-3 py-2 text-end font-medium"><MoneyText money={l.delta} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Issues({ issues }: { issues: ArrearsIssue[] }) {
  if (!issues.length) return null;
  const blocking = issues.some((i) => i.severity === "BLOCKING");
  return (
    <Notice tone={blocking ? "danger" : "warning"} title={blocking ? "The recalculation found blocking issues" : "Check these before deciding"}>
      <ul className="mt-1 list-disc ps-5">
        {issues.map((i, n) => (
          <li key={`${i.code}-${n}`}>{issueText(i)}</li>
        ))}
      </ul>
    </Notice>
  );
}

/* ------------------------------------------------------------------ tab */

/**
 * Wage Inputs › Arrears proposals (3.5 §12, 3.8 §5.5): differences found when a past change reaches a
 * finalized period, waiting for approval and then paid by the next regular run or a retro run.
 * Deep links: `?tab=arrears&modal=arrears&id=` (detail), `modal=arrears-approve|arrears-reject&id=`,
 * `modal=arrears-detect`, `modal=retro-run`; `&run=` narrows the list to one original run.
 */
export function ArrearsTab({ payGroups }: { payGroups: PayGroupOption[] }) {
  const { me } = useCan();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const people = useEmployeeDirectory();
  const canRead = canBeyondSelf(me, P.PAYROLL_RUN_READ);
  const canApprove = canBeyondSelf(me, P.PAYROLL_RUN_APPROVE);
  const canPropose = canBeyondSelf(me, P.PAYROLL_RUN_CREATE);

  const [status, setStatus] = useState("");
  const [employee, setEmployee] = useState("");
  const [period, setPeriod] = useState("");
  const [skip, setSkip] = useState(0);
  const [detectDirty, setDetectDirty] = useState(false);
  const runParam = search?.get("run") ?? "";
  const runId = /^\d+$/.test(runParam) ? runParam : "";

  const detail = useModalRoute(ARREARS_MODALS.detail, { keys: ["id"] });
  const approve = useModalRoute(ARREARS_MODALS.approve, { keys: ["id"] });
  const reject = useModalRoute(ARREARS_MODALS.reject, { keys: ["id"] });
  const detect = useModalRoute(ARREARS_MODALS.detect, { keys: [], dirty: detectDirty });
  const retro = useModalRoute(ARREARS_MODALS.retroRun, { keys: [] });

  useEffect(() => setSkip(0), [status, employee, runId, period]);
  // The API has no period filter. With a date, the most recent PERIOD_SCAN proposals (the API's page
  // maximum) matching the server filters are searched here and paged locally, and the page says so when
  // older proposals were not searched; without one, paging is the server's.
  const byPeriod = !!period;
  const { data, error, loading, reload } = useApi(
    () =>
      arrearsApi.list({ status, employee_id: employee, run_id: runId, skip: byPeriod ? 0 : skip, limit: byPeriod ? PERIOD_SCAN : LIMIT }),
    [status, employee, runId, byPeriod ? -1 : skip],
    { enabled: canRead },
  );
  const matches = useMemo(
    () => (data?.items ?? []).filter((p) => !period || (p.original_period.start <= period && period <= p.original_period.end)),
    [data, period],
  );
  const rows = byPeriod ? matches.slice(skip, skip + LIMIT) : matches;
  const total = byPeriod ? matches.length : (data?.total ?? 0);
  const unsearched = byPeriod && !!data && data.total > data.items.length;
  const ownEmployeeId = me?.employee?.id ?? null;
  // Nobody decides arrears for their own pay (services/retro.py); the server refuses it as well.
  const mayDecide = (p: ArrearsProposal) => canApprove && p.status === "PENDING_APPROVAL" && p.employee_id !== ownEmployeeId;

  const decideId = approve.open ? approve.id : reject.open ? reject.id : null;
  const decideKind: "approve" | "reject" = approve.open ? "approve" : "reject";
  const target = useApi(() => arrearsApi.get(decideId!), [decideId], { enabled: canApprove && !!decideId });

  if (!canRead) {
    return (
      <Card>
        <Notice tone="warning" title="Arrears proposals aren't visible to your role">
          Viewing arrears proposals needs pay-run read access (payroll:run:read) for the entities or pay groups you work with.
        </Notice>
      </Card>
    );
  }

  const clearRun = () => {
    const next = new URLSearchParams(search?.toString() ?? "");
    next.delete("run");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const columns: Column<ArrearsProposal>[] = [
    {
      key: "employee",
      header: "Employee",
      primary: true,
      cell: (p) => (
        <button type="button" className="text-start font-medium hover:underline" onClick={(e) => { e.stopPropagation(); detail.openModal({ id: p.id }); }}>
          {people.name(p.employee_id)}
        </button>
      ),
    },
    { key: "period", header: "Original period", cell: (p) => <span className="whitespace-nowrap text-sm">{periodText(p.original_period.start, p.original_period.end)}</span> },
    { key: "trigger", header: "Cause", hideOnMobile: true, cell: (p) => triggerLabel(p.trigger) },
    {
      key: "net",
      header: <span className="block text-end">Net change</span>,
      className: "text-end",
      cell: (p) => <MoneyText money={p.totals.net_change ?? null} />,
    },
    {
      key: "status",
      header: "Status",
      cell: (p) => (
        <span className="inline-flex flex-wrap items-center gap-1">
          <LocalStatusChip vocabulary="arrears" code={p.status} />
          {p.issues.length > 0 && (
            <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs text-warning" title={p.issues.map(issueText).join("; ")}>
              {p.issues.length} issue{p.issues.length === 1 ? "" : "s"}
            </span>
          )}
        </span>
      ),
    },
    {
      key: "paid-by",
      header: "Paid by",
      hideOnMobile: true,
      cell: (p) =>
        p.retro_run_id ? (
          <Link href={`/payroll/runs/${p.retro_run_id}`} className="text-sm text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
            Retro run #{p.retro_run_id}
          </Link>
        ) : (
          <span className="text-sm text-muted-foreground">{p.payment_mode ? PAYMENT_MODE_LABELS[p.payment_mode] ?? human(p.payment_mode) : "—"}</span>
        ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      hideInCard: false,
      cell: (p) => (
        <div className="flex flex-wrap justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {mayDecide(p) ? (
            <>
              <Button size="sm" className="min-h-[44px]" onClick={() => approve.openModal({ id: p.id })}>
                Approve
              </Button>
              <Button size="sm" variant="ghost" className="min-h-[44px] text-danger" onClick={() => reject.openModal({ id: p.id })}>
                Reject
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" className="min-h-[44px]" onClick={() => detail.openModal({ id: p.id })}>
              View
            </Button>
          )}
        </div>
      ),
    },
  ];

  const filtered = !!(status || employee || period || runId);
  return (
    <Card>
      <FilterBar>
        <Field label="Status" className="w-48">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {ARREARS_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </Select>
        </Field>
        {people.options.length > 0 ? (
          <Field label="Employee" className="w-56">
            <Select value={employee} onChange={(e) => setEmployee(e.target.value)}>
              <option value="">All employees</option>
              {people.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.full_name} ({o.employee_code})
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Employee ID" className="w-36">
            <Input inputMode="numeric" value={employee} onChange={(e) => setEmployee(e.target.value.replace(/\D/g, ""))} />
          </Field>
        )}
        <Field label="Period including" className="w-44">
          <Input type="date" value={period} onChange={(e) => setPeriod(e.target.value)} />
        </Field>
        {runId && (
          <span className="inline-flex min-h-[44px] items-center gap-1 rounded-full bg-primary-soft ps-3 text-sm">
            From run #{runId}
            <button type="button" className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-surface-muted" aria-label="Show proposals from every run" onClick={clearRun}>
              <X className="h-4 w-4" aria-hidden />
            </button>
          </span>
        )}
        {canPropose && (
          <div className="ms-auto flex flex-wrap gap-2">
            <Button variant="secondary" className="min-h-[44px]" onClick={() => retro.openModal()}>
              <PlayCircle className="h-4 w-4" aria-hidden /> Create retro run
            </Button>
            <Button className="min-h-[44px]" onClick={() => detect.openModal()}>
              <Calculator className="h-4 w-4" aria-hidden /> Check a past change
            </Button>
          </div>
        )}
      </FilterBar>
      {error ? (
        <ErrorState message={error.message} onRetry={reload} />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          rowKey={(p) => p.id}
          onRowClick={(p) => detail.openModal({ id: p.id })}
          cardBelowMd
          caption="Arrears proposals"
          empty={
            <EmptyState
              title={filtered ? "No arrears proposals match these filters" : "No arrears proposals yet"}
              description="Proposals appear when a back-dated salary change or a correction reaches a finalized pay run. Approved arrears are paid by the next regular run or a retro run."
              action={canPropose && !filtered ? <Button className="min-h-[44px]" onClick={() => detect.openModal()}>Check a past change</Button> : undefined}
            />
          }
        />
      )}
      {unsearched && (
        <Notice tone="warning" title="Only the most recent proposals were searched for this period">
          {`The period filter looked through the latest ${PERIOD_SCAN} proposals that match the other filters. Choose a status or an employee to search older ones.`}
        </Notice>
      )}
      {data && <Pagination total={total} skip={skip} limit={LIMIT} onChange={setSkip} />}

      <ProposalModal
        open={detail.open}
        onOpenChange={detail.onOpenChange}
        id={detail.id}
        employeeName={people.name}
        canApprove={canApprove}
        ownEmployeeId={ownEmployeeId}
        onDecide={(p, kind) => (kind === "approve" ? approve.openModal({ id: p.id }) : reject.openModal({ id: p.id }))}
      />

      {decideId && target.error && (
        <Modal open onOpenChange={() => void (approve.open ? approve.close() : reject.close())} size="sm" title="Arrears proposal">
          <p className="text-sm">{isNotFound(target.error) ? "This proposal was not found, or it is outside the people and entities you can see." : target.error.message}</p>
        </Modal>
      )}
      {decideId && target.data && (
        <DecisionModal
          open
          onOpenChange={(o) => {
            if (!o) void (approve.open ? approve.close() : reject.close());
          }}
          decision={decideKind}
          subject={`Arrears for ${people.name(target.data.employee_id)} · ${periodText(target.data.original_period.start, target.data.original_period.end)}`}
          summary={
            <div className="space-y-3">
              {target.data.employee_id === ownEmployeeId && (
                <Notice tone="warning" title="This is your own pay">
                  Someone else has to decide arrears for your own pay, so this decision will be refused.
                </Notice>
              )}
              {target.data.status !== "PENDING_APPROVAL" && (
                <Notice tone="warning" title="This proposal is no longer awaiting approval">
                  It is {statusLabel(target.data.status).toLowerCase()}. Close this and reload the list.
                </Notice>
              )}
              <Totals totals={target.data.totals} />
              <DeltaTable lines={target.data.lines ?? []} caption="Differences by component" />
              {target.data.reason && <p className="text-sm text-muted-foreground">{target.data.reason}</p>}
            </div>
          }
          acknowledge={decideKind === "approve" ? target.data.issues.map(issueText) : []}
          onReload={() => {
            void reload();
            void target.reload();
          }}
          onSubmit={async (remarks) => {
            const p = target.data!;
            if (decideKind === "approve") {
              const result = await arrearsApi.approve(p.id, remarks, p.row_version);
              toast.success(result.status === "APPROVED" ? "Approved. The arrears are paid as the payment mode says." : "Approved. It moves to the next approver.");
            } else {
              await arrearsApi.reject(p.id, remarks, p.row_version);
              toast.success("Rejected. Nothing will be paid or recovered for this proposal.");
            }
            void reload();
          }}
        />
      )}

      <DetectModal open={detect.open} onOpenChange={detect.onOpenChange} onDirtyChange={setDetectDirty} onCreated={() => void reload()} />
      <RetroRunModal open={retro.open} onOpenChange={retro.onOpenChange} payGroups={payGroups} />
    </Card>
  );
}

/* ------------------------------------------------------------------ detail */

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export function ProposalModal({
  open,
  onOpenChange,
  id,
  employeeName,
  canApprove,
  ownEmployeeId = null,
  onDecide,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  id: string | null;
  employeeName: (id: number) => string;
  canApprove: boolean;
  /** The caller's own employee id: nobody decides arrears for their own pay. */
  ownEmployeeId?: number | null;
  onDecide: (p: ArrearsProposal, kind: "approve" | "reject") => void;
}) {
  const valid = !!id && /^\d+$/.test(id);
  const { data, error, loading, reload } = useApi(() => arrearsApi.get(id!), [id], { enabled: open && valid });
  const p = data && String(data.id) === id ? data : undefined;

  let body: ReactNode;
  if (!valid || (error && isNotFound(error))) {
    body = <p className="text-sm">This proposal was not found, or it is outside the people and entities you can see.</p>;
  } else if (error) {
    body = <ErrorState message={error.message} onRetry={reload} />;
  } else if (loading || !p) {
    body = (
      <div className="space-y-2" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  } else {
    body = (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <LocalStatusChip vocabulary="arrears" code={p.status} />
          <span className="text-sm text-muted-foreground">{triggerLabel(p.trigger)}</span>
        </div>
        <Issues issues={p.issues} />
        <Totals totals={p.totals} />
        <DeltaTable lines={p.lines ?? []} caption="Differences by component" />
        {(p.lines ?? []).some((l) => l.explanation) && (
          <ul className="list-disc space-y-1 ps-5 text-sm text-muted-foreground">
            {(p.lines ?? []).filter((l) => l.explanation).map((l) => (
              <li key={l.id}>{l.explanation}</li>
            ))}
          </ul>
        )}
        <dl className="grid gap-3 sm:grid-cols-2">
          <Meta label="Original run">
            <Link href={`/payroll/runs/${p.original_run_id}`} className="inline-flex items-center gap-1 text-primary hover:underline">
              Run #{p.original_run_id} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </Meta>
          <Meta label="Payment">
            {p.retro_run_id ? (
              <Link href={`/payroll/runs/${p.retro_run_id}`} className="text-primary hover:underline">Retro run #{p.retro_run_id}</Link>
            ) : p.payment_mode ? (
              PAYMENT_MODE_LABELS[p.payment_mode] ?? human(p.payment_mode)
            ) : (
              "—"
            )}
          </Meta>
          {p.recovery_mode && <Meta label="Recovery">{RECOVERY_MODE_LABELS[p.recovery_mode] ?? human(p.recovery_mode)}</Meta>}
          {p.outstanding && <Meta label="Still to settle"><MoneyText money={p.outstanding} /></Meta>}
          <Meta label="Proposed">{fmtDateTime(p.created_at)}</Meta>
          {p.decided_at && <Meta label="Decided">{fmtDateTime(p.decided_at)}</Meta>}
          {p.reason && <Meta label="Reason">{p.reason}</Meta>}
          {p.decision_note && <Meta label="Decision note">{p.decision_note}</Meta>}
          {p.superseded_by_id && <Meta label="Replaced by">Proposal #{p.superseded_by_id}</Meta>}
        </dl>
      </div>
    );
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={p ? `Arrears for ${employeeName(p.employee_id)}` : "Arrears proposal"}
      description={p ? `${periodText(p.original_period.start, p.original_period.end)} · proposal #${p.id}` : undefined}
      footer={
        <>
          <Button variant="ghost" className="min-h-[44px]" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {p && canApprove && p.status === "PENDING_APPROVAL" && p.employee_id !== ownEmployeeId && (
            <>
              <Button variant="secondary" className="min-h-[44px] text-danger" onClick={() => onDecide(p, "reject")}>
                Reject…
              </Button>
              <Button className="min-h-[44px]" onClick={() => onDecide(p, "approve")}>
                Approve…
              </Button>
            </>
          )}
        </>
      }
    >
      {body}
    </Modal>
  );
}

/* ------------------------------------------------------------------ detect with preview */

const splitList = (value: string) =>
  value
    .split(/[,\n]/)
    .map((v) => v.trim())
    .filter(Boolean);

export function DetectModal({
  open,
  onOpenChange,
  onDirtyChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onCreated?: () => void;
}) {
  const { me } = useCan();
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [trigger, setTrigger] = useState<ArrearsTrigger>("COMPENSATION");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [keys, setKeys] = useState("");
  const [policyTypes, setPolicyTypes] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<"preview" | "create" | null>(null);
  const [preview, setPreview] = useState<ArrearsPreviewItem[] | null>(null);
  const idempotencyKey = useRef(newIdempotencyKey());

  useEffect(() => {
    if (!open) return;
    setEmployeeId(null);
    setTrigger("COMPENSATION");
    setFrom("");
    setTo("");
    setKeys("");
    setPolicyTypes("");
    setReason("");
    setErrors({});
    setError(null);
    setPreview(null);
  }, [open]);

  // Any change to what is checked invalidates the preview and the create action's idempotency key.
  useEffect(() => {
    setPreview(null);
    idempotencyKey.current = newIdempotencyKey();
  }, [employeeId, trigger, from, to, keys, policyTypes, reason]);

  const dirty = open && (!!employeeId || !!from || !!to || !!keys || !!policyTypes || !!reason);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  const ownPay = !!employeeId && me?.employee?.id === employeeId;

  const body = (): DetectBody | null => {
    const next: Record<string, string> = {};
    if (!employeeId) next.employee_id = "Choose the employee.";
    if (!from) next.from_date = "Choose the date the change took effect.";
    if (from && to && to < from) next.to_date = "The end date is before the start date.";
    if (!reason.trim()) next.reason = "Give a reason. It is kept with the proposal and shown to the approver.";
    const keyList = splitList(keys);
    const typeList = splitList(policyTypes);
    if (trigger === "SETTING" && !keyList.length) next.keys = "Enter the setting keys that changed.";
    if (keyList.length > 50) next.keys = "Enter at most 50 setting keys.";
    if (trigger === "POLICY" && !typeList.length) next.policy_types = "Enter the policy types that changed.";
    if (typeList.length > 20) next.policy_types = "Enter at most 20 policy types.";
    setErrors(next);
    if (Object.keys(next).length) return null;
    return {
      employee_id: employeeId!,
      from_date: from,
      ...(to ? { to_date: to } : {}),
      trigger,
      ...(trigger === "SETTING" ? { keys: keyList } : {}),
      ...(trigger === "POLICY" ? { policy_types: typeList } : {}),
      reason: reason.trim(),
    };
  };

  const runPreview = async () => {
    const b = body();
    if (!b) return;
    setBusy("preview");
    setError(null);
    try {
      const result = await arrearsApi.preview(b);
      setPreview(result.items);
    } catch (err) {
      setError(err);
      setErrors(fieldErrors(err));
    } finally {
      setBusy(null);
    }
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const b = body();
    if (!b || !preview || ownPay) return;
    setBusy("create");
    setError(null);
    try {
      const result = await arrearsApi.detect(b, idempotencyKey.current);
      const proposed = result.items.filter((o) => o.proposal_id !== null).length;
      toast.success(proposed ? `${proposed} arrears proposal${proposed === 1 ? "" : "s"} sent for approval.` : "No differences: nothing was proposed.");
      onDirtyChange?.(false);
      onOpenChange(false);
      onCreated?.();
    } catch (err) {
      setError(err);
      setErrors(fieldErrors(err));
    } finally {
      setBusy(null);
    }
  };

  const differences = (preview ?? []).filter((item) => item.lines.length > 0);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title="Check a past change"
      description="Recalculates the finalized pay periods a back-dated change reaches. Preview first: nothing is recorded until you send the proposals for approval."
      footer={
        <>
          <Button variant="ghost" className="min-h-[44px]" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="secondary" className="min-h-[44px]" loading={busy === "preview"} onClick={() => void runPreview()}>
            Preview differences
          </Button>
          <Button type="submit" form="arrears-detect-form" className="min-h-[44px]" loading={busy === "create"} disabled={!preview || !differences.length || ownPay}>
            Send for approval
          </Button>
        </>
      }
    >
      <form id="arrears-detect-form" aria-label="Check a past change" onSubmit={create} className="space-y-4" noValidate>
        <ConflictBanner error={error} />
        <ErrorSummary error={error} fields={errors} />
        <EmployeeField value={employeeId} onChange={setEmployeeId} error={errors.employee_id} />
        {ownPay && (
          <Notice tone="warning" title="This is your own pay">
            You can preview the differences, but someone else has to propose arrears for your pay.
          </Notice>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="What changed" required error={errors.trigger}>
            <Select value={trigger} onChange={(e) => setTrigger(e.target.value as ArrearsTrigger)}>
              {ARREARS_TRIGGERS.map((t) => (
                <option key={t} value={t}>
                  {triggerLabel(t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Effective from" required error={errors.from_date}>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Until (optional)" error={errors.to_date} hint="Leave empty for every period since.">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        {trigger === "SETTING" && (
          <Field label="Setting keys" required error={errors.keys} hint="Comma-separated, e.g. payroll.overtime.rate_multiplier">
            <Input value={keys} dir="ltr" onChange={(e) => setKeys(e.target.value)} />
          </Field>
        )}
        {trigger === "POLICY" && (
          <Field label="Policy types" required error={errors.policy_types} hint="Comma-separated policy types that changed">
            <Input value={policyTypes} dir="ltr" onChange={(e) => setPolicyTypes(e.target.value)} />
          </Field>
        )}
        <Field label="Reason" required error={errors.reason} hint="Shown to the approver and kept in the audit trail.">
          <Textarea rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>

        {preview && (
          <section aria-label="Preview" className="space-y-3">
            {preview.length === 0 ? (
              <Notice title="No finalized pay periods are affected">The change doesn&apos;t reach any finalized pay run of this employee, so there is nothing to propose.</Notice>
            ) : (
              <>
                <p className="text-sm font-medium">
                  {differences.length
                    ? `${differences.length} of ${preview.length} finalized period${preview.length === 1 ? "" : "s"} change`
                    : `None of the ${preview.length} finalized period${preview.length === 1 ? "" : "s"} change`}
                </p>
                {preview.map((item) => (
                  <div key={item.run_employee_id} className="space-y-2 rounded-xl border border-border p-3">
                    <p className="text-sm font-medium">
                      {periodText(item.period.start, item.period.end)} <span className="text-muted-foreground">· run {item.period.run_number}</span>
                    </p>
                    <Issues issues={item.issues} />
                    <DeltaTable lines={item.lines} caption={`Differences for ${periodText(item.period.start, item.period.end)}`} />
                  </div>
                ))}
              </>
            )}
          </section>
        )}
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ retro run */

export function RetroRunModal({ open, onOpenChange, payGroups }: { open: boolean; onOpenChange: (o: boolean) => void; payGroups: PayGroupOption[] }) {
  const router = useRouter();
  const people = useEmployeeDirectory();
  const approved = useApi(() => arrearsApi.list({ status: "APPROVED", limit: 200 }), [open], { enabled: open });
  const [groupId, setGroupId] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [periodId, setPeriodId] = useState("");
  const [label, setLabel] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const idempotencyKey = useRef(newIdempotencyKey());

  const proposals = approved.data?.items ?? [];
  const groupIds = useMemo(() => Array.from(new Set((approved.data?.items ?? []).map((p) => p.pay_group_id))), [approved.data]);
  const groupName = (id: number) => payGroups.find((g) => g.id === id)?.name ?? `Pay group #${id}`;
  const inGroup = proposals.filter((p) => String(p.pay_group_id) === groupId);
  const periods = useApi(() => arrearsApi.periods(Number(groupId)), [groupId], { enabled: open && !!groupId });

  useEffect(() => {
    if (!open) return;
    setGroupId("");
    setPeriodId("");
    setLabel("");
    setErrors({});
    setError(null);
  }, [open]);
  useEffect(() => {
    if (!groupId && groupIds.length === 1) setGroupId(String(groupIds[0]));
  }, [groupId, groupIds]);
  // Default selection: approved proposals waiting for an off-cycle payment and not claimed yet.
  useEffect(() => {
    setSelected(new Set(inGroup.filter((p) => p.payment_mode === "OFF_CYCLE" && !p.retro_run_id).map((p) => p.id)));
    setPeriodId("");
    idempotencyKey.current = newIdempotencyKey();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, approved.data]);

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!groupId) next.pay_group_id = "Choose the pay group.";
    if (!selected.size) next.proposal_ids = "Select at least one approved proposal.";
    if (!periodId) next.pay_period_id = "Choose the period the retro run pays in.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    setError(null);
    try {
      const run = await arrearsApi.retroRun(
        { pay_group_id: Number(groupId), pay_period_id: Number(periodId), proposal_ids: Array.from(selected).sort((a, b) => a - b), ...(label.trim() ? { label: label.trim() } : {}) },
        idempotencyKey.current,
      );
      toast.success(`Retro run ${run.number} created. Calculate and approve it like any pay run.`);
      onOpenChange(false);
      router.push(`/payroll/runs/${run.id}`);
    } catch (err) {
      setError(err);
      setErrors(fieldErrors(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Create retro run"
      description="A retro run pays approved arrears outside the regular cycle. It claims the selected proposals so no other run pays them."
      footer={
        <>
          <Button variant="ghost" className="min-h-[44px]" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="retro-run-form" className="min-h-[44px]" loading={busy} disabled={!proposals.length}>
            Create retro run
          </Button>
        </>
      }
    >
      <form id="retro-run-form" aria-label="Create retro run" onSubmit={submit} className="space-y-4" noValidate>
        <ConflictBanner error={error} onReload={() => void approved.reload()} />
        <ErrorSummary error={error} fields={errors} />
        {approved.error ? (
          <ErrorState message={approved.error.message} onRetry={approved.reload} />
        ) : approved.loading && !approved.data ? (
          <Skeleton className="h-24 w-full" />
        ) : !proposals.length ? (
          <Notice title="No approved arrears are waiting">Approve arrears proposals first; approved ones that wait for an off-cycle payment can be paid here.</Notice>
        ) : (
          <>
            <Field label="Pay group" required error={errors.pay_group_id}>
              <Select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                <option value="">Choose a pay group</option>
                {groupIds.map((id) => (
                  <option key={id} value={id}>
                    {groupName(id)}
                  </option>
                ))}
              </Select>
            </Field>
            {groupId && (
              <fieldset className="space-y-1">
                <legend className="text-sm font-medium">Approved proposals to pay</legend>
                {errors.proposal_ids && <p className="text-sm text-danger">{errors.proposal_ids}</p>}
                <ul className="divide-y divide-border rounded-xl border border-border">
                  {inGroup.map((p) => (
                    <li key={p.id}>
                      <label className="flex min-h-[44px] flex-wrap items-center gap-3 px-3 py-2 text-sm">
                        <input type="checkbox" className="h-4 w-4" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{people.name(p.employee_id)}</span>{" "}
                          <span className="text-muted-foreground">· {periodText(p.original_period.start, p.original_period.end)}</span>
                          {p.retro_run_id && <span className="block text-xs text-warning">Claimed by retro run #{p.retro_run_id}</span>}
                        </span>
                        <MoneyText money={p.totals.net_change ?? null} />
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>
            )}
            {groupId && (
              <Field label="Pay in period" required error={errors.pay_period_id}>
                <Select value={periodId} disabled={periods.loading} onChange={(e) => setPeriodId(e.target.value)}>
                  <option value="">{periods.loading ? "Loading periods…" : "Choose a period"}</option>
                  {(periods.data?.items ?? []).map((pp) => (
                    <option key={pp.id} value={pp.id}>
                      {periodText(pp.start, pp.end)} · {human(pp.status)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {periods.error && <p className="text-sm text-danger">{periods.error.message}</p>}
            <Field label="Label (optional)" error={errors.label}>
              <Input maxLength={150} value={label} onChange={(e) => setLabel(e.target.value)} />
            </Field>
          </>
        )}
      </form>
    </Modal>
  );
}
