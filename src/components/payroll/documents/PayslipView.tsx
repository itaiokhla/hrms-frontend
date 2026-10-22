"use client";

import { ArrowLeft, Download, ExternalLink, HelpCircle, Printer, Send } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { ExplainPanel, type ExplainInput, type ExplainSource } from "@/components/payroll/ExplainPanel";
import { MoneyText } from "@/components/payroll/MoneyText";
import { StatusChip } from "@/components/payroll/StatusChip";
import type { ModalRoute } from "@/components/payroll/useModalRoute";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlay";
import { Card } from "@/components/ui/primitives";
import { can } from "@/lib/access";
import { useApi } from "@/lib/hooks";
import { payrollApi } from "@/lib/payroll/api";
import { formatDays, formatDecimalHours } from "@/lib/payroll/labels";
import { P } from "@/lib/permissions.generated";

import { openSignedLink, payslipsApi } from "./api";
import { DetailGate, HonestLabels, Notice, WorkspaceHeader, errorText, formatDate, formatDateTime, isRtlLanguage } from "./shared";
import { PUBLISHED_STATES, type PayslipContent, type PayslipDetail, type PayslipLineItem } from "./types";

const DEFAULT_SECTIONS = ["HEADER", "EMPLOYEE", "ATTENDANCE_SUMMARY", "EARNINGS", "DEDUCTIONS", "REIMBURSEMENTS", "EMPLOYER_CONTRIBUTIONS", "TOTALS", "PAYMENT", "LEAVE_BALANCES", "TAX_SUMMARY", "FOOTER"];

const SECTION_TITLES: Record<string, string> = {
  EMPLOYEE: "Employee",
  ATTENDANCE_SUMMARY: "Attendance summary",
  EARNINGS: "Earnings",
  DEDUCTIONS: "Deductions",
  REIMBURSEMENTS: "Reimbursements (not wages)",
  EMPLOYER_CONTRIBUTIONS: "Paid by your employer",
  TOTALS: "Totals",
  PAYMENT: "Payment",
  LEAVE_BALANCES: "Leave balances",
  TAX_SUMMARY: "Tax summary",
};

/** Print only the payslip (modal or page): everything else on the screen is hidden while printing. */
const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  [data-payslip-print], [data-payslip-print] * { visibility: visible !important; }
  [data-payslip-print] { position: absolute; inset-inline-start: 0; top: 0; width: 100%; box-shadow: none !important; border: 0 !important; }
  [data-print-hidden] { display: none !important; }
}`;

/* ------------------------------------------------------------------ "Why this amount?" (run employee trace) */

interface RunLine {
  component: string;
  kind: string;
  amount: { amount: string; currency: string } | null;
  explanation: string | null;
  trace: Record<string, unknown> | null;
  sources: Record<string, unknown>[];
}

interface Explainer {
  available: boolean;
  load: () => Promise<RunLine[] | null>;
}

/**
 * The payslip itself carries no calculation trace; the run employee detail does
 * (GET /payroll/runs/{run}/employees/{runEmployee}, payroll:run:read). Loaded once, on first ask.
 */
function useExplainer(detail: PayslipDetail | undefined): Explainer {
  const { me } = useCan();
  const cache = useRef<Promise<RunLine[] | null> | null>(null);
  const available = !!detail?.run_id && !!detail?.run_employee_id && can(me, P.PAYROLL_RUN_READ);
  const load = useCallback(() => {
    if (!detail?.run_id || !detail.run_employee_id) return Promise.resolve(null);
    if (!cache.current) {
      cache.current = payrollApi
        .get<{ lines: RunLine[] }>(`/payroll/runs/${detail.run_id}/employees/${detail.run_employee_id}`)
        .then((d) => d.lines ?? [])
        .catch((e) => {
          cache.current = null;
          throw e;
        });
    }
    return cache.current;
  }, [detail?.run_id, detail?.run_employee_id]);
  return { available, load };
}

function primitive(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object" && value && "amount" in value && "currency" in value) {
    const m = value as { amount: unknown; currency: unknown };
    return `${String(m.amount)} ${String(m.currency)}`;
  }
  return null;
}

function explainProps(line: RunLine, runId: number, runEmployeeId: number) {
  const trace = line.trace ?? {};
  const formula = typeof trace.formula === "string" ? trace.formula : undefined;
  const refs = trace.references && typeof trace.references === "object" && !Array.isArray(trace.references) ? (trace.references as Record<string, unknown>) : {};
  const inputs: ExplainInput[] = Object.entries(refs)
    .map(([k, v]) => ({ label: k, value: primitive(v) }))
    .filter((i): i is { label: string; value: string } => i.value !== null)
    .slice(0, 12);
  if (typeof trace.units === "string") inputs.push({ label: "Units", value: trace.units });
  const sources: ExplainSource[] = (line.sources ?? []).slice(0, 8).map((s) => ({
    label: String(s.label ?? s.ref ?? s.id ?? s.type ?? "Source"),
    kind: typeof s.type === "string" ? s.type : typeof s.kind === "string" ? s.kind : undefined,
  }));
  sources.push({ label: "Open the employee in the run", href: `/payroll/runs/${runId}/employees/${runEmployeeId}` });
  const notes = Array.isArray(trace.notes) ? trace.notes.filter((n) => typeof n === "string").join(" ") : typeof trace.notes === "string" ? trace.notes : undefined;
  return { explanation: line.explanation || "No explanation was recorded for this line.", formula, inputs, sources, rounding: notes };
}

function WhyAmount({ item, explainer, runId, runEmployeeId }: { item: PayslipLineItem; explainer: Explainer; runId: number; runEmployeeId: number }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ loading: boolean; line?: RunLine | null; error?: string }>({ loading: false });
  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next || state.line !== undefined) return;
    setState({ loading: true });
    try {
      const lines = (await explainer.load()) ?? [];
      const line = lines.find((l) => l.component === item.code) ?? null;
      setState({ loading: false, line });
    } catch (e) {
      setState({ loading: false, error: errorText(e) });
    }
  };
  return (
    <>
      <button
        type="button"
        data-print-hidden
        className="ms-1 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-muted-foreground hover:text-primary sm:min-h-[28px] sm:min-w-[28px]"
        aria-expanded={open}
        aria-label={`Why this amount? ${item.label}`}
        onClick={() => void toggle()}
      >
        <HelpCircle className="h-4 w-4" aria-hidden />
      </button>
      {open && (
        <div className="mt-2" data-print-hidden>
          {state.loading ? (
            <p className="text-sm text-muted-foreground" aria-busy="true">
              Loading the calculation…
            </p>
          ) : state.error ? (
            <p className="text-sm text-danger" role="alert">
              {state.error}
            </p>
          ) : state.line ? (
            <ExplainPanel {...explainProps(state.line, runId, runEmployeeId)} defaultExpanded />
          ) : (
            <p className="text-sm text-muted-foreground">No calculation trace was found for this line.</p>
          )}
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ the semantic payslip */

function LinesTable({
  title,
  items,
  currency,
  showYtd,
  explainer,
  runId,
  runEmployeeId,
  note,
  total,
}: {
  title: string;
  items: PayslipLineItem[];
  currency: string;
  showYtd: boolean;
  explainer?: Explainer;
  runId?: number | null;
  runEmployeeId?: number | null;
  note?: ReactNode;
  total?: { label: string; amount: string };
}) {
  const hasYtd = showYtd && items.some((i) => i.ytd !== undefined);
  const hasUnits = items.some((i) => i.units);
  return (
    <section aria-label={title} className="break-inside-avoid">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">None this period.</p>
      ) : (
        <table className="mt-2 w-full text-sm">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th scope="col" className="py-1.5 text-start font-medium">
                Component
              </th>
              {hasUnits && (
                <th scope="col" className="py-1.5 text-end font-medium">
                  Units
                </th>
              )}
              <th scope="col" className="py-1.5 text-end font-medium">
                Amount
              </th>
              {hasYtd && (
                <th scope="col" className="py-1.5 text-end font-medium">
                  <abbr title="Year to date">YTD</abbr>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={`${item.code}-${index}`} className="border-b border-border/50 align-top last:border-0">
                <td className="py-1.5 pe-2">
                  <span className="font-medium">{item.label}</span>
                  {item.period_ref_label && <span className="block text-xs text-muted-foreground">For {item.period_ref_label}</span>}
                  {item.fixture && <span className="ms-2 rounded bg-warning-soft px-1.5 text-[11px] font-semibold text-warning">FIXTURE — not law</span>}
                  {explainer?.available && runId && runEmployeeId ? <WhyAmount item={item} explainer={explainer} runId={runId} runEmployeeId={runEmployeeId} /> : null}
                </td>
                {hasUnits && (
                  <td className="py-1.5 text-end tabular-nums">
                    <bdi dir="ltr">{item.units ?? "—"}</bdi>
                  </td>
                )}
                <td className="py-1.5 text-end">
                  <MoneyText amount={item.amount} currency={currency} negativeCue={false} />
                </td>
                {hasYtd && (
                  <td className="py-1.5 text-end text-muted-foreground">
                    <MoneyText amount={item.ytd ?? null} currency={currency} negativeCue={false} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          {total && (
            <tfoot>
              <tr className="border-t border-border font-semibold">
                <th scope="row" className="py-1.5 text-start" colSpan={hasUnits ? 2 : 1}>
                  {total.label}
                </th>
                <td className="py-1.5 text-end">
                  <MoneyText amount={total.amount} currency={currency} emphasis />
                </td>
                {hasYtd && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      )}
    </section>
  );
}

function Dl({ items }: { items: [string, ReactNode][] }) {
  const shown = items.filter(([, v]) => v !== null && v !== undefined && v !== "");
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
      {shown.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3 sm:block">
          <dt className="text-xs text-muted-foreground">{k}</dt>
          <dd className="font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Notices for revised, superseded and reversed payslips (3.6 §6; EC-UX-06). */
export function VersionNotices({ detail, newerHref }: { detail: PayslipDetail; newerHref?: string | null }) {
  const c = detail.content;
  return (
    <div className="space-y-2">
      {detail.status === "REVERSED" && (
        <Notice tone="danger" title="This payslip was reversed">
          Its pay run was reversed{detail.reversed_at ? ` on ${formatDateTime(detail.reversed_at)}` : ""}. It is kept for the record and is no longer valid.
        </Notice>
      )}
      {detail.status === "SUPERSEDED" && (
        <Notice tone="warning" title="A newer version of this payslip exists">
          This version was replaced by a corrected payslip{detail.superseded_at ? ` on ${formatDateTime(detail.superseded_at)}` : ""}.{" "}
          {newerHref && (
            <Link href={newerHref} className="font-medium text-primary hover:underline">
              Open the latest version
            </Link>
          )}
        </Notice>
      )}
      {c?.title_key === "REVISED_PAYSLIP" && (
        <Notice tone="info" title={`Revised payslip · version ${detail.version}`}>
          {c.replaces ? `It replaces payslip ${c.replaces}.` : "It replaces an earlier version for the same period."}
        </Notice>
      )}
      {detail.draft && <Notice tone="warning" title="Draft — not a valid payslip" />}
    </div>
  );
}

export function PayslipDocument({ detail, explainer, newerHref }: { detail: PayslipDetail; explainer?: Explainer; newerHref?: string | null }) {
  const c: PayslipContent = detail.content;
  const language = c.languages?.[0] ?? null;
  const rtl = isRtlLanguage(language);
  const sections = c.template?.sections?.length ? c.template.sections : DEFAULT_SECTIONS;
  const title = (code: string) => c.template?.titles?.[code] || SECTION_TITLES[code] || code;
  const currency = c.currency;
  const labels = [...(detail.labels ?? []), ...(c.labels ?? [])];
  const hours = formatDecimalHours(c.attendance?.overtime_hours ?? null);

  const render = (code: string): ReactNode => {
    switch (code) {
      case "HEADER":
        return (
          <header key={code} className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
            <div className="min-w-0">
              <p className="font-display text-lg font-semibold">{c.employer.trade_name || c.employer.legal_name}</p>
              {c.employer.trade_name && <p className="text-sm text-muted-foreground">{c.employer.legal_name}</p>}
              {c.employer.address_line && <p className="text-sm text-muted-foreground">{c.employer.address_line}</p>}
              {c.employer.registration_lines?.length > 0 && (
                <ul className="mt-1 text-xs text-muted-foreground">
                  {c.employer.registration_lines.map((r) => (
                    <li key={`${r.label}-${r.value}`}>
                      {r.label}: <bdi dir="ltr">{r.value}</bdi>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="text-end">
              <h2 className="font-display text-xl font-semibold">{c.title_key === "REVISED_PAYSLIP" ? "Revised payslip" : "Payslip"}</h2>
              <p className="text-sm">{c.period.label}</p>
              <p className="text-xs text-muted-foreground">
                {formatDate(c.period.start)} – {formatDate(c.period.end)} · Pay date {formatDate(c.period.pay_date)}
              </p>
              {detail.number && (
                <p className="text-xs text-muted-foreground">
                  No. <bdi dir="ltr">{detail.number}</bdi>
                  {detail.version > 1 ? ` · version ${detail.version}` : ""}
                </p>
              )}
            </div>
          </header>
        );
      case "EMPLOYEE":
        return (
          <section key={code} aria-label={title(code)}>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title(code)}</h3>
            <Dl
              items={[
                ["Name", c.employee.name],
                ["Employee code", c.employee.code ? <bdi dir="ltr">{c.employee.code}</bdi> : null],
                ["Designation", c.employee.designation],
                ["Department", c.employee.department],
                ["Branch", c.employee.branch],
                ["Pay group", c.employee.pay_group],
                ["Joining date", c.employee.joining_date ? formatDate(c.employee.joining_date) : null],
                ["Bank account", c.employee.bank ? <bdi dir="ltr">{c.employee.bank}</bdi> : null],
              ]}
            />
          </section>
        );
      case "ATTENDANCE_SUMMARY":
        return (
          <section key={code} aria-label={title(code)}>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title(code)}</h3>
            {c.attendance ? (
              <Dl
                items={[
                  ["Days in period", formatDays(c.attendance.days_in_period)],
                  ["Paid days", formatDays(c.attendance.paid_days)],
                  [/* LOP has a glossary */ "Loss of pay (LOP)", formatDays(c.attendance.lop_days)],
                  ["Leave", formatDays(c.attendance.leave_days)],
                  ["Overtime", <span key="ot" title={hours.title}>{hours.text}</span>],
                ]}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Not available.</p>
            )}
          </section>
        );
      case "EARNINGS":
        return <LinesTable key={code} title={title(code)} items={c.earnings ?? []} currency={currency} showYtd={c.show_ytd} explainer={explainer} runId={detail.run_id} runEmployeeId={detail.run_employee_id} total={{ label: "Gross earnings", amount: c.totals.gross }} />;
      case "DEDUCTIONS":
        return <LinesTable key={code} title={title(code)} items={c.deductions ?? []} currency={currency} showYtd={c.show_ytd} explainer={explainer} runId={detail.run_id} runEmployeeId={detail.run_employee_id} total={{ label: "Total deductions", amount: c.totals.deductions }} />;
      case "REIMBURSEMENTS":
        if (!c.reimbursements?.length) return null;
        return <LinesTable key={code} title={title(code)} items={c.reimbursements} currency={currency} showYtd={false} explainer={explainer} runId={detail.run_id} runEmployeeId={detail.run_employee_id} total={{ label: "Total reimbursements", amount: c.totals.reimbursements }} />;
      case "EMPLOYER_CONTRIBUTIONS":
        if (!c.employer_contributions?.length) return null;
        return <LinesTable key={code} title={title(code)} note={c.employer_note} items={c.employer_contributions} currency={currency} showYtd={false} explainer={explainer} runId={detail.run_id} runEmployeeId={detail.run_employee_id} />;
      case "TOTALS":
        return (
          <section key={code} aria-label="Net pay" className="rounded-2xl border border-border bg-surface-muted/60 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Net pay</h3>
              <MoneyText amount={c.totals.net} currency={currency} emphasis className="text-2xl" />
            </div>
            {c.totals.net_words && <p className="mt-1 text-sm text-muted-foreground">{c.totals.net_words}</p>}
            <p className="mt-2 text-xs text-muted-foreground">
              Gross <MoneyText amount={c.totals.gross} currency={currency} /> · Deductions <MoneyText amount={c.totals.deductions} currency={currency} />
              {c.totals.reimbursements && !/^[-+]?0*(\.0*)?$/.test(c.totals.reimbursements) && (
                <>
                  {" "}
                  · Reimbursements <MoneyText amount={c.totals.reimbursements} currency={currency} />
                </>
              )}
            </p>
          </section>
        );
      case "PAYMENT":
        return (
          <section key={code} aria-label={title(code)}>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title(code)}</h3>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <StatusChip vocabulary="employee_payment" code={c.payment?.key} />
              <span>{c.payment?.text}</span>
              {c.payment?.reference && (
                <span className="text-muted-foreground">
                  Ref <bdi dir="ltr">{c.payment.reference}</bdi>
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">From payment evidence when this payslip was issued ({formatDate(detail.issue_date)}).</p>
          </section>
        );
      case "LEAVE_BALANCES":
        if (!c.leave_balances?.length) return null;
        return (
          <section key={code} aria-label={title(code)}>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title(code)}</h3>
            <table className="w-full text-sm">
              <caption className="sr-only">{title(code)}</caption>
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th scope="col" className="py-1.5 text-start font-medium">Leave</th>
                  <th scope="col" className="py-1.5 text-end font-medium">Used</th>
                  <th scope="col" className="py-1.5 text-end font-medium">Remaining</th>
                </tr>
              </thead>
              <tbody>
                {c.leave_balances.map((l) => (
                  <tr key={l.code} className="border-b border-border/50 last:border-0">
                    <td className="py-1.5">{l.name}</td>
                    <td className="py-1.5 text-end tabular-nums">{formatDays(l.used)}</td>
                    <td className="py-1.5 text-end tabular-nums">{l.remaining === null ? "—" : formatDays(l.remaining)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      case "TAX_SUMMARY":
        return null;
      case "FOOTER":
        return (
          <footer key={code} className="border-t border-border pt-3 text-xs text-muted-foreground">
            {c.template?.footer_note && <p>{c.template.footer_note}</p>}
            {c.template?.signature && (c.template.signature.name || c.template.signature.title) && (
              <p className="mt-2">
                {c.template.signature.name}
                {c.template.signature.title ? ` · ${c.template.signature.title}` : ""}
              </p>
            )}
            <p className="mt-1">
              Issued {formatDate(detail.issue_date)} · Run <bdi dir="ltr">{c.run?.number}</bdi>
            </p>
          </footer>
        );
      default:
        return null;
    }
  };

  return (
    <article
      data-payslip-print
      dir={rtl ? "rtl" : "ltr"}
      lang={language ?? undefined}
      aria-label={`Payslip ${c.period.label} for ${c.employee.name}`}
      className="space-y-5 rounded-2xl border border-border bg-surface p-4 sm:p-6"
    >
      <style>{PRINT_CSS}</style>
      <HonestLabels labels={labels} />
      <VersionNotices detail={detail} newerHref={newerHref} />
      {sections.map(render)}
    </article>
  );
}

/* ------------------------------------------------------------------ actions */

function useNewerVersion(detail: PayslipDetail | undefined): string | null {
  const enabled = !!detail && detail.status === "SUPERSEDED" && !!detail.employee_id;
  const { data } = useApi(
    () =>
      payslipsApi.list({
        employee_id: detail?.employee_id,
        run_id: undefined,
        period_from: detail?.period_start,
        period_to: detail?.period_end,
        latest_only: true,
        limit: 10,
      }),
    [detail?.id, detail?.status],
    { enabled },
  );
  const newer = data?.items.find((d) => d.id !== detail?.id && d.period_start === detail?.period_start && d.version > (detail?.version ?? 0));
  return newer ? `/payroll/payslips/${newer.id}` : null;
}

function PayslipActions({ detail, onChanged, compact }: { detail: PayslipDetail; onChanged?: () => void; compact?: boolean }) {
  const { me } = useCan();
  const [busy, setBusy] = useState<string | null>(null);
  const canPublish = can(me, P.PAYROLL_PAYSLIP_PUBLISH);
  const download = async () => {
    setBusy("download");
    try {
      openSignedLink(await payslipsApi.downloadLink(detail.id));
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const resend = async () => {
    setBusy("resend");
    try {
      await payslipsApi.resend(detail.id);
      toast.success("Notification queued. The employee gets one e-mail for this version.");
      onChanged?.();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2" data-print-hidden>
      <Button variant="primary" className="min-h-[44px]" loading={busy === "download"} onClick={() => void download()}>
        <Download className="h-4 w-4" aria-hidden /> Download PDF
      </Button>
      <Button variant="secondary" className="min-h-[44px]" onClick={() => window.print()}>
        <Printer className="h-4 w-4" aria-hidden /> Print
      </Button>
      {canPublish && PUBLISHED_STATES.includes(detail.status) && (
        <Button variant="ghost" className="min-h-[44px]" loading={busy === "resend"} onClick={() => void resend()}>
          <Send className="h-4 w-4" aria-hidden /> {compact ? "Resend" : "Resend notification"}
        </Button>
      )}
    </div>
  );
}

function MetaLine({ detail }: { detail: PayslipDetail }) {
  return (
    <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" data-print-hidden>
      <StatusChip vocabulary="document" code={detail.status} />
      {detail.published_at && <span>Published {formatDateTime(detail.published_at)}</span>}
      {detail.publish_trigger === "MANUAL" && detail.publish_reason && <span>· Manual: “{detail.publish_reason}”</span>}
      {detail.first_viewed_at && <span>· First viewed {formatDateTime(detail.first_viewed_at)}</span>}
    </span>
  );
}

/* ------------------------------------------------------------------ modal and page */

/** Payslip viewer (3.8 §6): `xl` modal, deep link `?modal=payslip&id=`, "Open full page ↗", download, print. */
export function PayslipViewerModal({ route, onChanged }: { route: ModalRoute; onChanged?: () => void }) {
  const id = route.open ? route.id : null;
  const { data, error, loading, reload } = useApi(() => payslipsApi.get(id as string), [id], { enabled: !!id });
  const detail = data && String(data.id) === id ? data : undefined;
  const explainer = useExplainer(detail);
  const newer = useNewerVersion(detail);
  return (
    <Modal
      open={route.open}
      onOpenChange={route.onOpenChange}
      size="xl"
      title={detail ? `${detail.employee?.name ?? detail.content.employee.name} · ${detail.period_label ?? detail.content.period.label}` : "Payslip"}
      description={
        id ? (
          <Link href={`/payroll/payslips/${id}`} className="inline-flex min-h-[44px] items-center gap-1 font-medium text-primary hover:underline sm:min-h-0">
            Open full page <ExternalLink className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
          </Link>
        ) : undefined
      }
      footer={detail ? <PayslipActions detail={detail} onChanged={() => { void reload(); onChanged?.(); }} compact /> : undefined}
    >
      <DetailGate loading={loading} error={error} hasData={!!detail} onRetry={() => void reload()} what="Payslip" backHref="/payroll/payslips" backLabel="Back to payslips">
        {detail && (
          <div className="space-y-4">
            <MetaLine detail={detail} />
            <PayslipDocument detail={detail} explainer={explainer} newerHref={newer} />
          </div>
        )}
      </DetailGate>
    </Modal>
  );
}

/** Full page of the payslip viewer (`/payroll/payslips/[id]`). */
export function PayslipFullPage({ id }: { id: string }) {
  const { data, error, loading, reload } = useApi(() => payslipsApi.get(id), [id], { enabled: !!id });
  const explainer = useExplainer(data);
  const newer = useNewerVersion(data);
  const title = useMemo(() => (data ? `${data.employee?.name ?? data.content.employee.name} · ${data.period_label ?? data.content.period.label}` : "Payslip"), [data]);
  return (
    <div className="space-y-5">
      <div data-print-hidden>
        <Link href="/payroll/payslips" className="inline-flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden /> Payslips
        </Link>
      </div>
      <DetailGate loading={loading} error={error} hasData={!!data} onRetry={() => void reload()} what="Payslip" backHref="/payroll/payslips" backLabel="Back to payslips">
        {data && (
          <>
            <div data-print-hidden>
              <WorkspaceHeader eyebrow="Payslip" title={title} description={<MetaLine detail={data} />} actions={<PayslipActions detail={data} onChanged={() => void reload()} />} />
            </div>
            <Card className="p-0">
              <PayslipDocument detail={data} explainer={explainer} newerHref={newer} />
            </Card>
          </>
        )}
      </DetailGate>
    </div>
  );
}
