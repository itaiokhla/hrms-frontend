"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, BarChart3, Download, Eye, Lock, Play, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import toast from "react-hot-toast";

import { CurrencyBadge } from "@/components/payroll/CurrencyBadge";
import { MoneyText } from "@/components/payroll/MoneyText";
import { useModalRoute, type ModalRoute } from "@/components/payroll/useModalRoute";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Badge, Card, CardHeader, Skeleton } from "@/components/ui/primitives";
import { useApi } from "@/lib/hooks";
import type { Money } from "@/lib/money";

import { findReport, reportsApi } from "./api";
import {
  DetailGate,
  ErrorSummary,
  HonestLabels,
  LookupField,
  Notice,
  WorkspaceHeader,
  errorText,
  formatDate,
  formatDateTime,
  NotFoundState,
  useCostCenters,
  useDepartments,
  useEntities,
  usePayGroups,
  useReportDirty,
} from "./shared";
import type { CatalogueReport, ReportColumn, ReportFilters, ReportPreview } from "./types";

const STATUS_SUGGESTIONS = ["FINAL", "APPROVED", "DRAFT", "ALL"];
const GROUP_BY_LABEL: Record<string, string> = { legal_entity: "Legal entity", department: "Department", cost_center: "Cost center", grade: "Grade" };
const CURRENCY = /^[A-Z]{3}$/;
/** services/reports.py PDF_MAX_ROWS: PDF exports stop here and carry a note; CSV/XLSX have every row. */
const PDF_MAX_ROWS = 5000;

/** What each catalogue group is for (3.8 §5.13). */
const GROUP_PURPOSE: Record<string, string> = {
  Payroll: "Registers, summaries and corrections of finalized runs.",
  Cost: "What the payroll costs the employer.",
  Time: "Overtime, loss of pay, holiday work and lateness.",
  Variable: "Bonus, task pay and arrears.",
  "Money out": "Payments, failures, reconciliation and what is still owed.",
  Ledgers: "Loans, reimbursements and leave encashments.",
  Compliance: "Statutory filings, liabilities and remittances.",
  Audit: "Who changed settings, salaries and bank details.",
};

/* ------------------------------------------------------------------ filters */

export function validateFilters(filters: ReportFilters): Record<string, string> {
  const errors: Record<string, string> = {};
  if (filters.period_from && filters.period_to && filters.period_from > filters.period_to) errors.period_to = "The period ends before it starts.";
  if (filters.currency && !CURRENCY.test(filters.currency)) errors.currency = "Use a three-letter ISO code such as INR.";
  if (filters.convert_to && !CURRENCY.test(filters.convert_to)) errors.convert_to = "Use a three-letter ISO code such as USD.";
  if (filters.status && !/^[A-Z_]+$/.test(filters.status)) errors.status = "Use a status code such as FINAL.";
  return errors;
}

function FilterForm({ report, value, onChange, errors, conversion = true }: { report: CatalogueReport; value: ReportFilters; onChange: (v: ReportFilters) => void; errors: Record<string, string>; conversion?: boolean }) {
  const entities = useEntities();
  const payGroups = usePayGroups();
  const departments = useDepartments();
  const costCenters = useCostCenters();
  const has = (name: string) => report.filters.includes(name);
  const set = <K extends keyof ReportFilters>(key: K, v: ReportFilters[K] | null | "") => {
    const next = { ...value };
    if (v === null || v === "" || v === undefined) delete next[key];
    else next[key] = v as ReportFilters[K];
    onChange(next);
  };
  const upper = (s: string) => s.toUpperCase().replace(/[^A-Z_]/g, "");
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {has("period") && (
        <>
          <Field label="Period from" error={errors.period_from}>
            <Input type="date" className="min-h-[44px]" value={value.period_from ?? ""} onChange={(e) => set("period_from", e.target.value)} />
          </Field>
          <Field label="Period to" error={errors.period_to}>
            <Input type="date" className="min-h-[44px]" value={value.period_to ?? ""} aria-invalid={!!errors.period_to} onChange={(e) => set("period_to", e.target.value)} />
          </Field>
        </>
      )}
      {has("legal_entity") && <LookupField label="Legal entity" lookup={entities} value={value.legal_entity_id ?? null} onChange={(v) => set("legal_entity_id", v)} />}
      {has("pay_group") && <LookupField label="Pay group" lookup={payGroups} value={value.pay_group_id ?? null} onChange={(v) => set("pay_group_id", v)} />}
      {has("department") && <LookupField label="Department" lookup={departments} value={value.department_id ?? null} onChange={(v) => set("department_id", v)} />}
      {has("cost_center") && <LookupField label="Cost center" lookup={costCenters} value={value.cost_center_id ?? null} onChange={(v) => set("cost_center_id", v)} />}
      {has("currency") && (
        <Field label="Currency" error={errors.currency} hint="Only rows in this currency.">
          <Input className="min-h-[44px] uppercase" maxLength={3} value={value.currency ?? ""} aria-invalid={!!errors.currency} onChange={(e) => set("currency", upper(e.target.value).slice(0, 3))} />
        </Field>
      )}
      {has("status") && (
        <Field label="Status" error={errors.status} hint="Run reports: FINAL (default), APPROVED, DRAFT or ALL.">
          <Input className="min-h-[44px] uppercase" list={`status-${report.code}`} value={value.status ?? ""} aria-invalid={!!errors.status} onChange={(e) => set("status", upper(e.target.value))} />
          <datalist id={`status-${report.code}`}>
            {STATUS_SUGGESTIONS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>
      )}
      {has("group_by") && (
        <Field label="Group by">
          <Select className="min-h-[44px]" value={value.group_by ?? ""} onChange={(e) => set("group_by", e.target.value)}>
            <option value="">Default</option>
            {Object.entries(GROUP_BY_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {has("tax_year") && (
        <Field label="Tax year">
          <Input className="min-h-[44px]" maxLength={10} value={value.tax_year ?? ""} onChange={(e) => set("tax_year", e.target.value.trim())} />
        </Field>
      )}
      {conversion && (
        <>
          <Field label="Convert totals to" error={errors.convert_to} hint="Optional. Totals stay per currency unless you choose one; the FX basis is always shown.">
            <Input className="min-h-[44px] uppercase" maxLength={3} value={value.convert_to ?? ""} aria-invalid={!!errors.convert_to} onChange={(e) => set("convert_to", upper(e.target.value).slice(0, 3))} />
          </Field>
          {value.convert_to && (
            <Field label="FX date" hint="Defaults to the end of the period.">
              <Input type="date" className="min-h-[44px]" value={value.fx_date ?? ""} onChange={(e) => set("fx_date", e.target.value)} />
            </Field>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ preview */

function Cell({ column, value, suppressed }: { column: ReportColumn; value: unknown; suppressed?: boolean }) {
  if (value === null || value === undefined || value === "") {
    return suppressed && column.type === "money" ? <span className="text-xs text-muted-foreground">(hidden)</span> : <span className="text-muted-foreground">—</span>;
  }
  switch (column.type) {
    case "money":
      return <MoneyText money={value as Money} />;
    case "date":
      return <span className="whitespace-nowrap">{formatDate(String(value))}</span>;
    case "datetime":
      return <span className="whitespace-nowrap">{formatDateTime(String(value))}</span>;
    case "decimal":
    case "int":
      return (
        <bdi dir="ltr" className="tabular-nums">
          {String(value)}
        </bdi>
      );
    case "bool":
      return <span>{value ? "Yes" : "No"}</span>;
    default:
      return <span>{typeof value === "object" ? JSON.stringify(value) : String(value)}</span>;
  }
}

const NUMERIC = new Set(["money", "decimal", "int"]);

export function PreviewTable({ preview }: { preview: ReportPreview }) {
  const moneyColumns = preview.columns.filter((c) => c.type === "money");
  const currencies = Object.keys(preview.totals ?? {});
  return (
    <div className="space-y-4">
      <HonestLabels labels={[preview.watermark]} />
      {preview.notes?.map((n) => (
        <Notice key={n} tone="info" title={n} />
      ))}
      {preview.rows.length === 0 ? (
        <EmptyState icon={<BarChart3 />} title="No rows for these filters" description="Widen the period or clear a filter. Run reports read finalized runs unless you choose another status." />
      ) : (
        <div className="scrollbar-thin overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">
              {preview.report.name}: first {preview.rows.length} of {preview.row_count} rows
            </caption>
            <thead className="bg-surface-muted/60">
              <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                {preview.columns.map((c) => (
                  <th key={c.key} scope="col" className={`whitespace-nowrap px-3 py-2 font-medium ${NUMERIC.has(c.type) ? "text-end" : "text-start"}`}>
                    {c.label}
                    {c.sensitive && <Lock className="ms-1 inline h-3 w-3" aria-label="sensitive" />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row, i) => (
                <tr key={i} className="border-t border-border/60">
                  {preview.columns.map((c) => (
                    <td key={c.key} className={`px-3 py-2 ${NUMERIC.has(c.type) ? "text-end" : ""}`}>
                      <Cell column={c} value={row[c.key]} suppressed={!!row.suppressed} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        {preview.truncated ? `Showing the first ${preview.rows.length} of ${preview.row_count} rows. Export to get every row.` : `${preview.row_count} row${preview.row_count === 1 ? "" : "s"}.`}
      </p>
      {currencies.length > 0 && moneyColumns.length > 0 && (
        <section aria-label="Totals per currency" className="space-y-2">
          <h3 className="text-sm font-semibold">Totals per currency</h3>
          <div className="scrollbar-thin overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <caption className="sr-only">Totals per currency (never added across currencies)</caption>
              <thead className="bg-surface-muted/60">
                <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    Currency
                  </th>
                  {moneyColumns.map((c) => (
                    <th key={c.key} scope="col" className="px-3 py-2 text-end font-medium">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {currencies.map((cur) => (
                  <tr key={cur} className="border-t border-border/60">
                    <th scope="row" className="px-3 py-2 text-start">
                      <CurrencyBadge code={cur} />
                    </th>
                    {moneyColumns.map((c) => (
                      <td key={c.key} className="px-3 py-2 text-end">
                        <MoneyText amount={preview.totals[cur]?.[c.key] ?? null} currency={cur} emphasis />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {preview.converted && <ConvertedTotals preview={preview} />}
    </div>
  );
}

function ConvertedTotals({ preview }: { preview: ReportPreview }) {
  const c = preview.converted!;
  if (!c.available) {
    return (
      <Notice tone="warning" title={`Not converted to ${c.currency}`}>
        <p>{c.message ?? "No usable FX rate; amounts stay per currency."}</p>
        {c.issues?.length ? (
          <ul className="mt-1 list-disc ps-5">
            {c.issues.map((i) => (
              <li key={i.currency}>
                {i.currency}: {i.message}
              </li>
            ))}
          </ul>
        ) : null}
      </Notice>
    );
  }
  const labels = Object.fromEntries(preview.columns.map((col) => [col.key, col.label]));
  return (
    <section aria-label={`Converted to ${c.currency}`} className="rounded-xl border border-info/30 bg-info-soft p-4 text-sm">
      <h3 className="font-semibold">Converted total in {c.currency}</h3>
      <dl className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {Object.entries(c.totals ?? {}).map(([key, money]) => (
          <div key={key} className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{labels[key] ?? key}</dt>
            <dd>
              <MoneyText money={money} emphasis />
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">
        {c.label ?? "Converted for reporting only."} FX date {formatDate(c.date)}.
      </p>
      {c.rates?.length ? (
        <ul className="mt-1 text-xs text-muted-foreground" aria-label="FX rates used">
          {c.rates.map((r) => (
            <li key={`${r.base}-${r.quote}`}>
              1 {r.base} = <bdi dir="ltr">{r.rate}</bdi> {r.quote} · {r.source} · {formatDate(r.as_of)}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ export modal (`?modal=report&code=`) */

export function GenerateReportModal({
  route,
  report,
  onQueued,
  onDirtyChange,
}: {
  route: ModalRoute;
  report: CatalogueReport | undefined;
  onQueued?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [filters, setFilters] = useState<ReportFilters>({});
  const [format, setFormat] = useState("CSV");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(false);
  const code = route.param("code");
  useReportDirty(route.open && !queued && Object.keys(filters).length > 0, onDirtyChange);
  useEffect(() => {
    if (route.open) {
      setFilters({});
      setFormat(report?.formats?.[0] ?? "CSV");
      setErrors({});
      setError(null);
      setQueued(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.open, code]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!report) return;
    const v = validateFilters(filters);
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    setError(null);
    try {
      await reportsApi.export(report.code, format, filters);
      setQueued(true);
      toast.success("Export queued. It will be ready in Downloads.");
      onQueued?.();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const blocked = report && (!report.available || !report.exportable);
  return (
    <Modal
      open={route.open}
      onOpenChange={route.onOpenChange}
      size="md"
      title={report ? `Export · ${report.name}` : "Export report"}
      description="The file is built in the background and appears in your download center."
      footer={
        queued ? (
          <>
            <Button variant="ghost" className="min-h-[44px]" onClick={() => route.onOpenChange(false)}>
              Close
            </Button>
            <Link href="/downloads" className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">
              <Download className="h-4 w-4" aria-hidden /> Open downloads
            </Link>
          </>
        ) : (
          <>
            <Button variant="ghost" className="min-h-[44px]" onClick={() => route.onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" form="report-export" className="min-h-[44px]" loading={busy} disabled={!report || !!blocked}>
              Queue export
            </Button>
          </>
        )
      }
    >
      {!report ? (
        code ? <p className="text-sm text-muted-foreground">This report is not in your catalogue.</p> : <p className="text-sm text-muted-foreground">Choose a report first.</p>
      ) : queued ? (
        <Notice tone="info" title="Export queued">
          You can keep working. The file will show as Ready in Downloads; it is watermarked with your name and kept for 24 hours.
        </Notice>
      ) : (
        <form id="report-export" onSubmit={submit} className="space-y-4" noValidate>
          {!report.available && <Notice tone="warning" title="Not available">{report.unavailable_reason}</Notice>}
          {report.available && !report.exportable && <Notice tone="warning" title="You can preview this report but not export it">Exporting needs the “Export payroll reports” permission.</Notice>}
          <ErrorSummary error={error} fields={errors} />
          <Field label="Format">
            <Select className="min-h-[44px]" value={format} onChange={(e) => setFormat(e.target.value)}>
              {(report.formats?.length ? report.formats : ["CSV"]).map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
          </Field>
          {format === "PDF" && (
            <p className="text-xs text-muted-foreground" data-testid="pdf-cap-note">
              A PDF holds the first {PDF_MAX_ROWS.toLocaleString("en")} rows and says so on the file. Export CSV or XLSX to get every row.
            </p>
          )}
          <FilterForm report={report} value={filters} onChange={setFilters} errors={errors} />
          {report.columns.some((c) => c.sensitive) && <p className="text-xs text-muted-foreground">Sensitive columns are masked unless you can export for the whole company.</p>}
        </form>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ catalogue page */

export function ReportsCatalogue() {
  const { data, error, loading, reload } = useApi(() => reportsApi.catalogue(), []);
  const [dirty, setDirty] = useState(false);
  const route = useModalRoute("report", { keys: ["code"], dirty });
  const report = findReport(data, route.param("code"));
  const reduce = useReducedMotion();
  return (
    <div className="space-y-5">
      <WorkspaceHeader
        title="Reports"
        description="Payroll reports grouped by purpose. Preview the first rows, then export the full file to your download center."
        actions={
          <Link href="/downloads" className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-border px-4 text-sm font-medium hover:bg-surface-muted">
            <Download className="h-4 w-4" aria-hidden /> Downloads
          </Link>
        }
      />
      {error && !data ? (
        <ErrorState message={errorText(error)} onRetry={() => void reload()} />
      ) : loading && !data ? (
        <div className="grid gap-4 md:grid-cols-2" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      ) : !data?.groups.length ? (
        <Card>
          <EmptyState icon={<BarChart3 />} title="No reports available to you" description="Reports need the matching payroll permissions. Ask your administrator if you need one." />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.groups.map((group, gi) => (
            <motion.section
              key={group.name}
              aria-label={group.name}
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: Math.min(gi, 12) * 0.04 }}
              className="rounded-2xl border border-border/80 bg-surface p-5 shadow-card"
            >
              <h2 className="font-display text-lg font-semibold">{group.name}</h2>
              {GROUP_PURPOSE[group.name] && <p className="text-sm text-muted-foreground">{GROUP_PURPOSE[group.name]}</p>}
              <ul className="mt-3 divide-y divide-border/60">
                {group.reports.map((r) => (
                  <li key={r.code} className="flex flex-wrap items-start justify-between gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {r.name}
                        {r.analytics && (
                          <Badge tone="info" className="ms-2 align-middle" title="Groups smaller than the privacy threshold are hidden.">
                            <ShieldCheck className="h-3 w-3" aria-hidden /> Small groups hidden
                          </Badge>
                        )}
                      </p>
                      <p className="text-sm text-muted-foreground">{r.description}</p>
                      {!r.available && <p className="mt-1 text-sm text-warning">{r.unavailable_reason}</p>}
                    </div>
                    <div className="flex gap-2">
                      {r.available ? (
                        <Link href={`/payroll/reports/${encodeURIComponent(r.code)}`} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-medium hover:bg-surface-muted" aria-label={`Preview ${r.name}`}>
                          <Eye className="h-4 w-4" aria-hidden /> Preview
                        </Link>
                      ) : null}
                      {r.available && r.exportable && (
                        <Button variant="ghost" className="min-h-[44px]" aria-label={`Export ${r.name}`} onClick={() => route.openModal({ code: r.code })}>
                          <Download className="h-4 w-4" aria-hidden /> Export
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </motion.section>
          ))}
        </div>
      )}
      <GenerateReportModal route={route} report={report} onDirtyChange={setDirty} />
    </div>
  );
}

/* ------------------------------------------------------------------ one report (full page of the modal) */

export function ReportPage({ code }: { code: string }) {
  const catalogue = useApi(() => reportsApi.catalogue(), []);
  const report = findReport(catalogue.data, code);
  const [dirty, setDirty] = useState(false);
  const route = useModalRoute("report", { keys: ["code"], dirty });
  const [filters, setFilters] = useState<ReportFilters>({});
  const [applied, setApplied] = useState<ReportFilters | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const preview = useApi(() => reportsApi.preview(code, applied ?? {}), [code, JSON.stringify(applied)], { enabled: !!report?.available && applied !== null });

  // First preview with no filters as soon as the report is known.
  useEffect(() => {
    if (report?.available && applied === null) setApplied({});
  }, [report?.available, applied]);

  const run = (e?: FormEvent) => {
    e?.preventDefault();
    const v = validateFilters(filters);
    setErrors(v);
    if (Object.keys(v).length) return;
    setApplied({ ...filters });
  };

  const notInCatalogue = catalogue.data && !report;
  const title = useMemo(() => report?.name ?? "Report", [report]);

  if (notInCatalogue) return <NotFoundState what="Report" backHref="/payroll/reports" backLabel="Back to reports" />;

  return (
    <div className="space-y-5">
      <Link href="/payroll/reports" className="inline-flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden /> Reports
      </Link>
      <DetailGate loading={catalogue.loading} error={catalogue.error} hasData={!!report} onRetry={() => void catalogue.reload()} what="Report" backHref="/payroll/reports" backLabel="Back to reports">
        {report && (
          <>
            <WorkspaceHeader
              title={title}
              description={report.description}
              actions={
                report.available && report.exportable ? (
                  <Button className="min-h-[44px]" onClick={() => route.openModal({ code: report.code })}>
                    <Download className="h-4 w-4" aria-hidden /> Export
                  </Button>
                ) : undefined
              }
            />
            {!report.available ? (
              <Notice tone="warning" title="This report is not available yet">{report.unavailable_reason}</Notice>
            ) : (
              <>
                <Card className="p-4">
                  <form onSubmit={run} className="space-y-4" noValidate>
                    <ErrorSummary error={null} fields={errors} />
                    <FilterForm report={report} value={filters} onChange={setFilters} errors={errors} />
                    <div className="flex justify-end">
                      <Button type="submit" variant="secondary" className="min-h-[44px]" loading={preview.loading}>
                        <Play className="h-4 w-4" aria-hidden /> Update preview
                      </Button>
                    </div>
                  </form>
                </Card>
                <Card className="p-4">
                  <CardHeader title="Preview" description={preview.data ? `First ${preview.data.rows.length} of ${preview.data.row_count} rows` : undefined} />
                  {preview.error ? (
                    <div className="space-y-3">
                      {/* 409 REPORT_NOT_AVAILABLE and 404s are explained too, never a blank card. */}
                      <Notice tone="warning" title="The preview could not be built">
                        {errorText(preview.error)}
                      </Notice>
                      <Button variant="secondary" className="min-h-[44px]" onClick={() => void preview.reload()}>
                        Try again
                      </Button>
                    </div>
                  ) : preview.loading && !preview.data ? (
                    <div className="space-y-2" aria-busy="true">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Skeleton key={i} className="h-9 w-full" />
                      ))}
                    </div>
                  ) : preview.data ? (
                    <PreviewTable preview={preview.data} />
                  ) : null}
                </Card>
              </>
            )}
          </>
        )}
      </DetailGate>
      <GenerateReportModal route={route} report={report} onDirtyChange={setDirty} />
    </div>
  );
}
