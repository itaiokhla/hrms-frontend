"use client";

import { ArrowLeft, CalendarClock, Download, FilePlus2, Landmark, Scale, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { KpiCard } from "@/components/payroll/KpiCard";
import { MoneyText } from "@/components/payroll/MoneyText";
import { StatusChip } from "@/components/payroll/StatusChip";
import { Timeline, type TimelineItem } from "@/components/payroll/Timeline";
import { useModalRoute, type ModalRoute } from "@/components/payroll/useModalRoute";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Column, DataTable, EmptyState, ErrorState, Tabs } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Card, CardHeader } from "@/components/ui/primitives";
import { can } from "@/lib/access";
import { useApi } from "@/lib/hooks";
import type { Money } from "@/lib/money";
import { statusEntry } from "@/lib/payroll/labels";
import { P } from "@/lib/permissions.generated";

import { complianceApi, fetchBlob, saveBlob } from "./api";
import {
  ConflictBanner,
  DetailGate,
  ErrorSummary,
  HonestLabels,
  LocalStatusChip,
  Notice,
  WorkspaceHeader,
  errorText,
  fieldErrors,
  formatDate,
  formatRange,
  toneOf,
} from "./shared";
import type { DueItem, EntityCompliance, Liability, StatutoryReport } from "./types";

/* ------------------------------------------------------------------ statutory report actions */

type ActionField = "reason" | "reason_optional" | "filing_ref" | "note" | "acknowledgement_ref" | "authority_response";

interface ActionSpec {
  label: string;
  consequence: string;
  fields: ActionField[];
  danger?: boolean;
}

export const REPORT_ACTIONS: Record<string, ActionSpec> = {
  GENERATE: { label: "Generate", consequence: "Calculates the report from the finalized runs of its period. Nothing is filed.", fields: [] },
  SUBMIT_FOR_REVIEW: { label: "Send for review", consequence: "A reviewer checks the figures before the report can be filed.", fields: ["reason_optional"] },
  VERIFY: { label: "Verify", consequence: "Confirms the report reconciles to its runs. It is not filed yet.", fields: ["reason_optional"] },
  REGENERATE: { label: "Regenerate", consequence: "Recalculates from the runs and returns the report to Calculated; any verification is cleared.", fields: ["reason"] },
  EXPORT: { label: "Export file", consequence: "Exporting a file makes the report ready to file. It is filed only when you record the filing reference.", fields: [] },
  MARK_SUBMITTED: { label: "Mark submitted", consequence: "Records that you filed this report with the authority. Use the reference the authority gave you.", fields: ["filing_ref", "note"] },
  RECORD_ACCEPTED: { label: "Record acceptance", consequence: "Records that the authority accepted the filing.", fields: ["acknowledgement_ref"] },
  RECORD_REJECTED: { label: "Record rejection", consequence: "Records the authority's rejection. Correct the report and file an amendment.", fields: ["authority_response"] },
  AMEND: { label: "Amend", consequence: "This filing becomes Amended and a new version starts as a draft. The filed version stays on record.", fields: ["reason"], danger: true },
};

const FIELD_LABEL: Record<ActionField, { label: string; required: boolean; multiline?: boolean; key: string }> = {
  reason: { label: "Reason", required: true, multiline: true, key: "reason" },
  reason_optional: { label: "Comment (optional)", required: false, multiline: true, key: "reason" },
  filing_ref: { label: "Filing reference", required: true, key: "filing_ref" },
  note: { label: "Note (optional)", required: false, multiline: true, key: "note" },
  acknowledgement_ref: { label: "Acknowledgement reference", required: true, key: "acknowledgement_ref" },
  authority_response: { label: "Authority's response", required: true, multiline: true, key: "authority_response" },
};

/** One modal for every lifecycle action (`?modal=statutory-action&id=&action=`), with the consequence first. */
export function ReportActionModal({ route, onDone }: { route: ModalRoute; onDone: () => void }) {
  const id = route.open ? route.id : null;
  const action = route.param("action") ?? "";
  const spec = REPORT_ACTIONS[action];
  const report = useApi(() => complianceApi.report(id as string), [id], { enabled: !!id });
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (route.open) {
      setValues({});
      setErrors({});
      setError(null);
    }
  }, [route.open, id, action]);
  const r = report.data && String(report.data.id) === id ? report.data : undefined;
  const allowed = !!r && r.available_actions.includes(action);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!r || !spec) return;
    const missing: Record<string, string> = {};
    spec.fields.forEach((f) => {
      const meta = FIELD_LABEL[f];
      if (meta.required && !values[meta.key]?.trim()) missing[meta.key] = `${meta.label} is required.`;
    });
    setErrors(missing);
    if (Object.keys(missing).length) return;
    const body: Record<string, unknown> = { row_version: r.row_version };
    spec.fields.forEach((f) => {
      const key = FIELD_LABEL[f].key;
      const v = values[key]?.trim();
      if (v) body[key] = v;
    });
    setBusy(true);
    setError(null);
    try {
      const result = await complianceApi.transition(r.id, action, body);
      toast.success(
        result.amendment
          ? `Amendment version ${result.amendment.version} started as a draft.`
          : `${r.report_name}: ${statusEntry("statutory_report", result.status).label}.`,
      );
      route.onOpenChange(false);
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const merged = { ...fieldErrors(error), ...errors };
  return (
    <Modal
      open={route.open}
      onOpenChange={route.onOpenChange}
      size="md"
      title={spec ? `${spec.label}${r ? ` · ${r.report_name}` : ""}` : "Statutory report"}
      description={r ? `${formatRange(r.period_start, r.period_end)} · version ${r.version}` : undefined}
      footer={
        <>
          <Button variant="ghost" className="min-h-[44px]" onClick={() => route.onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="statutory-action" variant={spec?.danger ? "secondary" : "primary"} className={spec?.danger ? "min-h-[44px] text-danger" : "min-h-[44px]"} loading={busy} disabled={!allowed}>
            {spec?.label ?? "Continue"}
          </Button>
        </>
      }
    >
      <DetailGate loading={report.loading} error={report.error} hasData={!!r} onRetry={() => void report.reload()} what="Statutory report" backHref="/payroll/compliance" backLabel="Back to compliance">
        {r && (
          <form id="statutory-action" onSubmit={submit} className="space-y-4" noValidate>
            {!spec ? (
              <Notice tone="warning" title="Unknown action">This link does not name an action this report supports.</Notice>
            ) : (
              <>
                <p className="text-sm">{spec.consequence}</p>
                <div className="flex items-center gap-2 text-sm">
                  Now <StatusChip vocabulary="statutory_report" code={r.status} />
                </div>
                <HonestLabels labels={[r.watermark]} />
                {!allowed && (
                  <Notice tone="warning" title="Not available now">
                    A report that is {statusEntry("statutory_report", r.status).label.toLowerCase()} cannot be {spec.label.toLowerCase()}ed by you. Reload to see the latest state.
                  </Notice>
                )}
                <ConflictBanner error={error} onReload={() => void report.reload()} />
                <ErrorSummary error={error} fields={merged} />
                {spec.fields.map((f) => {
                  const meta = FIELD_LABEL[f];
                  const common = {
                    id: `statutory-${meta.key}`,
                    value: values[meta.key] ?? "",
                    "aria-invalid": !!merged[meta.key],
                    onChange: (e: { target: { value: string } }) => {
                      setValues((v) => ({ ...v, [meta.key]: e.target.value }));
                      setErrors((x) => ({ ...x, [meta.key]: "" }));
                    },
                  };
                  return (
                    <Field key={f} label={meta.label} required={meta.required} error={merged[meta.key] || undefined}>
                      {meta.multiline ? <Textarea rows={3} maxLength={2000} {...common} /> : <Input className="min-h-[44px]" maxLength={100} {...common} />}
                    </Field>
                  );
                })}
              </>
            )}
          </form>
        )}
      </DetailGate>
    </Modal>
  );
}

async function downloadReportFile(r: StatutoryReport) {
  try {
    const blob = await fetchBlob(complianceApi.reportFileUrl(r.id));
    saveBlob(blob, `statutory-report-${r.report_code.toLowerCase()}-${r.period_start}.csv`);
  } catch (e) {
    toast.error(errorText(e));
  }
}

function ReportActions({ report, route, compact }: { report: StatutoryReport; route: ModalRoute; compact?: boolean }) {
  const actions = report.available_actions.filter((a) => REPORT_ACTIONS[a]);
  return (
    <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
      {actions.map((a, i) => (
        <Button
          key={a}
          size="sm"
          variant={i === 0 && !REPORT_ACTIONS[a].danger ? "primary" : "secondary"}
          className={REPORT_ACTIONS[a].danger ? "min-h-[44px] text-danger" : "min-h-[44px]"}
          onClick={() => route.openModal({ id: report.id, action: a })}
        >
          {REPORT_ACTIONS[a].label}
        </Button>
      ))}
      {report.exported_at && (
        <Button size="sm" variant="ghost" className="min-h-[44px]" onClick={() => void downloadReportFile(report)} aria-label={`Download file of ${report.report_name}`}>
          <Download className="h-4 w-4" aria-hidden /> {compact ? "File" : "Download file"}
        </Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ new statutory report */

/** `?modal=new-statutory&entity=&code=&period=`: create a DRAFT for a report the active pack defines. */
export function NewStatutoryReportModal({ route, entities, onDone }: { route: ModalRoute; entities: EntityCompliance[]; onDone: () => void }) {
  const entityId = Number(route.param("entity") ?? "") || null;
  const entity = entities.find((e) => e.legal_entity.id === entityId) ?? (entities.length === 1 ? entities[0] : undefined);
  const [code, setCode] = useState("");
  const [period, setPeriod] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (route.open) {
      setCode(route.param("code") ?? entity?.report_definitions[0]?.code ?? "");
      setPeriod(route.param("period") ?? "");
      setErrors({});
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.open]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!entity) return;
    const v: Record<string, string> = {};
    if (!code) v.report_code = "Choose a report.";
    if (!period) v.period_start = "Choose the first day of the period.";
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    setError(null);
    try {
      await complianceApi.createReport(entity.legal_entity.id, code, period);
      toast.success("Draft created. Generate it once the period's runs are finalized.");
      route.onOpenChange(false);
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const merged = { ...fieldErrors(error), ...errors };
  return (
    <Modal
      open={route.open}
      onOpenChange={route.onOpenChange}
      size="md"
      title="New statutory report"
      description={entity ? entity.legal_entity.legal_name : undefined}
      footer={
        <>
          <Button variant="ghost" className="min-h-[44px]" onClick={() => route.onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="new-statutory" className="min-h-[44px]" loading={busy} disabled={!entity || !entity.report_definitions.length}>
            Create draft
          </Button>
        </>
      }
    >
      <form id="new-statutory" onSubmit={submit} className="space-y-4" noValidate>
        {!entity ? (
          <Notice tone="warning" title="Choose a legal entity">The link does not name an entity you can see.</Notice>
        ) : !entity.report_definitions.length ? (
          <Notice tone="warning" title="No statutory reports for this entity">Reports appear once a verified country pack covers the entity.</Notice>
        ) : (
          <>
            <ErrorSummary error={error} fields={merged} />
            <Field label="Report" required error={merged.report_code}>
              <Select className="min-h-[44px]" value={code} onChange={(e) => setCode(e.target.value)}>
                {entity.report_definitions.map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.name} · {d.frequency.toLowerCase()}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Period starts" required error={merged.period_start} hint="The first day of the report period.">
              <Input type="date" className="min-h-[44px]" value={period} aria-invalid={!!merged.period_start} onChange={(e) => setPeriod(e.target.value)} />
            </Field>
          </>
        )}
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ liabilities */

/** Record a remittance (`?modal=remit&id=`) or reconcile it (`?modal=reconcile&id=`). */
export function LiabilityActionModal({ route, kind, onDone }: { route: ModalRoute; kind: "remit" | "reconcile"; onDone: () => void }) {
  const id = route.open ? route.id : null;
  const liability = useApi(() => complianceApi.liability(id as string), [id], { enabled: !!id });
  const [ref, setRef] = useState("");
  const [on, setOn] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (route.open) {
      setRef("");
      setOn("");
      setNote("");
      setErrors({});
      setError(null);
    }
  }, [route.open, id]);
  const l = liability.data && String(liability.data.id) === id ? liability.data : undefined;
  const expected = kind === "remit" ? "OPEN" : "REMITTED";
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!l) return;
    const v: Record<string, string> = {};
    if (kind === "remit" && !ref.trim()) v.remittance_ref = "Give the payment or challan reference.";
    if (kind === "remit" && on && on > new Date().toISOString().slice(0, 10)) v.remitted_on = "The remittance date cannot be in the future.";
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    setError(null);
    try {
      if (kind === "remit") await complianceApi.remit(l.id, { remittance_ref: ref.trim(), remitted_on: on || null, note: note.trim() || null, row_version: l.row_version });
      else await complianceApi.reconcile(l.id, { note: note.trim() || null, row_version: l.row_version });
      toast.success(kind === "remit" ? "Remittance recorded." : "Liability reconciled.");
      route.onOpenChange(false);
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const merged = { ...fieldErrors(error), ...errors };
  return (
    <Modal
      open={route.open}
      onOpenChange={route.onOpenChange}
      size="md"
      title={kind === "remit" ? "Record remittance" : "Reconcile remittance"}
      description={
        id ? (
          <Link href={`/payroll/compliance/liabilities/${id}`} className="font-medium text-primary hover:underline">
            Open full page ↗
          </Link>
        ) : undefined
      }
      footer={
        <>
          <Button variant="ghost" className="min-h-[44px]" onClick={() => route.onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="liability-action" className="min-h-[44px]" loading={busy} disabled={!l || l.status !== expected}>
            {kind === "remit" ? "Record remittance" : "Reconcile"}
          </Button>
        </>
      }
    >
      <DetailGate loading={liability.loading} error={liability.error} hasData={!!l} onRetry={() => void liability.reload()} what="Liability" backHref="/payroll/compliance" backLabel="Back to compliance">
        {l && (
          <form id="liability-action" onSubmit={submit} className="space-y-4" noValidate>
            <p className="text-sm">
              {kind === "remit"
                ? "Records that this amount was paid to the authority. It stays Remitted until you reconcile it with the bank statement or receipt."
                : "Confirms the remittance matches the bank statement or the authority's receipt. This closes the liability."}
            </p>
            <dl className="grid grid-cols-2 gap-2 rounded-xl border border-border p-3 text-sm">
              <dt className="text-muted-foreground">Scheme</dt>
              <dd>{l.scheme}</dd>
              <dt className="text-muted-foreground">Period</dt>
              <dd>{formatRange(l.period_start, l.period_end)}</dd>
              <dt className="text-muted-foreground">Total</dt>
              <dd>
                <MoneyText money={l.total} emphasis />
              </dd>
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                <LocalStatusChip vocabulary="liability" code={l.status} />
              </dd>
            </dl>
            <HonestLabels labels={[l.watermark]} />
            {l.status !== expected && <Notice tone="warning" title="Already done">This liability is {l.status.toLowerCase()} now. Reload to see the latest state.</Notice>}
            <ConflictBanner error={error} onReload={() => void liability.reload()} />
            <ErrorSummary error={error} fields={merged} />
            {kind === "remit" && (
              <>
                <Field label="Payment or challan reference" required error={merged.remittance_ref}>
                  <Input className="min-h-[44px]" maxLength={100} value={ref} aria-invalid={!!merged.remittance_ref} onChange={(e) => setRef(e.target.value)} />
                </Field>
                <Field label="Paid on" error={merged.remitted_on} hint="Defaults to today.">
                  <Input type="date" className="min-h-[44px]" value={on} aria-invalid={!!merged.remitted_on} onChange={(e) => setOn(e.target.value)} />
                </Field>
              </>
            )}
            <Field label="Note (optional)" error={merged.note}>
              <Textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </form>
        )}
      </DetailGate>
    </Modal>
  );
}

function LiabilitiesTable({ entityId, canSubmit, remit, reconcile, version }: { entityId: number; canSubmit: boolean; remit: ModalRoute; reconcile: ModalRoute; version: number }) {
  const [status, setStatus] = useState("");
  const [overdue, setOverdue] = useState(false);
  const { data, error, loading, reload } = useApi(
    () => complianceApi.liabilities({ legal_entity_id: entityId, status: status || null, overdue: overdue || null, limit: 100 }),
    [entityId, status, overdue, version],
  );
  const columns: Column<Liability>[] = [
    {
      key: "scheme",
      header: "Scheme",
      primary: true,
      cell: (l) => (
        <span>
          <Link href={`/payroll/compliance/liabilities/${l.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
            {l.scheme}
          </Link>
          {l.payee && <span className="block text-xs text-muted-foreground">{l.payee}</span>}
          {l.watermark && <span className="block text-[11px] font-semibold text-warning">{l.watermark}</span>}
        </span>
      ),
    },
    { key: "period", header: "Period", cell: (l) => formatRange(l.period_start, l.period_end) },
    {
      key: "due",
      header: "Due",
      cell: (l) => (
        <span className={l.overdue ? "font-medium text-danger" : undefined}>
          {formatDate(l.due_date)}
          {l.overdue && <span className="ms-1 text-xs">(overdue)</span>}
        </span>
      ),
    },
    { key: "total", header: "Total", className: "text-end", cell: (l) => <MoneyText money={l.total} /> },
    { key: "status", header: "Status", cell: (l) => <LocalStatusChip vocabulary="liability" code={l.status} /> },
    { key: "ref", header: "Reference", hideOnMobile: true, cell: (l) => (l.remittance_ref ? <bdi dir="ltr">{l.remittance_ref}</bdi> : <span className="text-muted-foreground">—</span>) },
    ...(canSubmit
      ? [
          {
            key: "actions",
            header: <span className="sr-only">Actions</span>,
            className: "text-end",
            cell: (l: Liability) =>
              l.status === "OPEN" ? (
                <Button size="sm" variant="secondary" className="min-h-[44px]" onClick={() => remit.openModal({ id: l.id })}>
                  Record remittance
                </Button>
              ) : l.status === "REMITTED" ? (
                <Button size="sm" variant="ghost" className="min-h-[44px]" onClick={() => reconcile.openModal({ id: l.id })}>
                  Reconcile
                </Button>
              ) : null,
          } as Column<Liability>,
        ]
      : []),
  ];
  return (
    <section aria-label="Liabilities and remittances" className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Status">
          <Select className="min-h-[44px]" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="OPEN">Open</option>
            <option value="REMITTED">Remitted</option>
            <option value="RECONCILED">Reconciled</option>
          </Select>
        </Field>
        <label className="flex min-h-[44px] items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} />
          Overdue only
        </label>
      </div>
      {data && Object.keys(data.totals ?? {}).length > 0 && (
        <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm" aria-label="Totals per currency and status">
          {Object.entries(data.totals).map(([cur, byStatus]) =>
            Object.entries(byStatus).map(([st, amount]) => (
              <li key={`${cur}-${st}`} className="flex items-center gap-2">
                <LocalStatusChip vocabulary="liability" code={st} />
                <MoneyText amount={amount} currency={cur} useCode />
              </li>
            )),
          )}
        </ul>
      )}
      {error && !data ? (
        <ErrorState message={errorText(error)} onRetry={() => void reload()} />
      ) : (
        <DataTable
          caption="Statutory liabilities"
          columns={columns}
          rows={data?.items}
          loading={loading}
          rowKey={(l) => l.id}
          cardBelowMd
          empty={<EmptyState icon={<Landmark />} title="No liabilities" description="Liabilities are created when runs with statutory lines are finalized." />}
        />
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ due-date calendar */

function DueCalendar({ entity, canCreate, newReport }: { entity: EntityCompliance; canCreate: boolean; newReport: ModalRoute }) {
  const cal = entity.due_calendar;
  const byMonth = useMemo(() => {
    const groups = new Map<string, DueItem[]>();
    (cal.items ?? []).forEach((item) => {
      const key = item.due_date.slice(0, 7);
      groups.set(key, [...(groups.get(key) ?? []), item]);
    });
    return Array.from(groups.entries());
  }, [cal.items]);
  if (!cal.available) {
    return (
      <Notice tone="warning" title="No due-date calendar">
        {cal.reason}
      </Notice>
    );
  }
  if (!cal.items.length) return <EmptyState icon={<CalendarClock />} title="Nothing due" description="The active pack defines no contributions or reports due in this window." />;
  return (
    <div className="space-y-4">
      <HonestLabels labels={[cal.watermark]} />
      {byMonth.map(([month, items]) => (
        <section key={month} aria-label={`Due in ${formatDate(`${month}-01`).replace(/^\d+\s/, "")}`}>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{formatDate(`${month}-01`).replace(/^\d+\s/, "")}</h4>
          <ol className="space-y-2">
            {items.map((item, i) => (
              <li key={`${item.kind}-${item.scheme ?? item.report_code}-${item.due_date}-${i}`} className="flex flex-wrap items-center gap-3 rounded-xl border border-border px-3 py-2 text-sm">
                <span className={`w-24 shrink-0 font-medium tabular-nums ${item.overdue ? "text-danger" : ""}`}>{formatDate(item.due_date)}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{item.kind === "REPORT" ? item.name ?? item.report_code : item.scheme}</span>
                  <span className="block text-xs text-muted-foreground">
                    {item.kind === "REPORT" ? "Report" : "Contribution"} · {formatRange(item.period_start, item.period_end)} · {item.rule}
                  </span>
                </span>
                {item.overdue && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-danger">
                    <TriangleAlert className="h-3.5 w-3.5" aria-hidden /> Overdue
                  </span>
                )}
                {item.kind === "REPORT" && entity.statutory_reports.some((r) => r.id === item.report_id) ? (
                  <StatusChip vocabulary="statutory_report" code={item.status} />
                ) : (
                  <LocalStatusChip vocabulary="due" code={item.status} />
                )}
                {item.kind === "REPORT" && item.status === "NOT_STARTED" && canCreate && (
                  <Button size="sm" variant="secondary" className="min-h-[44px]" onClick={() => newReport.openModal({ entity: entity.legal_entity.id, code: item.report_code, period: item.period_start })}>
                    Start
                  </Button>
                )}
                {item.kind === "REPORT" && item.report_id && (
                  <Link href={`/payroll/compliance/reports/${item.report_id}`} className="inline-flex min-h-[44px] items-center text-sm font-medium text-primary hover:underline">
                    Open
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ one entity */

function EntityPanel({ entity, routes, version }: { entity: EntityCompliance; routes: { action: ModalRoute; newReport: ModalRoute; remit: ModalRoute; reconcile: ModalRoute }; version: number }) {
  const { me } = useCan();
  const canReview = can(me, P.PAYROLL_STATUTORY_REVIEW);
  const canSubmit = can(me, P.PAYROLL_STATUTORY_SUBMIT);
  const cap = entity.capability;
  const pack = entity.active_pack;
  const att = entity.attestation;
  const perCurrency = Object.entries(entity.liabilities.per_currency ?? {});
  const openMoney: Money[] = perCurrency.map(([currency, b]) => ({ amount: b.open, currency }));
  const overdueMoney: Money[] = perCurrency.filter(([, b]) => b.overdue_count > 0).map(([currency, b]) => ({ amount: b.overdue, currency }));
  const reportsDue = entity.due_calendar.items.filter((i) => i.kind === "REPORT" && i.overdue).length;

  const reportColumns: Column<StatutoryReport>[] = [
    {
      key: "name",
      header: "Report",
      primary: true,
      cell: (r) => (
        <span>
          <Link href={`/payroll/compliance/reports/${r.id}`} className="font-medium hover:underline">
            {r.report_name}
          </Link>
          {r.version > 1 && <span className="ms-2 text-xs text-muted-foreground">v{r.version}</span>}
          {r.watermark && <span className="block text-[11px] font-semibold text-warning">{r.watermark}</span>}
        </span>
      ),
    },
    { key: "period", header: "Period", cell: (r) => formatRange(r.period_start, r.period_end) },
    { key: "due", header: "Due", cell: (r) => formatDate(r.due_date) },
    { key: "status", header: "Status", cell: (r) => <StatusChip vocabulary="statutory_report" code={r.status} /> },
    { key: "filing", header: "Filing ref", hideOnMobile: true, cell: (r) => (r.filing_ref ? <bdi dir="ltr">{r.filing_ref}</bdi> : <span className="text-muted-foreground">—</span>) },
    { key: "actions", header: <span className="sr-only">Actions</span>, cell: (r) => <ReportActions report={r} route={routes.action} compact /> },
  ];

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-display text-xl font-semibold">{entity.legal_entity.legal_name}</h2>
            <p className="text-sm text-muted-foreground">
              <bdi dir="ltr">{entity.legal_entity.code}</bdi> · {entity.country.name} (<bdi dir="ltr">{entity.country.code}</bdi>) · base currency <bdi dir="ltr">{entity.legal_entity.base_currency}</bdi>
            </p>
            {!entity.legal_entity.country_confirmed && <p className="mt-1 text-sm text-warning">The entity's country is not confirmed yet.</p>}
          </div>
          <div className="flex flex-col items-end gap-1 text-end">
            <LocalStatusChip vocabulary="capability" code={cap.kind} label={cap.label} tone={toneOf(cap.tone)} />
            <p className="max-w-sm text-sm" data-testid="capability-note">
              {cap.note}
            </p>
            {cap.recorded_note && <p className="max-w-sm text-xs text-muted-foreground">{cap.recorded_note}</p>}
          </div>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <section aria-label="Active country pack" className="rounded-xl border border-border p-4 text-sm">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Country pack</h3>
            {pack ? (
              <div className="space-y-1.5">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    <bdi dir="ltr">
                      {pack.code} {pack.version}
                    </bdi>
                  </span>
                  <StatusChip vocabulary="pack_version" code={pack.status} />
                </p>
                <HonestLabels labels={[pack.watermark]} />
                {pack.usage_message && <p className="text-muted-foreground">{pack.usage_message}</p>}
                <p className="text-muted-foreground">
                  Reviewed {pack.reviewed_on ? formatDate(pack.reviewed_on) : "never"}
                  {pack.reviewer ? ` by ${pack.reviewer}` : ""}
                  {pack.next_review_due ? ` · next source review ${formatDate(pack.next_review_due)}` : ""}
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground">No country pack covers this entity today.</p>
            )}
            {entity.pack_versions.length > 1 && (
              <details className="mt-2">
                <summary className="min-h-[44px] cursor-pointer py-2 text-sm font-medium text-primary sm:min-h-0">All pack versions ({entity.pack_versions.length})</summary>
                <ul className="mt-1 space-y-1">
                  {entity.pack_versions.map((v) => (
                    <li key={`${v.code}-${v.version}`} className="flex flex-wrap items-center gap-2">
                      <bdi dir="ltr">{v.version}</bdi>
                      <StatusChip vocabulary="pack_version" code={v.status} />
                      <span className="text-xs text-muted-foreground">
                        {formatDate(v.effective_from)} – {v.effective_to ? formatDate(v.effective_to) : "open"}
                        {v.is_fixture ? " · fixture" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
          <section aria-label="Attestation and registrations" className="rounded-xl border border-border p-4 text-sm">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Attestation</h3>
            <LocalStatusChip vocabulary="attestation" code={att.status} />
            {att.message && <p className="mt-2 text-muted-foreground">{att.message}</p>}
            {att.blocks_finalization && (
              <p className="mt-2 font-medium text-danger" role="alert">
                Runs for this entity cannot be finalized until an attestation is approved.
              </p>
            )}
            {att.active && (
              <p className="mt-2 text-muted-foreground">
                Covers {formatDate(att.active.effective_from)} – {att.active.effective_to ? formatDate(att.active.effective_to) : "until revoked"}
                {att.active.schemes.length ? ` · ${att.active.schemes.join(", ")}` : ""}
              </p>
            )}
            <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Registrations</h3>
            {entity.registrations.length ? (
              <dl className="space-y-1">
                {entity.registrations.map((r) => (
                  <div key={`${r.label}-${r.value}`} className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{r.label}</dt>
                    <dd>
                      <bdi dir="ltr">{r.value}</bdi>
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-muted-foreground">No registrations recorded. Add them in Settings › Company › Legal entities.</p>
            )}
          </section>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Open liabilities" count={entity.liabilities.open_count} icon={<Landmark />} tone="warning" hint={openMoney.length ? undefined : "None open"} delay={0} />
        <KpiCard label="Overdue" count={entity.liabilities.overdue_count} icon={<TriangleAlert />} tone={entity.liabilities.overdue_count ? "danger" : "success"} amounts={overdueMoney.length ? overdueMoney : null} delay={0.05} />
        <KpiCard label="Open amount" amounts={openMoney} icon={<Scale />} tone="info" delay={0.1} definition="Owed to authorities and not remitted, per currency. Never added across currencies." />
        <KpiCard label="Reports overdue" count={reportsDue} icon={<CalendarClock />} tone={reportsDue ? "danger" : "success"} hint={entity.liabilities.next_due_date ? `Next contribution due ${formatDate(entity.liabilities.next_due_date)}` : undefined} delay={0.15} />
      </div>

      <Card className="p-5">
        <CardHeader
          title="Statutory reports"
          description="Lifecycle: generate → review → verify → export (ready to file) → mark submitted with the filing reference."
          action={
            canReview && entity.report_definitions.length > 0 ? (
              <Button variant="secondary" className="min-h-[44px]" onClick={() => routes.newReport.openModal({ entity: entity.legal_entity.id })}>
                <FilePlus2 className="h-4 w-4" aria-hidden /> New report
              </Button>
            ) : undefined
          }
        />
        {entity.statutory_reports.length === 0 ? (
          <EmptyState
            icon={<Scale />}
            title="No statutory reports yet"
            description={entity.report_definitions.length ? "Start one from the due-date calendar below, or create a draft." : "Reports appear once a verified country pack covers this entity."}
          />
        ) : (
          <DataTable caption="Statutory reports" columns={reportColumns} rows={entity.statutory_reports} rowKey={(r) => r.id} cardBelowMd />
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <CardHeader title="Due-date calendar" description={entity.due_calendar.pack_version ? `From pack version ${entity.due_calendar.pack_version}` : undefined} />
          <DueCalendar entity={entity} canCreate={canReview} newReport={routes.newReport} />
        </Card>
        <Card className="p-5">
          <CardHeader title="Liabilities and remittances" description="Per currency; never added across currencies." />
          <LiabilitiesTable entityId={entity.legal_entity.id} canSubmit={canSubmit} remit={routes.remit} reconcile={routes.reconcile} version={version} />
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ the page */

export function CompliancePage() {
  const { data, error, loading, reload } = useApi(() => complianceApi.overview(), []);
  const [active, setActive] = useState<string>("");
  const [version, setVersion] = useState(0);
  const action = useModalRoute("statutory-action", { keys: ["id", "action"] });
  const newReport = useModalRoute("new-statutory", { keys: ["entity", "code", "period"] });
  const remit = useModalRoute("remit");
  const reconcile = useModalRoute("reconcile");
  const entities = data?.entities ?? [];
  const current = entities.find((e) => String(e.legal_entity.id) === active) ?? entities[0];
  const changed = () => {
    setVersion((v) => v + 1);
    void reload();
  };
  return (
    <div className="space-y-5">
      <WorkspaceHeader
        title="Compliance"
        description={
          data
            ? `Statutory capability, filings and liabilities per legal entity · as of ${formatDate(data.as_of)} · ${data.environment.toLowerCase()} environment`
            : "Statutory capability, filings and liabilities per legal entity."
        }
      />
      {error && !data ? (
        <ErrorState message={errorText(error)} onRetry={() => void reload()} />
      ) : loading && !data ? (
        <Card className="p-6" aria-busy="true">
          <p className="text-sm text-muted-foreground">Loading compliance…</p>
        </Card>
      ) : !entities.length ? (
        <Card>
          <EmptyState icon={<Scale />} title="No legal entities in your scope" description="Compliance is shown per legal entity you can see." />
        </Card>
      ) : (
        <>
          {entities.length > 1 && (
            <Tabs tabs={entities.map((e) => ({ value: String(e.legal_entity.id), label: e.legal_entity.code }))} value={String(current?.legal_entity.id ?? "")} onValueChange={setActive}>
              <span />
            </Tabs>
          )}
          {current && <EntityPanel entity={current} routes={{ action, newReport, remit, reconcile }} version={version} />}
        </>
      )}
      <ReportActionModal route={action} onDone={changed} />
      <NewStatutoryReportModal route={newReport} entities={entities} onDone={changed} />
      <LiabilityActionModal route={remit} kind="remit" onDone={changed} />
      <LiabilityActionModal route={reconcile} kind="reconcile" onDone={changed} />
    </div>
  );
}

/* ------------------------------------------------------------------ full pages */

export function StatutoryReportPage({ id }: { id: string }) {
  const { data, error, loading, reload } = useApi(() => complianceApi.report(id), [id], { enabled: !!id });
  const action = useModalRoute("statutory-action", { keys: ["id", "action"] });
  const timeline: TimelineItem[] = data
    ? (
        [
          ["generated", data.generated_at, "Generated", "info"],
          ["verified", data.verified_at, "Verified", "success"],
          ["exported", data.exported_at, "Exported — ready to file", "info"],
          ["submitted", data.submitted_at, `Submitted${data.filing_ref ? ` · ref ${data.filing_ref}` : ""}`, "info"],
          ["accepted", data.acknowledged_at, `Accepted${data.acknowledgement_ref ? ` · ack ${data.acknowledgement_ref}` : ""}`, "success"],
          ["rejected", data.rejected_at, "Rejected by the authority", "danger"],
          ["amended", data.amended_at, "Amended", "neutral"],
        ] as const
      )
        .filter(([, at]) => !!at)
        .map(([key, at, title, tone]) => ({ id: key, at: at as string, title, tone, body: key === "rejected" ? data.authority_response : undefined }))
        .sort((a, b) => b.at.localeCompare(a.at))
    : [];
  return (
    <div className="space-y-5">
      <Link href="/payroll/compliance" className="inline-flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden /> Compliance
      </Link>
      <DetailGate loading={loading} error={error} hasData={!!data} onRetry={() => void reload()} what="Statutory report" backHref="/payroll/compliance" backLabel="Back to compliance">
        {data && (
          <>
            <WorkspaceHeader
              eyebrow="Statutory report"
              title={data.report_name}
              description={`${formatRange(data.period_start, data.period_end)} · ${data.frequency.toLowerCase()} · pack ${data.pack_code} ${data.pack_version} · version ${data.version}`}
              showHideAmounts={false}
            />
            <HonestLabels labels={[data.watermark]} />
            <Card className="space-y-4 p-5">
              <div className="flex flex-wrap items-center gap-3">
                <StatusChip vocabulary="statutory_report" code={data.status} showCode />
                {data.due_date && <span className="text-sm text-muted-foreground">Due {formatDate(data.due_date)}</span>}
              </div>
              <p className="text-sm text-muted-foreground">{data.lifecycle_note}</p>
              {data.status_reason && <p className="text-sm">Last reason: “{data.status_reason}”</p>}
              <ReportActions report={data} route={action} />
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Rows</dt>
                  <dd className="tabular-nums">{data.row_count ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Content hash</dt>
                  <dd className="truncate font-mono text-xs">
                    <bdi dir="ltr">{data.content_hash ?? "—"}</bdi>
                  </dd>
                </div>
                {data.export_sha256 && (
                  <div>
                    <dt className="text-muted-foreground">Exported file SHA-256</dt>
                    <dd className="truncate font-mono text-xs">
                      <bdi dir="ltr">{data.export_sha256}</bdi>
                    </dd>
                  </div>
                )}
                {data.amends_report_id && (
                  <div>
                    <dt className="text-muted-foreground">Amends</dt>
                    <dd>
                      <Link href={`/payroll/compliance/reports/${data.amends_report_id}`} className="text-primary hover:underline">
                        Report #{data.amends_report_id}
                      </Link>
                    </dd>
                  </div>
                )}
                {data.amended_by_report_id && (
                  <div>
                    <dt className="text-muted-foreground">Amended by</dt>
                    <dd>
                      <Link href={`/payroll/compliance/reports/${data.amended_by_report_id}`} className="text-primary hover:underline">
                        Report #{data.amended_by_report_id}
                      </Link>
                    </dd>
                  </div>
                )}
              </dl>
            </Card>
            {timeline.length > 0 && (
              <Card className="p-5">
                <CardHeader title="History" />
                <Timeline items={timeline} />
              </Card>
            )}
          </>
        )}
      </DetailGate>
      <ReportActionModal route={action} onDone={() => void reload()} />
    </div>
  );
}

export function LiabilityPage({ id }: { id: string }) {
  const { me } = useCan();
  const canSubmit = can(me, P.PAYROLL_STATUTORY_SUBMIT);
  const { data, error, loading, reload } = useApi(() => complianceApi.liability(id), [id], { enabled: !!id });
  const remit = useModalRoute("remit");
  const reconcile = useModalRoute("reconcile");
  return (
    <div className="space-y-5">
      <Link href="/payroll/compliance" className="inline-flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden /> Compliance
      </Link>
      <DetailGate loading={loading} error={error} hasData={!!data} onRetry={() => void reload()} what="Liability" backHref="/payroll/compliance" backLabel="Back to compliance">
        {data && (
          <>
            <WorkspaceHeader
              eyebrow="Statutory liability"
              title={`${data.scheme}${data.payee ? ` · ${data.payee}` : ""}`}
              description={`${formatRange(data.period_start, data.period_end)} · run ${data.run_number}`}
              actions={
                canSubmit && data.status === "OPEN" ? (
                  <Button className="min-h-[44px]" onClick={() => remit.openModal({ id: data.id })}>
                    Record remittance
                  </Button>
                ) : canSubmit && data.status === "REMITTED" ? (
                  <Button className="min-h-[44px]" onClick={() => reconcile.openModal({ id: data.id })}>
                    Reconcile
                  </Button>
                ) : undefined
              }
            />
            <HonestLabels labels={[data.watermark]} />
            <Card className="p-5">
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Status</dt>
                  <dd className="mt-0.5">
                    <LocalStatusChip vocabulary="liability" code={data.status} />
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Due</dt>
                  <dd className={data.overdue ? "font-medium text-danger" : undefined}>
                    {formatDate(data.due_date)}
                    {data.overdue ? " (overdue)" : ""}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Employee share</dt>
                  <dd>
                    <MoneyText money={data.employee_amount} />
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Employer share</dt>
                  <dd>
                    <MoneyText money={data.employer_amount} />
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Total</dt>
                  <dd>
                    <MoneyText money={data.total} emphasis />
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Remittance</dt>
                  <dd>
                    {data.remittance_ref ? (
                      <>
                        <bdi dir="ltr">{data.remittance_ref}</bdi>
                        {data.remitted_on ? ` · paid ${formatDate(data.remitted_on)}` : ""}
                      </>
                    ) : (
                      "Not recorded"
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Pay date</dt>
                  <dd>{formatDate(data.pay_date)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Run</dt>
                  <dd>
                    {can(me, P.PAYROLL_RUN_READ) ? (
                      <Link href={`/payroll/runs/${data.run_id}`} className="text-primary hover:underline">
                        {data.run_number}
                      </Link>
                    ) : (
                      data.run_number
                    )}{" "}
                    <span className="text-xs text-muted-foreground">({statusEntry("run", data.run_status).label})</span>
                  </dd>
                </div>
              </dl>
            </Card>
          </>
        )}
      </DetailGate>
      <LiabilityActionModal route={remit} kind="remit" onDone={() => void reload()} />
      <LiabilityActionModal route={reconcile} kind="reconcile" onDone={() => void reload()} />
    </div>
  );
}
