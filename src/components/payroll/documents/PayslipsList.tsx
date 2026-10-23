"use client";

import { Archive, FileText, RefreshCw, Send, Upload } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { MoneyText } from "@/components/payroll/MoneyText";
import { StatusChip } from "@/components/payroll/StatusChip";
import { useModalRoute } from "@/components/payroll/useModalRoute";
import { EmployeePicker, type PickedEmployee } from "@/components/shared/EmployeePicker";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Column, DataTable, EmptyState, ErrorState, Pagination } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Card, CardHeader } from "@/components/ui/primitives";
import { can } from "@/lib/access";
import { useApi } from "@/lib/hooks";
import { statusEntry } from "@/lib/payroll/labels";
import { P } from "@/lib/permissions.generated";

import { lookupsApi, payslipsApi } from "./api";
import { PayslipViewerModal } from "./PayslipView";
import {
  ConflictBanner,
  ErrorSummary,
  LookupField,
  Notice,
  WorkspaceHeader,
  closeAfterSave,
  errorText,
  fieldErrors,
  formatDate,
  formatDateTime,
  isNotFound,
  useEntities,
  useReportDirty,
} from "./shared";
import { PAYSLIP_FILTER_STATUSES, PUBLISHED_STATES, type BulkPublishResult, type PayslipSummary, type RunOption } from "./types";

const LIMIT = 50;

/* ------------------------------------------------------------------ run lookup */

function runLabel(r: RunOption): string {
  const period = r.period ? ` · ${formatDate(r.period.start)} – ${formatDate(r.period.end)}` : "";
  return `${r.number} · ${r.pay_group?.name ?? "Pay group"}${period}`;
}

function useRuns() {
  const { me } = useCan();
  const allowed = can(me, P.PAYROLL_RUN_READ);
  const { data } = useApi(() => lookupsApi.runs(100), ["runs"], { enabled: allowed });
  return allowed ? data?.items ?? null : null;
}

function RunField({ runs, value, onChange }: { runs: RunOption[] | null; value: number | null; onChange: (v: number | null) => void }) {
  if (runs) {
    return (
      <Field label="Pay run">
        <Select className="min-h-[44px]" value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
          <option value="">All runs</option>
          {runs.map((r) => (
            <option key={r.id} value={r.id}>
              {runLabel(r)}
            </option>
          ))}
        </Select>
      </Field>
    );
  }
  return (
    <Field label="Pay run id" hint="The run list needs pay-run access; enter a run id.">
      <Input
        className="min-h-[44px]"
        inputMode="numeric"
        value={value ?? ""}
        onChange={(e) => {
          const d = e.target.value.replace(/\D/g, "");
          onChange(d ? Number(d) : null);
        }}
      />
    </Field>
  );
}

/* ------------------------------------------------------------------ generation status of a run */

function GenerationPanel({ runId, canPublish, onChanged }: { runId: number; canPublish: boolean; onChanged: () => void }) {
  const { data, error, reload } = useApi(() => payslipsApi.generation(runId), [runId]);
  const [busy, setBusy] = useState(false);
  if (error) {
    if (isNotFound(error)) return null;
    return <Notice tone="warning" title="Generation status unavailable">{errorText(error)}</Notice>;
  }
  if (!data || data.total === 0) return null;
  const retry = async () => {
    setBusy(true);
    try {
      const result = await payslipsApi.retryFailed(runId);
      toast.success(`${result.requeued} payslip${result.requeued === 1 ? "" : "s"} queued again.`);
      await reload();
      onChanged();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="p-4" aria-label="Payslip generation">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <p className="font-medium">Generation for this run</p>
        <span>
          <span className="tabular-nums font-semibold">{data.counts.GENERATED}</span> of <span className="tabular-nums">{data.total}</span> generated
        </span>
        {data.counts.QUEUED > 0 && <span className="text-muted-foreground">{data.counts.QUEUED} queued</span>}
        <span className="text-muted-foreground">{data.published} published</span>
        {data.counts.FAILED > 0 && <span className="font-medium text-danger">{data.counts.FAILED} failed</span>}
        {data.counts.FAILED > 0 && canPublish && (
          <Button variant="secondary" size="sm" className="ms-auto min-h-[44px]" loading={busy} onClick={() => void retry()}>
            <RefreshCw className="h-4 w-4" aria-hidden /> Retry failed
          </Button>
        )}
      </div>
      {data.failed.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm" aria-label="Failed payslips">
          {data.failed.slice(0, 10).map((f) => (
            <li key={f.task_id} className="flex flex-wrap gap-2">
              <span className="font-medium">{f.employee?.name ?? `Run employee #${f.run_employee_id}`}</span>
              <span className="text-muted-foreground">{f.error ?? "Unknown error"}</span>
            </li>
          ))}
          {data.failed.length > 10 && <li className="text-muted-foreground">…and {data.failed.length - 10} more</li>}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ reason modals */

function ReasonForm({
  formId,
  reason,
  setReason,
  reasonError,
  error,
  onReload,
  children,
}: {
  formId: string;
  reason: string;
  setReason: (v: string) => void;
  reasonError?: string;
  error: unknown;
  onReload?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <ConflictBanner error={error} onReload={onReload} />
      <ErrorSummary error={error} fields={fieldErrors(error)} />
      {children}
      <Field label="Reason" required error={reasonError ?? fieldErrors(error).reason} hint="Kept in the audit trail.">
        <Textarea id={`${formId}-reason`} rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </div>
  );
}

/** Manual publish of a run's remaining payslips (3.8 §6: `?modal=publish&run=`). */
export function PublishRunModal({
  open,
  onOpenChange,
  runId,
  runName,
  onDone,
  onDirtyChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  runId: number | null;
  runName?: string;
  onDone: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string>();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useReportDirty(open && !!reason.trim(), onDirtyChange);
  useEffect(() => {
    if (open) {
      setReason("");
      setReasonError(undefined);
      setError(null);
    }
  }, [open, runId]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!runId) return;
    if (!reason.trim()) {
      setReasonError("Give a reason. It is kept in the audit trail.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await payslipsApi.publishRun(runId, reason.trim());
      const total = (result.published ?? 0) + (result.published_manually ?? 0);
      toast.success(total ? `${total} payslip${total === 1 ? "" : "s"} published. Employees are notified.` : "Nothing to publish: every payslip of this run is already published.");
      closeAfterSave(onDirtyChange, () => onOpenChange(false));
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title="Publish payslips manually"
      description={runName ?? (runId ? `Run #${runId}` : undefined)}
      footer={
        <>
          <Button variant="ghost" className="min-h-[44px]" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="publish-run" className="min-h-[44px]" loading={busy} disabled={!runId}>
            <Upload className="h-4 w-4" aria-hidden /> Publish now
          </Button>
        </>
      }
    >
      <form id="publish-run" onSubmit={submit} noValidate>
        <ReasonForm formId="publish-run" reason={reason} setReason={(v) => { setReason(v); setReasonError(undefined); }} reasonError={reasonError} error={error}>
          {!runId && <Notice tone="warning" title="Choose a run first">The link has no run. Close this and choose a run in the filters.</Notice>}
          <p className="text-sm">
            Publishing makes every generated payslip of this run visible to its employee now, instead of waiting for the publish trigger, and sends the notification. It cannot be undone.
          </p>
        </ReasonForm>
      </form>
    </Modal>
  );
}

function BulkPublishModal({ open, onOpenChange, ids, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; ids: number[]; onDone: (r: BulkPublishResult) => void }) {
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string>();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setReason("");
      setReasonError(undefined);
      setError(null);
    }
  }, [open]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setReasonError("Give a reason. It is kept in the audit trail.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await payslipsApi.publishBulk(ids, reason.trim());
      onOpenChange(false);
      onDone(result);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={`Publish ${ids.length} payslip${ids.length === 1 ? "" : "s"}`}
      footer={
        <>
          <Button variant="ghost" className="min-h-[44px]" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="bulk-publish" className="min-h-[44px]" loading={busy}>
            Publish
          </Button>
        </>
      }
    >
      <form id="bulk-publish" onSubmit={submit} noValidate>
        <ReasonForm formId="bulk-publish" reason={reason} setReason={(v) => { setReason(v); setReasonError(undefined); }} reasonError={reasonError} error={error}>
          <p className="text-sm">The selected employees will see their payslips now and get a notification. Publishing cannot be undone.</p>
        </ReasonForm>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ the list */

interface Filters {
  run_id: number | null;
  legal_entity_id: number | null;
  employee: PickedEmployee | null;
  employee_id: number | null;
  status: string;
  period_from: string;
  period_to: string;
  include_older: boolean;
}

function numberParam(value: string | null): number | null {
  return value && /^\d+$/.test(value) ? Number(value) : null;
}

export function PayslipsList() {
  const { me } = useCan();
  const search = useSearchParams();
  const canPublish = can(me, P.PAYROLL_PAYSLIP_PUBLISH);
  const canExport = can(me, P.PAYROLL_REPORTS_EXPORT);
  const canPickEmployee = can(me, P.EMPLOYEE_READ);
  const entities = useEntities();
  const runs = useRuns();

  const [filters, setFilters] = useState<Filters>(() => ({
    run_id: numberParam(search?.get("run_id") ?? null),
    legal_entity_id: null,
    employee: null,
    employee_id: numberParam(search?.get("employee_id") ?? null),
    status: search?.get("status") ?? "",
    period_from: "",
    period_to: "",
    include_older: false,
  }));
  const [skip, setSkip] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [lastResult, setLastResult] = useState<{ published: number; skipped: number[]; failed: { id: number; message: string }[] } | null>(null);
  const [zipBusy, setZipBusy] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);

  const [publishDirty, setPublishDirty] = useState(false);
  const viewer = useModalRoute("payslip");
  const publishRoute = useModalRoute("publish", { keys: ["run"], dirty: publishDirty });

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setSkip(0);
    setSelected(new Set());
  };

  const query = useMemo(
    () => ({
      run_id: filters.run_id,
      legal_entity_id: filters.legal_entity_id,
      employee_id: filters.employee?.id ?? filters.employee_id,
      status: filters.status || null,
      period_from: filters.period_from || null,
      period_to: filters.period_to || null,
      latest_only: filters.include_older ? false : undefined,
      skip,
      limit: LIMIT,
    }),
    [filters, skip],
  );
  const { data, error, loading, reload } = useApi(() => payslipsApi.list(query), [JSON.stringify(query)]);
  const rows = data?.items;
  const filtered = !!(query.run_id || query.legal_entity_id || query.employee_id || query.status || query.period_from || query.period_to);

  const selectedRows = (rows ?? []).filter((r) => selected.has(r.id));
  const publishable = selectedRows.filter((r) => r.status === "GENERATED" && !r.draft);
  const resendable = selectedRows.filter((r) => PUBLISHED_STATES.includes(r.status));
  const selectedRun = runs?.find((r) => r.id === filters.run_id);
  const publishRunId = numberParam(publishRoute.param("run"));
  const publishRunName = runs?.find((r) => r.id === publishRunId);

  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allOnPage = (rows ?? []).length > 0 && (rows ?? []).every((r) => selected.has(r.id));

  const zip = async () => {
    if (!filters.run_id) return;
    setZipBusy(true);
    try {
      await payslipsApi.zip(filters.run_id);
      toast.success("ZIP queued. It will be ready in Downloads.");
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setZipBusy(false);
    }
  };

  /** Resend one by one: successes stay done, failures are listed with Retry (3.8 §8 partial failure). */
  const resendIds = async (ids: number[]) => {
    setResendBusy(true);
    const failed: { id: number; message: string }[] = [];
    let sent = 0;
    for (const id of ids) {
      try {
        await payslipsApi.resend(id);
        sent += 1;
      } catch (e) {
        failed.push({ id, message: errorText(e) });
      }
    }
    setResendBusy(false);
    setLastResult({ published: 0, skipped: [], failed });
    if (sent) toast.success(`${sent} notification${sent === 1 ? "" : "s"} queued.`);
    if (failed.length) toast.error(`${failed.length} could not be resent — see the list.`);
    setSelected(new Set());
    void reload();
  };
  const resendSelected = () => resendIds(resendable.map((r) => r.id));

  const name = (row: PayslipSummary) => row.employee?.name ?? (row.employee_id ? `Employee #${row.employee_id}` : "—");

  const columns: Column<PayslipSummary>[] = [
    ...(canPublish
      ? [
          {
            key: "select",
            header: (
              <input
                type="checkbox"
                className="h-4 w-4"
                aria-label="Select all payslips on this page"
                checked={allOnPage}
                onChange={() => setSelected(allOnPage ? new Set() : new Set((rows ?? []).map((r) => r.id)))}
              />
            ),
            hideInCard: true,
            className: "w-10",
            cell: (row: PayslipSummary) => (
              <label className="-m-3 inline-flex min-h-[44px] min-w-[44px] items-center justify-center" onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" className="h-4 w-4" aria-label={`Select ${name(row)} ${row.period_label ?? ""}`} checked={selected.has(row.id)} onChange={() => toggle(row.id)} />
              </label>
            ),
          } as Column<PayslipSummary>,
        ]
      : []),
    {
      key: "employee",
      header: "Employee",
      primary: true,
      cell: (row) => (
        <span>
          <span className="font-medium">{name(row)}</span>
          {row.employee?.employee_code && (
            <span className="ms-2 text-xs text-muted-foreground">
              <bdi dir="ltr">{row.employee.employee_code}</bdi>
            </span>
          )}
        </span>
      ),
    },
    {
      key: "period",
      header: "Period",
      cell: (row) => (
        <span>
          {row.period_label ?? formatDate(row.period_end)}
          {row.version > 1 && <span className="ms-2 text-xs text-muted-foreground">v{row.version}</span>}
        </span>
      ),
    },
    { key: "net", header: "Net pay", className: "text-end", cell: (row) => <MoneyText money={row.net} /> },
    { key: "status", header: "Status", cell: (row) => <StatusChip vocabulary="document" code={row.status} /> },
    { key: "payment", header: "Payment", hideOnMobile: true, cell: (row) => <span className="text-muted-foreground">{row.payment ?? "—"}</span> },
    { key: "published", header: "Published", hideOnMobile: true, cell: (row) => <span className="text-muted-foreground">{row.published_at ? formatDateTime(row.published_at) : "—"}</span> },
    {
      key: "labels",
      header: "Notes",
      hideOnMobile: true,
      cell: (row) =>
        row.labels?.length ? (
          <span className="text-xs font-medium text-warning" title={row.labels.join(" · ")}>
            {row.labels.length === 1 ? row.labels[0] : `${row.labels.length} labels`}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-5">
      <WorkspaceHeader
        title="Payslips"
        description="Every payslip of the runs and people you can see. Statuses come from the documents; payment text comes from payment evidence."
        actions={
          <>
            {canExport && (
              <Button variant="secondary" className="min-h-[44px]" disabled={!filters.run_id} loading={zipBusy} title={filters.run_id ? undefined : "Choose a run first"} onClick={() => void zip()}>
                <Archive className="h-4 w-4" aria-hidden /> Download ZIP
              </Button>
            )}
            {canPublish && filters.run_id && (
              <Button className="min-h-[44px]" onClick={() => publishRoute.openModal({ run: filters.run_id })}>
                <Upload className="h-4 w-4" aria-hidden /> Publish run
              </Button>
            )}
          </>
        }
      />

      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <RunField runs={runs} value={filters.run_id} onChange={(v) => set("run_id", v)} />
          <LookupField label="Legal entity" lookup={entities} value={filters.legal_entity_id} onChange={(v) => set("legal_entity_id", v)} />
          {canPickEmployee ? (
            <Field label="Employee">
              <EmployeePicker value={filters.employee} onChange={(v) => set("employee", v)} />
            </Field>
          ) : (
            <Field label="Employee id">
              <Input
                className="min-h-[44px]"
                inputMode="numeric"
                value={filters.employee_id ?? ""}
                onChange={(e) => {
                  const d = e.target.value.replace(/\D/g, "");
                  set("employee_id", d ? Number(d) : null);
                }}
              />
            </Field>
          )}
          <Field label="Status">
            <Select className="min-h-[44px]" value={filters.status} onChange={(e) => set("status", e.target.value)}>
              <option value="">All statuses</option>
              {PAYSLIP_FILTER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusEntry("document", s).label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Period from">
            <Input type="date" className="min-h-[44px]" value={filters.period_from} onChange={(e) => set("period_from", e.target.value)} />
          </Field>
          <Field label="Period to">
            <Input type="date" className="min-h-[44px]" value={filters.period_to} onChange={(e) => set("period_to", e.target.value)} />
          </Field>
          <label className="flex min-h-[44px] items-center gap-2 self-end text-sm">
            <input type="checkbox" className="h-4 w-4" checked={filters.include_older} onChange={(e) => set("include_older", e.target.checked)} />
            Include older versions
          </label>
        </div>
      </Card>

      {filters.run_id && <GenerationPanel runId={filters.run_id} canPublish={canPublish} onChanged={() => void reload()} />}

      {lastResult && (lastResult.skipped.length > 0 || lastResult.failed.length > 0) && (
        <Notice tone="warning" title="Some payslips were not changed">
          <ul className="list-disc ps-5">
            {lastResult.skipped.length > 0 && <li>{lastResult.skipped.length} skipped: not in the Generated state (already published, superseded or reversed).</li>}
            {lastResult.failed.map((f) => (
              <li key={f.id}>
                Payslip #{f.id}: {f.message}
              </li>
            ))}
          </ul>
          {lastResult.failed.length > 0 && canPublish && (
            <Button variant="secondary" size="sm" className="mt-2 min-h-[44px]" loading={resendBusy} onClick={() => void resendIds(lastResult.failed.map((f) => f.id))}>
              <RefreshCw className="h-4 w-4" aria-hidden /> Retry failed
            </Button>
          )}
        </Notice>
      )}

      {selected.size > 0 && canPublish && (
        <div role="region" aria-label="Bulk actions" className="sticky bottom-3 z-20 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface/95 p-3 shadow-lift backdrop-blur">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Button className="min-h-[44px]" disabled={!publishable.length} onClick={() => setBulkOpen(true)}>
            <Upload className="h-4 w-4" aria-hidden /> Publish {publishable.length || ""}
          </Button>
          <Button variant="secondary" className="min-h-[44px]" disabled={!resendable.length} loading={resendBusy} onClick={() => void resendSelected()}>
            <Send className="h-4 w-4" aria-hidden /> Resend notification {resendable.length || ""}
          </Button>
          <Button variant="ghost" className="min-h-[44px]" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      <Card className="p-0">
        <CardHeader className="px-4 pt-4" title={data ? `${data.total} payslip${data.total === 1 ? "" : "s"}` : "Payslips"} description={selectedRun ? runLabel(selectedRun) : undefined} />
        {error && !rows ? (
          <ErrorState message={errorText(error)} onRetry={() => void reload()} />
        ) : (
          <DataTable
            caption="Payslips"
            columns={columns}
            rows={rows}
            loading={loading}
            rowKey={(r) => r.id}
            onRowClick={(r) => viewer.openModal({ id: r.id })}
            cardBelowMd
            stickyHeader
            empty={
              filtered ? (
                <EmptyState icon={<FileText />} title="No payslips match these filters" description="Clear a filter, or include older versions." />
              ) : (
                <EmptyState
                  icon={<FileText />}
                  title="No payslips yet"
                  description="Payslips are generated when a pay run is finalized, then published by the trigger in Settings › Payslips & documents."
                  action={
                    can(me, P.PAYROLL_RUN_READ) ? (
                      <Link href="/payroll/runs" className="inline-flex min-h-[44px] items-center rounded-xl border border-border px-4 text-sm font-medium hover:bg-surface-muted">
                        Go to pay runs
                      </Link>
                    ) : undefined
                  }
                />
              )
            }
          />
        )}
        {data && <Pagination total={data.total} skip={skip} limit={LIMIT} onChange={setSkip} />}
      </Card>

      <PayslipViewerModal route={viewer} onChanged={() => void reload()} />
      {canPublish && (
        <PublishRunModal
          open={publishRoute.open}
          onOpenChange={publishRoute.onOpenChange}
          runId={publishRunId}
          runName={publishRunName ? runLabel(publishRunName) : undefined}
          onDone={() => void reload()}
          onDirtyChange={setPublishDirty}
        />
      )}
      {canPublish && (
        <BulkPublishModal
          open={bulkOpen}
          onOpenChange={setBulkOpen}
          ids={publishable.map((r) => r.id)}
          onDone={(result) => {
            setLastResult({ published: result.published.length, skipped: result.skipped, failed: [] });
            if (result.published.length) toast.success(`${result.published.length} payslip${result.published.length === 1 ? "" : "s"} published. Employees are notified.`);
            setSelected(new Set());
            void reload();
          }}
        />
      )}
    </div>
  );
}
