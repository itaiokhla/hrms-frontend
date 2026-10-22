"use client";

import { AlertTriangle, BadgeCheck, FlaskConical, ShieldQuestion } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import toast from "react-hot-toast";

import { CurrencyBadge } from "@/components/payroll/CurrencyBadge";
import { MoneyText } from "@/components/payroll/MoneyText";
import { useModalRoute } from "@/components/payroll/useModalRoute";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { ErrorState } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Card, Skeleton } from "@/components/ui/primitives";
import { can } from "@/lib/access";
import { errorMessage } from "@/lib/api";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { needsIsoCodes } from "@/lib/money";
import { P } from "@/lib/permissions.generated";

import { runsApi } from "./api";
import { useRun } from "./context";
import { CurrencyNote, EXCLUSION_LABELS, Notice, humanize } from "./shared";
import type { Attestation, RunSummary } from "./types";

export const FIXTURE_LABEL = "FIXTURE — not law";
export const NOT_VERIFIED_LABEL = "Compliance not verified";

const FIGURES: { key: "gross" | "deductions" | "reimbursements" | "net" | "employer_cost"; label: string }[] = [
  { key: "gross", label: "Gross" },
  { key: "deductions", label: "Deductions" },
  { key: "reimbursements", label: "Reimbursements" },
  { key: "net", label: "Net" },
  { key: "employer_cost", label: "Employer cost" },
];

/** "FIXTURE — not law" and "Compliance not verified" exactly where the API says so. */
export function PackBadges({ labels, className }: { labels: string[]; className?: string }) {
  if (!labels.length) return null;
  return (
    <span className={className}>
      {labels.map((label) => (
        <span
          key={label}
          className={
            label === FIXTURE_LABEL
              ? "me-1.5 inline-flex items-center gap-1 rounded-full bg-danger-soft px-2.5 py-0.5 text-xs font-semibold text-danger"
              : "me-1.5 inline-flex items-center gap-1 rounded-full bg-warning-soft px-2.5 py-0.5 text-xs font-semibold text-warning"
          }
        >
          {label === FIXTURE_LABEL ? <FlaskConical className="h-3.5 w-3.5" aria-hidden /> : <ShieldQuestion className="h-3.5 w-3.5" aria-hidden />}
          {label}
        </span>
      ))}
    </span>
  );
}

/** Run › Summary (3.8 §5.3). */
export function SummaryTab({ onShowExcluded }: { onShowExcluded: () => void }) {
  const { run, version } = useRun();
  const { data, error, reload } = useApi(() => runsApi.summary(run.id), [run.id, version]);
  if (error) return <ErrorState message={error.message} onRetry={reload} />;
  if (!data) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <Totals data={data} />
      <Population data={data} onShowExcluded={onShowExcluded} />
      <div className="grid gap-5 lg:grid-cols-2">
        <PackCard data={data} />
        <FxCard data={data} />
      </div>
      <Liabilities data={data} />
      <SettingsCard settings={data.settings} />
    </div>
  );
}

function Section({ title, children, action }: { title: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </Card>
  );
}

function Totals({ data }: { data: RunSummary }) {
  const currencies = Object.keys(data.totals).sort();
  const useCode = needsIsoCodes(currencies);
  return (
    <Section title="Totals">
      {currencies.length === 0 ? (
        <p className="text-sm text-muted-foreground">No calculated employees yet. Totals appear once the calculation has run.</p>
      ) : (
        <>
          <CurrencyNote currencies={currencies} />
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Totals per currency</caption>
              <thead>
                <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="py-2 text-start font-medium">
                    Figure
                  </th>
                  {currencies.map((c) => (
                    <th key={c} scope="col" className="py-2 text-end font-medium">
                      <CurrencyBadge code={c} /> <span className="ms-1 normal-case">({data.totals[c].employees ?? 0} employees)</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {FIGURES.map((f) => (
                  <tr key={f.key} className="border-t border-border/60">
                    <th scope="row" className="py-2 text-start font-medium">
                      {f.label}
                    </th>
                    {currencies.map((c) => (
                      <td key={c} className="py-2 text-end">
                        <MoneyText amount={data.totals[c][f.key] ?? null} currency={c} useCode={useCode} emphasis={f.key === "net"} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Section>
  );
}

function Population({ data, onShowExcluded }: { data: RunSummary; onShowExcluded: () => void }) {
  const p = data.population;
  const reasons = Object.entries(p.excluded_by_reason ?? {});
  return (
    <Section
      title="Population"
      action={
        p.excluded > 0 ? (
          <Button variant="ghost" size="sm" className="min-h-[44px]" onClick={onShowExcluded}>
            View excluded
          </Button>
        ) : null
      }
    >
      <p className="text-sm">
        Eligible <strong className="tabular-nums">{p.eligible}</strong> = included <strong className="tabular-nums">{p.included}</strong> + excluded{" "}
        <strong className="tabular-nums">{p.excluded}</strong>
        {reasons.length > 0 && <span className="text-muted-foreground"> ({reasons.map(([code, n]) => `${EXCLUSION_LABELS[code] ?? humanize(code)} × ${n}`).join(", ")})</span>}
      </p>
      {!data.reconciles && (
        <p role="alert" className="mt-2 flex items-center gap-1.5 text-sm text-danger">
          <AlertTriangle className="h-4 w-4" aria-hidden /> The population does not reconcile. Run the pre-checks again before going further.
        </p>
      )}
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {[
          ["Calculated", p.calculated],
          ["Errors", p.errors],
          ["Pending", p.pending],
          ["On hold", p.on_hold],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-xl bg-surface-muted/60 px-3 py-2">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="font-semibold tabular-nums">{value ?? 0}</dd>
          </div>
        ))}
      </dl>
      {data.calculation.calculated_at && (
        <p className="mt-3 text-xs text-muted-foreground">
          Calculated {fmtDateTime(data.calculation.calculated_at)} · engine {data.calculation.engine_version ?? "—"}
        </p>
      )}
    </Section>
  );
}

function PackCard({ data }: { data: RunSummary }) {
  const { me, run } = useRun();
  const pack = data.pack;
  const attestationRoute = useModalRoute("attestation", { keys: ["id"] });
  const attestations = useApi(() => runsApi.attestations(run.legal_entity_id), [run.legal_entity_id, attestationRoute.open], { enabled: !pack.verified });
  const pending = (attestations.data?.items ?? []).find((a) => a.status === "PENDING");
  const active = (attestations.data?.items ?? []).find((a) => a.status === "ACTIVE");
  const canCreate = can(me, P.PAYROLL_STATUTORY_REVIEW);
  const canApprove = can(me, P.PAYROLL_STATUTORY_SUBMIT) || !!me?.is_company_admin;
  return (
    <Section title="Country pack and compliance">
      <div className="space-y-2 text-sm">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{pack.country}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{humanize(pack.capability)}</span>
          {pack.verified && (
            <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-semibold text-success">
              <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> Verified pack
            </span>
          )}
        </p>
        <PackBadges labels={pack.labels} />
        {pack.versions.length > 0 && (
          <ul className="text-xs text-muted-foreground">
            {pack.versions.map((v, i) => (
              <li key={i}>
                {String(v.code ?? v.pack ?? "Pack")} {String(v.version ?? "")}
                {v.label ? ` · ${v.label}` : ""}
              </li>
            ))}
          </ul>
        )}
        {!pack.country_confirmed && <Notice tone="warning" title="The legal entity's country is not confirmed">Confirm it in Settings › Organization before finalizing.</Notice>}
        {!pack.verified && (
          <div className="rounded-xl border border-border p-3">
            <p className="font-medium">Statutory attestation</p>
            {attestations.loading && !attestations.data ? (
              <Skeleton className="mt-2 h-5 w-48" />
            ) : active || pack.attestation_id ? (
              <p className="mt-1 text-success">Approved: statutory obligations of this entity are handled outside this system.</p>
            ) : pending ? (
              <>
                <p className="mt-1 text-muted-foreground">Waiting for a second person to approve (from {fmtDate(pending.effective_from)}).</p>
                {canApprove && pending.attested_by_user_id !== me?.user.id && (
                  <Button className="mt-2" size="sm" onClick={() => attestationRoute.openModal({ id: pending.id })}>
                    Review attestation
                  </Button>
                )}
              </>
            ) : (
              <>
                <p className="mt-1 text-muted-foreground">No verified pack covers this period. Finalizing needs an approved attestation that statutory items are handled outside this system.</p>
                {canCreate && (
                  <Button className="mt-2" size="sm" onClick={() => attestationRoute.openModal({ id: null })}>
                    Create attestation
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </div>
      <AttestationModal
        open={attestationRoute.open}
        attestation={attestationRoute.id ? (attestations.data?.items ?? []).find((a) => String(a.id) === attestationRoute.id) ?? null : null}
        periodStart={run.period?.start ?? ""}
        onOpenChange={attestationRoute.onOpenChange}
        onDone={() => {
          void attestationRoute.close();
          attestations.reload();
        }}
      />
    </Section>
  );
}

/** Create (maker) or approve (checker) a statutory attestation (I-15) for an entity without a verified pack. */
function AttestationModal({ open, attestation, periodStart, onOpenChange, onDone }: { open: boolean; attestation: Attestation | null; periodStart: string; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const { run } = useRun();
  const [from, setFrom] = useState(periodStart);
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) {
      setFrom(periodStart);
      setReason("");
      setEvidence("");
      setTouched(false);
      setError(null);
    }
  }, [open, periodStart]);
  const approving = !!attestation;
  const missing = !approving && (!reason.trim() || !from);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (missing || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (attestation) {
        await runsApi.approveAttestation(attestation.id, attestation.row_version);
        toast.success("Attestation approved — the run can be finalized once nothing else blocks it");
      } else {
        await runsApi.createAttestation({ legal_entity_id: run.legal_entity_id, effective_from: from, reason: reason.trim(), schemes: [], evidence_ref: evidence.trim() || null });
        toast.success("Attestation created — another person must approve it");
      }
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
      title={approving ? "Approve statutory attestation" : "Create statutory attestation"}
      size="md"
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="attestation-form" loading={busy}>
            {approving ? "Approve" : "Create"}
          </Button>
        </>
      }
    >
      <form id="attestation-form" onSubmit={submit} className="space-y-4" noValidate>
        <Notice tone="warning" title="What you attest">
          Statutory obligations of this legal entity (tax, social security, filings) are handled outside this system for the dates covered. Payslips and reports show
          &ldquo;{NOT_VERIFIED_LABEL}&rdquo;.
        </Notice>
        {error && (
          <Notice tone="danger" title="That didn't work">
            {error}
          </Notice>
        )}
        {approving && attestation ? (
          <dl className="space-y-1 text-sm">
            <div>
              <dt className="text-muted-foreground">From</dt>
              <dd>{fmtDate(attestation.effective_from)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Reason</dt>
              <dd>{attestation.reason}</dd>
            </div>
            {attestation.evidence_ref && (
              <div>
                <dt className="text-muted-foreground">Evidence</dt>
                <dd>{attestation.evidence_ref}</dd>
              </div>
            )}
          </dl>
        ) : (
          <>
            <Field label="Effective from" required error={touched && !from ? "Choose a date." : undefined}>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="Reason" required error={touched && !reason.trim() ? "Give a reason." : undefined}>
              <Textarea rows={3} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <Field label="Evidence reference" hint="Optional: for example the payroll provider's contract number.">
              <Input value={evidence} maxLength={300} onChange={(e) => setEvidence(e.target.value)} />
            </Field>
          </>
        )}
      </form>
    </Modal>
  );
}

function FxCard({ data }: { data: RunSummary }) {
  return (
    <Section title="FX snapshot">
      {!data.fx ? (
        <p className="text-sm text-muted-foreground">No currency conversion in this run.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {data.fx.rates.map((r) => (
            <li key={`${r.base}-${r.quote}`} className="flex flex-wrap justify-between gap-2">
              <bdi dir="ltr">
                1 {r.base} = {r.rate} {r.quote}
              </bdi>
              <span className="text-xs text-muted-foreground">
                {r.source}
                {r.as_of ? ` · ${fmtDate(r.as_of)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Liabilities({ data }: { data: RunSummary }) {
  if (!data.liabilities.length) return null;
  return (
    <Section title="Liabilities">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Statutory liabilities</caption>
          <thead>
            <tr className="text-xs uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="py-2 text-start font-medium">
                Scheme
              </th>
              <th scope="col" className="py-2 text-start font-medium">
                Payee
              </th>
              <th scope="col" className="py-2 text-end font-medium">
                Employee
              </th>
              <th scope="col" className="py-2 text-end font-medium">
                Employer
              </th>
              <th scope="col" className="py-2 text-end font-medium">
                Due
              </th>
            </tr>
          </thead>
          <tbody>
            {data.liabilities.map((l) => (
              <tr key={`${l.scheme}-${l.payee_authority}-${l.currency}`} className="border-t border-border/60">
                <td className="py-2">
                  {l.scheme}
                  {l.fixture && <PackBadges labels={[l.label ?? FIXTURE_LABEL]} className="ms-2" />}
                </td>
                <td className="py-2 text-muted-foreground">{l.payee_authority}</td>
                <td className="py-2 text-end">
                  <MoneyText amount={l.employee_amount} currency={l.currency} />
                </td>
                <td className="py-2 text-end">
                  <MoneyText amount={l.employer_amount} currency={l.currency} />
                </td>
                <td className="py-2 text-end text-xs">{l.due_date ? fmtDate(l.due_date) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function SettingsCard({ settings }: { settings: Record<string, unknown> }) {
  const entries = Object.entries(settings ?? {});
  if (!entries.length) return null;
  return (
    <Section title="Run settings (frozen at lock)">
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {entries.map(([key, value]) => (
          <div key={key} className="flex flex-wrap justify-between gap-2 border-b border-border/40 py-1">
            <dt className="font-mono text-xs text-muted-foreground">{key}</dt>
            <dd className="text-end">{value === "VARIES" ? "Varies by employee" : typeof value === "object" ? JSON.stringify(value) : String(value)}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}
