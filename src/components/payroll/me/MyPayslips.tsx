"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, Download, ExternalLink, FileText, KeyRound, Printer, ScrollText } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { MoneyText } from "@/components/payroll/MoneyText";
import { StatusChip } from "@/components/payroll/StatusChip";
import { useModalRoute } from "@/components/payroll/useModalRoute";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Card, Skeleton } from "@/components/ui/primitives";
import { ApiError } from "@/lib/api";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { isStepUpRequired } from "@/lib/payroll/api";
import { P } from "@/lib/permissions.generated";

import { downloadDocument, meApi } from "./api";
import { PayslipDocument } from "./PayslipDocument";
import { MyQuestions, PayslipQuestionsPanel } from "./PayslipQuestions";
import { passwordApplies, questionsEnabled, usePayrollPreferences } from "./preferences";
import { canSelf, DetailGate, ErrorSummary, fieldErrors, isCurrentPayslip, MeChip, MeHeader, Notice, payslipMarkers, periodRange } from "./shared";
import type { DocumentRequestDto, MyPayslip, MyPayslipDetail, PayDocumentDto, PayrollPreferences } from "./types";

const YEARS_BACK = 6;
const DOC_TYPE_LABEL: Record<string, string> = {
  PAYMENT_ADVICE: "Payment advice",
  FINAL_SETTLEMENT_STATEMENT: "Final settlement statement",
  SALARY_CERTIFICATE: "Salary certificate",
  EMPLOYMENT_LETTER: "Employment letter",
  INCREMENT_LETTER: "Increment letter",
  LOAN_STATEMENT: "Loan statement",
  REIMBURSEMENT_STATEMENT: "Reimbursement statement",
  REVERSAL_STATEMENT: "Reversal statement",
  INVOICE: "Invoice",
  SELF_BILLED_INVOICE: "Self-billed invoice",
  CREDIT_NOTE: "Credit note",
};

export function docTypeLabel(code: string): string {
  return DOC_TYPE_LABEL[code] ?? code.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

/** Save a payslip PDF through its signed link; toasts never carry amounts. */
export async function downloadPayslip(p: Pick<MyPayslip, "id" | "file_name">) {
  try {
    await downloadDocument(() => meApi.payslipLink(p.id), p.file_name || `payslip-${p.id}.pdf`);
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "The payslip couldn't be downloaded. Try again.");
  }
}

/* ------------------------------------------------------------------ list page */

/**
 * My Payslips (3.8 §5.18): list by period with New / Viewed / Revised, viewer modal, full page, the PDF
 * password (only when the employer protects PDFs with it) and payslip questions (only when enabled).
 */
export function MyPayslips() {
  const reduceMotion = useReducedMotion();
  const preferences = usePayrollPreferences();
  const canAsk = questionsEnabled(preferences.prefs);
  const showPassword = passwordApplies(preferences);
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState<number | null>(null);
  const viewer = useModalRoute("payslip");
  const password = useModalRoute("payslip-password", { keys: [] });
  const { data, error, loading, reload } = useApi(() => meApi.payslips({ year, limit: 120 }), [year]);
  const items = data?.items;

  return (
    <div>
      <MeHeader
        title="My Payslips"
        description="Every published payslip, newest first. Open one to see the breakdown or download the PDF."
        actions={
          showPassword && (
            <Button variant="secondary" className="min-h-[44px]" onClick={() => password.openModal()}>
              <KeyRound className="h-4 w-4" aria-hidden /> Set document password
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Year" className="w-40">
          <Select value={year ?? ""} onChange={(e) => setYear(e.target.value ? Number(e.target.value) : null)} className="min-h-[44px]">
            <option value="">All years</option>
            {Array.from({ length: YEARS_BACK }, (_, i) => thisYear - i).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {error && !items ? (
        <Card>
          <ErrorState message={error.message} onRetry={reload} />
        </Card>
      ) : loading && !items ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading payslips">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-36 rounded-2xl" />
          ))}
        </div>
      ) : !items?.length ? (
        <Card>
          <EmptyState
            icon={<FileText />}
            title={year ? `No payslips for ${year}` : "No payslips yet"}
            description="Your payslip appears here as soon as your employer publishes it after the pay run is finalized."
            action={
              <Link href="/me/bank-accounts" className="inline-flex min-h-[44px] items-center rounded-xl border border-border px-4 text-sm font-medium hover:bg-surface-muted">
                Check your bank account
              </Link>
            }
          />
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Payslips">
          {items.map((p, i) => (
            <motion.li
              key={p.id}
              initial={reduceMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 12) * 0.04, duration: 0.3 }}
            >
              <PayslipCard payslip={p} onOpen={() => viewer.openModal({ id: p.id })} />
            </motion.li>
          ))}
        </ul>
      )}

      <MyQuestions enabled={canAsk} />

      <OtherDocuments />

      <PayslipViewerModal id={viewer.id} open={viewer.open} onOpenChange={viewer.onOpenChange} onViewed={reload} canAsk={canAsk} />
      <PayslipPasswordModal open={password.open} onOpenChange={password.onOpenChange} prefs={preferences.prefs} />
    </div>
  );
}

function PayslipCard({ payslip: p, onOpen }: { payslip: MyPayslip; onOpen: () => void }) {
  const markers = payslipMarkers(p);
  const current = isCurrentPayslip(p);
  return (
    <Card className="flex h-full flex-col p-5">
      <button type="button" onClick={onOpen} className="group -m-2 flex-1 rounded-xl p-2 text-start hover:bg-surface-muted" aria-label={`Open payslip ${p.period_label ?? p.title}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium">{p.period_label ?? p.title}</p>
          <div className="flex flex-wrap gap-1.5">
            {markers.map((m) => (
              <MeChip key={m} vocabulary="payslip_marker" code={m} />
            ))}
            {!current && <StatusChip vocabulary="document" code={p.status} />}
          </div>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{periodRange(p.period_start, p.period_end)}</p>
        <p className="mt-3 text-2xl font-semibold">{p.net ? <MoneyText money={p.net} /> : <span className="text-base text-muted-foreground">Open to see the amount</span>}</p>
        {p.payment && <p className="mt-1 text-sm text-muted-foreground">{p.payment}</p>}
      </button>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" className="min-h-[44px]" onClick={() => void downloadPayslip(p)}>
          <Download className="h-4 w-4" aria-hidden /> PDF
        </Button>
        <Link href={`/me/payslips/${p.id}`} className="inline-flex min-h-[44px] items-center gap-1 rounded-xl px-3 text-sm font-medium text-muted-foreground hover:bg-surface-muted hover:text-foreground">
          Full page <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ viewer modal + full page */

/** Payslip viewer (3.8 §6): `xl`, deep link `?modal=payslip&id=`, "Open full page ↗", download, print. */
export function PayslipViewerModal({
  id,
  open,
  onOpenChange,
  onViewed,
  canAsk = false,
}: {
  id: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onViewed?: () => void;
  /** payslip.queries_enabled resolved true for the employee (GET /me/payroll/preferences). */
  canAsk?: boolean;
}) {
  const { data, error, loading, reload } = useApi(() => meApi.payslip(id ?? ""), [id], { enabled: open && !!id });
  // The first open records "Viewed" on the server; refresh the list once so its chip follows.
  useEffect(() => {
    if (data && onViewed) onViewed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.id]);
  const shown = data && String(data.id) === id ? data : undefined;
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title={shown?.period_label ? `Payslip · ${shown.period_label}` : "Payslip"}
      description={shown ? <PayslipMeta payslip={shown} /> : undefined}
      footer={
        shown && (
          <>
            <Link href={`/me/payslips/${shown.id}`} className="me-auto inline-flex min-h-[44px] items-center gap-1 rounded-xl px-3 text-sm font-medium hover:bg-surface-muted">
              Open full page <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </Link>
            <Button variant="ghost" className="min-h-[44px]" onClick={() => window.print()}>
              <Printer className="h-4 w-4" aria-hidden /> Print
            </Button>
            <Button className="min-h-[44px]" onClick={() => void downloadPayslip(shown)}>
              <Download className="h-4 w-4" aria-hidden /> Download PDF
            </Button>
          </>
        )
      }
    >
      <DetailGate loading={loading} error={error} hasData={!!shown} onRetry={reload} what="Payslip" backHref="/me/payslips" backLabel="Back to My Payslips">
        {shown && (
          <div className="space-y-5">
            {shown.content ? <PayslipDocument content={shown.content} compact /> : <NoContent />}
            <PayslipQuestionsPanel documentId={shown.id} canAsk={canAsk && isCurrentPayslip(shown)} />
          </div>
        )}
      </DetailGate>
    </Modal>
  );
}

function NoContent() {
  return <Notice tone="info" title="This document has no web view">Download the PDF to read it.</Notice>;
}

function PayslipMeta({ payslip }: { payslip: MyPayslipDetail }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      {payslip.number && <bdi dir="ltr">{payslip.number}</bdi>}
      {payslipMarkers(payslip)
        .filter((m) => m === "REVISED")
        .map((m) => (
          <MeChip key={m} vocabulary="payslip_marker" code={m} />
        ))}
      {!isCurrentPayslip(payslip) && <StatusChip vocabulary="document" code={payslip.status} />}
    </span>
  );
}

/** Full page of one payslip (D-12 parity with the viewer modal). */
export function MyPayslipPage({ id }: { id: string }) {
  const { data, error, loading, reload } = useApi(() => meApi.payslip(id), [id]);
  const { prefs } = usePayrollPreferences();
  return (
    <DetailGate loading={loading} error={error} hasData={!!data} onRetry={reload} what="Payslip" backHref="/me/payslips" backLabel="Back to My Payslips">
      {data && (
        <div>
          <Link href="/me/payslips" className="mb-3 inline-flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden /> My Payslips
          </Link>
          <MeHeader
            title={data.period_label ? `Payslip · ${data.period_label}` : data.title}
            description={<PayslipMeta payslip={data} />}
            actions={
              <>
                <Button variant="ghost" className="min-h-[44px]" onClick={() => window.print()}>
                  <Printer className="h-4 w-4" aria-hidden /> Print
                </Button>
                <Button className="min-h-[44px]" onClick={() => void downloadPayslip(data)}>
                  <Download className="h-4 w-4" aria-hidden /> Download PDF
                </Button>
              </>
            }
          />
          {!isCurrentPayslip(data) && (
            <Notice tone="warning" title={data.status === "SUPERSEDED" ? "A revised payslip replaces this one" : "This payslip was reversed"} className="mb-4">
              Keep it for your records; the latest payslip for this period is the one that counts.
            </Notice>
          )}
          <Card className="p-5">{data.content ? <PayslipDocument content={data.content} /> : <NoContent />}</Card>
          <div className="mt-5">
            <PayslipQuestionsPanel documentId={data.id} canAsk={questionsEnabled(prefs) && isCurrentPayslip(data)} />
          </div>
        </div>
      )}
    </DetailGate>
  );
}

/* ------------------------------------------------------------------ document password */

/**
 * "Set document password" (EC-DOC-15): set or reset after step-up; never shown again, HR never sees it.
 * The copy follows `payslip.pdf_protection` from the preferences: in force (EMPLOYEE_SECRET), not in use
 * (NONE; still reachable by a deep link), or unknown when the preferences couldn't be read.
 */
export function PayslipPasswordModal({ open, onOpenChange, prefs }: { open: boolean; onOpenChange: (o: boolean) => void; prefs?: PayrollPreferences }) {
  const status = useApi(() => meApi.passwordStatus(), [open], { enabled: open });
  const [password, setPassword] = useState("");
  const [confirmValue, setConfirmValue] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setPassword("");
      setConfirmValue("");
      setErrors({});
      setError(null);
    }
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (password.length < 8 || password.length > 40) next.password = "Use 8 to 40 characters.";
    else if (password.trim() !== password) next.password = "Don't start or end with a space.";
    if (confirmValue !== password) next.confirm = "The passwords don't match.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    setError(null);
    try {
      await meApi.setPassword(password);
      toast.success("Document password saved. Use it to open payslip PDFs sent by e-mail.");
      onOpenChange(false);
    } catch (err) {
      if (isStepUpRequired(err)) setError(new ApiError(403, "Confirm it's you to change the document password."));
      else setError(err);
    } finally {
      setBusy(false);
    }
  };

  const isSet = status.data?.set;
  const protection = prefs?.payslip.pdf_protection ?? null;
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={isSet ? "Change document password" : "Set document password"}
      description={
        protection === "EMPLOYEE_SECRET"
          ? "Your employer protects payslip PDFs: the PDFs e-mailed to you open with this password. You'll confirm it's you first."
          : "If your employer protects payslip PDFs, the PDFs e-mailed to you open with this password. You'll confirm it's you first."
      }
      footer={
        <>
          <Button variant="ghost" className="min-h-[44px]" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="payslip-password" className="min-h-[44px]" loading={busy}>
            Save password
          </Button>
        </>
      }
    >
      <form id="payslip-password" onSubmit={submit} className="space-y-4" noValidate>
        {protection === "NONE" && (
          <Notice tone="info" title="Payslip PDFs aren't password-protected right now">
            Your employer doesn&apos;t protect payslip PDFs at the moment. A password you set is used if that changes.
          </Notice>
        )}
        {status.data && (
          <p className="text-sm text-muted-foreground">
            {isSet ? `A password is set${status.data.set_at ? ` (since ${fmtDateTime(status.data.set_at)})` : ""}. Saving replaces it.` : "No password is set yet."}
          </p>
        )}
        <ErrorSummary error={error} fields={{ ...fieldErrors(error) }} />
        <Field label="New password" required error={errors.password} hint="8–40 characters. Not your date of birth, name or employee ID.">
          <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={40} />
        </Field>
        <Field label="Repeat the password" required error={errors.confirm}>
          <Input type="password" autoComplete="new-password" value={confirmValue} onChange={(e) => setConfirmValue(e.target.value)} maxLength={40} />
        </Field>
        <p className="text-xs text-muted-foreground">Nobody at your company can see this password, and it can't be recovered: you can always set a new one.</p>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ other documents */

function OtherDocuments() {
  const { me } = useCan();
  const request = useModalRoute("request-document", { keys: [] });
  const docs = useApi(() => meApi.documents({ limit: 50 }), []);
  const requests = useApi(() => meApi.documentRequests(), []);
  const items = useMemo(() => (docs.data?.items ?? []).filter((d) => d.doc_type !== "PAYSLIP_V2"), [docs.data]);
  const open = (requests.data?.items ?? []).filter((r) => r.status === "PENDING" || r.status === "APPROVED");
  if (!canSelf(me, P.PAYROLL_PAYSLIP_READ)) return null;

  return (
    <section aria-labelledby="other-docs" className="mt-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="other-docs" className="text-lg font-semibold">
          Letters and statements
        </h2>
        <Button variant="secondary" className="min-h-[44px]" onClick={() => request.openModal()}>
          <ScrollText className="h-4 w-4" aria-hidden /> Request a letter
        </Button>
      </div>
      {open.length > 0 && (
        <ul className="mb-3 space-y-2" aria-label="Open requests">
          {open.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border px-4 py-3 text-sm">
              <span className="font-medium">{docTypeLabel(r.doc_type)}</span>
              <MeChip vocabulary="document_request" code={r.status} />
              {r.created_at && <span className="text-muted-foreground">requested {fmtDate(r.created_at)}</span>}
            </li>
          ))}
        </ul>
      )}
      <Card>
        {docs.error && !docs.data ? (
          <ErrorState message={docs.error.message} onRetry={docs.reload} />
        ) : docs.loading && !docs.data ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : !items.length ? (
          <EmptyState title="No letters or statements yet" description="Salary certificates, employment letters and statements you request or receive appear here." />
        ) : (
          <ul className="divide-y divide-border" aria-label="Documents">
            {items.map((d) => (
              <DocumentRow key={d.id} doc={d} />
            ))}
          </ul>
        )}
      </Card>
      <RequestDocumentModal
        open={request.open}
        onOpenChange={request.onOpenChange}
        onDone={() => {
          void requests.reload();
        }}
      />
    </section>
  );
}

export function DocumentRow({ doc }: { doc: PayDocumentDto }) {
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await downloadDocument(() => meApi.documentLink(doc.id), doc.file_name || `document-${doc.id}.pdf`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "The document couldn't be downloaded. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <FileText className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{doc.title || docTypeLabel(doc.doc_type)}</p>
        <p className="text-xs text-muted-foreground">
          {docTypeLabel(doc.doc_type)} · issued {fmtDate(doc.issue_date)}
          {doc.number ? (
            <>
              {" "}
              · <bdi dir="ltr">{doc.number}</bdi>
            </>
          ) : null}
        </p>
      </div>
      {doc.labels.map((l) => (
        <span key={l} className="rounded-md bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning">
          {l}
        </span>
      ))}
      <Button variant="ghost" size="sm" className="min-h-[44px]" loading={busy} onClick={save} aria-label={`Download ${doc.title || docTypeLabel(doc.doc_type)}`}>
        <Download className="h-4 w-4" aria-hidden /> Download
      </Button>
    </li>
  );
}

function RequestDocumentModal({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [docType, setDocType] = useState("SALARY_CERTIFICATE");
  const [includeAmounts, setIncludeAmounts] = useState(false);
  const [purpose, setPurpose] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (open) {
      setDocType("SALARY_CERTIFICATE");
      setIncludeAmounts(false);
      setPurpose("");
      setError(null);
    }
  }, [open]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const row: DocumentRequestDto = await meApi.requestDocument({ doc_type: docType, include_amounts: docType === "SALARY_CERTIFICATE" && includeAmounts, purpose: purpose.trim() || null });
      toast.success(`${docTypeLabel(row.doc_type)} requested. HR prepares it and you'll find it here.`);
      onDone();
      onOpenChange(false);
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
      title="Request a letter"
      description="HR reviews the request and issues the document to this page."
      footer={
        <>
          <Button variant="ghost" className="min-h-[44px]" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="request-document" className="min-h-[44px]" loading={busy}>
            Send request
          </Button>
        </>
      }
    >
      <form id="request-document" onSubmit={submit} className="space-y-4" noValidate>
        <ErrorSummary error={error} fields={fieldErrors(error)} />
        <Field label="Document" required>
          <Select value={docType} onChange={(e) => setDocType(e.target.value)} className="min-h-[44px]">
            <option value="SALARY_CERTIFICATE">Salary certificate</option>
            <option value="EMPLOYMENT_LETTER">Employment letter</option>
          </Select>
        </Field>
        {docType === "SALARY_CERTIFICATE" && (
          <label className="flex min-h-[44px] items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={includeAmounts} onChange={(e) => setIncludeAmounts(e.target.checked)} />
            Include my salary amounts
          </label>
        )}
        <Field label="Purpose (optional)" hint="For example: visa application, bank loan.">
          <Textarea rows={2} maxLength={300} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}
