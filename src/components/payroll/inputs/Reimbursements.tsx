"use client";

import { ArrowLeft, FileText, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { ExplainPanel } from "@/components/payroll/ExplainPanel";
import { FileDropzone } from "@/components/payroll/FileDropzone";
import { MoneyText } from "@/components/payroll/MoneyText";
import { StatusChip } from "@/components/payroll/StatusChip";
import { Timeline, type TimelineItem } from "@/components/payroll/Timeline";
import { useModalRoute } from "@/components/payroll/useModalRoute";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Column, DataTable, EmptyState, ErrorState, Pagination } from "@/components/ui/layout";
import { Modal, Sheet } from "@/components/ui/overlay";
import { Card, CardHeader, Skeleton } from "@/components/ui/primitives";
import { can } from "@/lib/access";
import { fmtDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { parseMoneyInput } from "@/lib/money";
import { P } from "@/lib/permissions.generated";

import { claimsApi, fetchBlob } from "./api";
import { ConflictBanner, DecisionModal, DetailGate, EmployeeField, ErrorSummary, FilterBar, Notice, WorkspaceHeader, errorText, fieldErrors, useEmployeeDirectory } from "./shared";
import { CLAIM_STATUSES, type Claim, type ClaimReceipt } from "./types";

const LIMIT = 50;
/** claims.RECEIPT_TYPES: PDF, PNG, JPEG (checked by file signature on the server too). */
export const RECEIPT_ACCEPT = [".pdf", ".png", ".jpg", ".jpeg", "application/pdf", "image/png", "image/jpeg"];
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
const human = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

/* ------------------------------------------------------------------ new claim */

export function NewClaimModal({ open, onOpenChange, onCreated, onDirtyChange }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated?: (id: number) => void; onDirtyChange?: (d: boolean) => void }) {
  const { me } = useCan();
  const currency0 = me?.company.currency ?? "INR";
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [claimType, setClaimType] = useState("");
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(currency0);
  const [merchant, setMerchant] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEmployeeId(null);
    setClaimType("");
    setDate("");
    setAmount("");
    setCurrency(currency0);
    setMerchant("");
    setDescription("");
    setErrors({});
    setError(null);
  }, [open, currency0]);
  const dirty = open && (!!employeeId || !!claimType || !!amount || !!merchant || !!description);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!employeeId) next.employee_id = "Choose the employee.";
    if (!claimType.trim()) next.claim_type = "Enter the claim type from the reimbursement policy, for example TRAVEL.";
    if (!date) next.expense_date = "Choose the expense date.";
    const parsed = parseMoneyInput(amount, currency);
    if (!parsed.ok) next.amount = parsed.message;
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    setError(null);
    try {
      const result = await claimsApi.create({
        employee_id: employeeId!,
        claim_type: claimType.trim().toUpperCase(),
        expense_date: date,
        amount: { amount: (parsed as { amount: string }).amount, currency },
        merchant: merchant.trim() || undefined,
        description: description.trim() || undefined,
      });
      toast.success(result.flags?.length ? "Claim submitted with flags for the approver. Add the receipt next." : "Claim submitted. Add the receipt next.");
      onOpenChange(false);
      onCreated?.(result.id);
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
      size="md"
      title="New claim"
      description="Checked against the reimbursement policy (limits, receipt rules, duplicates)."
      footer={
        <>
          <Button variant="ghost" className="min-h-[44px]" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="new-claim-form" className="min-h-[44px]" loading={busy}>
            Submit claim
          </Button>
        </>
      }
    >
      <form id="new-claim-form" onSubmit={submit} className="space-y-4" noValidate>
        <ConflictBanner error={error} />
        <ErrorSummary error={error} fields={errors} />
        <EmployeeField value={employeeId} onChange={setEmployeeId} error={errors.employee_id} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Claim type" required error={errors.claim_type} hint="A type from the policy, e.g. TRAVEL">
            <Input maxLength={40} value={claimType} onChange={(e) => setClaimType(e.target.value.toUpperCase())} />
          </Field>
          <Field label="Expense date" required error={errors.expense_date}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
          <Field label="Amount" required error={errors.amount}>
            <Input inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Currency" required error={errors.currency}>
            <Input dir="ltr" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
          </Field>
        </div>
        <Field label="Merchant" error={errors.merchant}>
          <Input maxLength={200} value={merchant} onChange={(e) => setMerchant(e.target.value)} />
        </Field>
        <Field label="Description" error={errors.description}>
          <Textarea rows={2} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ list */

export function ClaimsList() {
  const { me } = useCan();
  const router = useRouter();
  const people = useEmployeeDirectory();
  const [status, setStatus] = useState("");
  const [claimType, setClaimType] = useState("");
  const [skip, setSkip] = useState(0);
  const [dirty, setDirty] = useState(false);
  const modal = useModalRoute("new-claim", { keys: [], dirty });
  const canManage = can(me, P.PAYROLL_REIMBURSEMENTS_MANAGE);
  useEffect(() => setSkip(0), [status, claimType]);
  const { data, error, loading, reload } = useApi(() => claimsApi.list({ status, claim_type: claimType, skip, limit: LIMIT }), [status, claimType, skip]);

  const columns: Column<Claim>[] = [
    { key: "employee", header: "Employee", primary: true, cell: (c) => <Link href={`/payroll/reimbursements/${c.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{people.name(c.employee_id)}</Link> },
    { key: "type", header: "Type", cell: (c) => c.claim_type_name ?? c.claim_type },
    { key: "date", header: "Expense date", hideOnMobile: true, cell: (c) => fmtDate(c.expense_date) },
    { key: "amount", header: <span className="block text-end">Claimed</span>, className: "text-end", cell: (c) => <MoneyText money={c.amount} /> },
    { key: "receipts", header: "Receipts", hideOnMobile: true, cell: (c) => (c.receipts.length ? `${c.receipts.length}` : <span className="text-warning">None</span>) },
    {
      key: "status",
      header: "Status",
      cell: (c) => (
        <span className="inline-flex flex-wrap items-center gap-1">
          <StatusChip vocabulary="claim" code={c.status} />
          {c.flags.length > 0 && <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs text-warning">{c.flags.length} flag{c.flags.length === 1 ? "" : "s"}</span>}
        </span>
      ),
    },
  ];

  return (
    <div>
      <WorkspaceHeader
        title="Reimbursements"
        description="Expense claims with receipts. Approved claims are paid by a pay run or a payment batch, as the policy says."
        actions={
          canManage && (
            <Button className="min-h-[44px]" onClick={() => modal.openModal()}>
              <Plus className="h-4 w-4" aria-hidden /> New claim
            </Button>
          )
        }
      />
      <Card>
        <FilterBar>
          <Field label="Status" className="w-48">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {CLAIM_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {human(s)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Claim type" className="w-40">
            <Input value={claimType} maxLength={40} placeholder="TRAVEL" onChange={(e) => setClaimType(e.target.value.toUpperCase())} />
          </Field>
        </FilterBar>
        {error ? (
          <ErrorState message={error.message} onRetry={reload} />
        ) : (
          <DataTable
            columns={columns}
            rows={data?.items}
            loading={loading}
            rowKey={(c) => c.id}
            onRowClick={(c) => router.push(`/payroll/reimbursements/${c.id}`)}
            cardBelowMd
            caption="Reimbursement claims"
            empty={
              <EmptyState
                title={status || claimType ? "No claims match these filters" : "No claims yet"}
                description="Employees submit claims from My Loans & Claims; payroll staff can submit on their behalf."
                action={canManage && <Button className="min-h-[44px]" onClick={() => modal.openModal()}>New claim</Button>}
              />
            }
          />
        )}
        {data && <Pagination total={data.total} skip={skip} limit={LIMIT} onChange={setSkip} />}
      </Card>
      <NewClaimModal open={modal.open} onOpenChange={modal.onOpenChange} onDirtyChange={setDirty} onCreated={(id) => router.push(`/payroll/reimbursements/${id}`)} />
    </div>
  );
}

/* ------------------------------------------------------------------ receipt preview */

/** Receipt preview in a Sheet (3.8 §5.10). Files are fetched with credentials and shown from a local object URL. */
export function ReceiptSheet({ claimId, receipt, open, onOpenChange }: { claimId: number; receipt: ClaimReceipt | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !receipt) return;
    let href: string | null = null;
    let live = true;
    setUrl(null);
    setError(null);
    fetchBlob(claimsApi.receiptUrl(claimId, receipt.id))
      .then((blob) => {
        if (!live) return;
        href = URL.createObjectURL(blob);
        setUrl(href);
      })
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
      if (href) URL.revokeObjectURL(href);
    };
  }, [open, receipt, claimId]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={receipt?.file_name ?? "Receipt"} description={receipt ? `${receipt.mime} · uploaded ${fmtDate(receipt.uploaded_at)}` : undefined} width="max-w-2xl">
      {!receipt ? (
        <p className="text-sm text-muted-foreground">This receipt is not on this claim.</p>
      ) : error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : !url ? (
        <Skeleton className="h-[60vh] w-full" />
      ) : receipt.mime.startsWith("image/") ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={`Receipt ${receipt.file_name}`} className="max-h-[75vh] w-full rounded-xl object-contain" />
      ) : (
        <div className="space-y-3">
          <iframe src={url} title={`Receipt ${receipt.file_name}`} className="h-[70vh] w-full rounded-xl border border-border" />
          <a href={url} download={receipt.file_name} className="inline-flex min-h-[44px] items-center text-sm font-medium text-primary hover:underline">
            Download {receipt.file_name}
          </a>
        </div>
      )}
      {receipt && (
        <p className="mt-3 font-mono text-[11px] text-muted-foreground" title="SHA-256 of the file">
          <bdi dir="ltr">sha256 {receipt.sha256.slice(0, 24)}…</bdi>
        </p>
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ detail */

export function ClaimDetail({ id }: { id: string }) {
  const { me } = useCan();
  const people = useEmployeeDirectory();
  const { data: claim, error, loading, reload } = useApi(() => claimsApi.get(id), [id]);
  const receiptRoute = useModalRoute("receipt", { keys: ["receipt"] });
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const canManage = can(me, P.PAYROLL_REIMBURSEMENTS_MANAGE);
  const canApprove = can(me, P.PAYROLL_REIMBURSEMENTS_APPROVE);
  const receipt = claim?.receipts.find((r) => String(r.id) === receiptRoute.id) ?? null;

  const events: TimelineItem[] = claim
    ? ([
        claim.created_at && { id: "submitted", at: claim.created_at, title: "Submitted", tone: "info" },
        ...claim.receipts.map((r) => r.uploaded_at && { id: `r-${r.id}`, at: r.uploaded_at, title: `Receipt added: ${r.file_name}`, tone: "neutral" }),
        claim.decided_at && { id: "decided", at: claim.decided_at, title: claim.status === "REJECTED" ? "Rejected" : "Approved", body: claim.status_reason, tone: claim.status === "REJECTED" ? "danger" : "success" },
      ].filter(Boolean) as TimelineItem[])
    : [];

  const paidWithoutEvidence = claim?.status === "PAID" && !claim.paid_ref;
  const converted = claim?.payout && claim.amount && claim.payout.currency !== claim.amount.currency;

  return (
    <DetailGate loading={loading} error={error} hasData={!!claim} onRetry={reload} what="Claim" backHref="/payroll/reimbursements" backLabel="Back to Reimbursements">
      {claim && (
        <div className="space-y-6">
          <Link href="/payroll/reimbursements" className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden /> Reimbursements
          </Link>
          <WorkspaceHeader
            title={`${claim.claim_type_name ?? claim.claim_type} · ${people.name(claim.employee_id)}`}
            description={`Claim #${claim.id} · expense on ${fmtDate(claim.expense_date)}${claim.merchant ? ` · ${claim.merchant}` : ""}`}
            actions={
              canApprove &&
              claim.status === "SUBMITTED" && (
                <>
                  <Button variant="ghost" className="min-h-[44px] text-danger" onClick={() => setDecision("reject")}>
                    Reject
                  </Button>
                  <Button className="min-h-[44px]" onClick={() => setDecision("approve")}>
                    Approve
                  </Button>
                </>
              )
            }
          />
          {claim.flags.length > 0 && (
            <Notice tone="warning" title="Flags for the approver">
              <ul className="list-disc ps-5">
                {claim.flags.map((f, i) => (
                  <li key={i}>{f.message ?? f.code}</li>
                ))}
              </ul>
            </Notice>
          )}
          {paidWithoutEvidence && <Notice tone="warning" title="Marked paid without a settlement reference">Check the payment batch before telling the employee it is paid.</Notice>}
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="space-y-6">
              <Card className="p-5">
                <div className="mb-4">
                  <StatusChip vocabulary="claim" code={claim.status} />
                </div>
                <dl className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-muted-foreground">Claimed</dt>
                    <dd className="mt-1 text-lg">
                      <MoneyText money={claim.amount} emphasis />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Approved</dt>
                    <dd className="mt-1 text-lg">
                      <MoneyText money={claim.approved} emphasis />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Paid as</dt>
                    <dd className="mt-1">{claim.payout_route ? human(claim.payout_route) : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Taxability</dt>
                    <dd className="mt-1">{claim.taxability ? human(claim.taxability) : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Payment reference</dt>
                    <dd className="mt-1">{claim.paid_ref ?? "—"}</dd>
                  </div>
                </dl>
                {claim.description && <p className="mt-4 text-sm text-muted-foreground">{claim.description}</p>}
                {converted && claim.payout && (
                  <div className="mt-4">
                    <ExplainPanel
                      explanation={(claim.fx_conversion?.explanation as string | undefined) ?? "The claim was converted to the pay group's currency with the approved exchange rate."}
                      inputs={[
                        { label: "Claimed", value: <MoneyText money={claim.amount} /> },
                        { label: "Paid out", value: <MoneyText money={claim.payout} /> },
                        ...(claim.fx_conversion?.rate ? [{ label: "Rate", value: <bdi dir="ltr">{String(claim.fx_conversion.rate)}</bdi> }] : []),
                      ]}
                    />
                  </div>
                )}
              </Card>
              <Card>
                <CardHeader title="Receipts" description="Open a receipt to preview it beside the claim." />
                <ul className="px-2 pb-2">
                  {claim.receipts.length === 0 && <li className="px-3 py-3 text-sm text-warning">No receipt yet. The policy may require one before approval.</li>}
                  {claim.receipts.map((r) => (
                    <li key={r.id}>
                      <button type="button" className="flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 text-start text-sm hover:bg-surface-muted" onClick={() => receiptRoute.openModal({ receipt: r.id })}>
                        <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
                        <span className="min-w-0 flex-1 truncate font-medium">{r.file_name}</span>
                        <span className="text-xs text-muted-foreground">{Math.max(1, Math.round(r.bytes / 1024))} KB</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {canManage && claim.status === "SUBMITTED" && (
                  <div className="border-t border-border p-4">
                    <FileDropzone
                      accept={RECEIPT_ACCEPT}
                      maxBytes={RECEIPT_MAX_BYTES}
                      multiple
                      label="Add receipts"
                      hint="PDF, PNG or JPEG"
                      upload={async (file, onProgress) => {
                        await claimsApi.addReceipt(claim.id, file, onProgress);
                        void reload();
                      }}
                    />
                  </div>
                )}
              </Card>
            </div>
            <Card>
              <CardHeader title="History" />
              <div className="px-5 pb-5">
                <Timeline items={events} label="Claim history" />
              </div>
            </Card>
          </div>
          <ReceiptSheet claimId={claim.id} receipt={receipt} open={receiptRoute.open} onOpenChange={receiptRoute.onOpenChange} />
          {decision && (
            <DecisionModal
              open
              onOpenChange={(o) => !o && setDecision(null)}
              decision={decision}
              subject={`${claim.claim_type_name ?? claim.claim_type} for ${people.name(claim.employee_id)}`}
              summary={
                <div className="rounded-xl bg-muted/60 p-3 text-sm">
                  <MoneyText money={claim.amount} emphasis /> · {claim.receipts.length} receipt{claim.receipts.length === 1 ? "" : "s"}
                </div>
              }
              acknowledge={claim.flags.map((f) => f.message ?? f.code)}
              onReload={reload}
              onSubmit={async (remarks) => {
                if (decision === "approve") await claimsApi.approve(claim.id, remarks);
                else await claimsApi.reject(claim.id, remarks);
                toast.success(decision === "approve" ? "Claim approved. It is paid with the next pay run or payment batch." : "Claim rejected. The employee sees your reason.");
                void reload();
              }}
            />
          )}
        </div>
      )}
    </DetailGate>
  );
}
