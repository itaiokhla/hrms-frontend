"use client";

import { CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

import { ConflictBanner, ErrorSummary } from "@/components/payroll/inputs/shared";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { Column, DataTable, EmptyState, ErrorState, Tabs } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Card } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { newIdempotencyKey } from "@/lib/payroll/api";

import { taxApi } from "./api";
import { ProofPanel } from "./ProofPanel";
import { formatDay, PackNote, TaxStatusChip, VersionValues } from "./shared";
import type { StaffTaxVersion, TaxProfileStatus } from "./types";

const FILTERS: { value: string; label: string; status: TaxProfileStatus | null }[] = [
  { value: "SUBMITTED", label: "To review", status: "SUBMITTED" },
  { value: "APPROVED", label: "Approved", status: "APPROVED" },
  { value: "REJECTED", label: "Rejected", status: "REJECTED" },
  { value: "ALL", label: "All", status: null },
];

/**
 * HR review of employees' tax declarations (payroll:tax_profile:review, legal-entity scope; 3.2 §7.3). The form's
 * fields come from the country pack, identifiers are masked, and a proof the pack requires must be attached before
 * a version can be approved. Approving needs a fresh step-up and a second person: the server refuses a reviewer's
 * own declarations. Approved values are handed to payroll read-only; nothing here calculates tax.
 */
export function TaxReviewTab() {
  const [filter, setFilter] = useState("SUBMITTED");
  const [version, setVersion] = useState(0);
  const [openId, setOpenId] = useState<number | null>(null);
  const status = FILTERS.find((f) => f.value === filter)?.status ?? null;
  const list = useApi(() => taxApi.list({ status, limit: 100 }), [status, version]);
  const data = list.data;
  const counts = data?.counts ?? {};
  const open = data?.items.find((i) => i.id === openId) ?? null;

  const columns: Column<StaffTaxVersion>[] = [
    {
      key: "employee",
      header: "Employee",
      primary: true,
      cell: (v) => (
        <span className="min-w-0">
          <bdi dir="auto" className="font-medium">
            {v.employee?.name ?? `Employee #${v.employee_id}`}
          </bdi>
          {v.employee?.employee_code && <span className="block text-xs text-muted-foreground">{v.employee.employee_code}</span>}
        </span>
      ),
    },
    { key: "version", header: "Version", cell: (v) => `#${v.version_no}` },
    { key: "status", header: "Status", cell: (v) => <TaxStatusChip status={v.status} /> },
    { key: "effective", header: "Applies from", cell: (v) => formatDay(v.effective_from) },
    { key: "submitted", header: "Submitted", hideOnMobile: true, cell: (v) => formatDay(v.submitted_at?.slice(0, 10)) },
    {
      key: "proofs",
      header: "Proofs",
      hideOnMobile: true,
      cell: (v) => (v.status === "SUBMITTED" && v.proofs_missing.length ? <span className="text-warning">{v.proofs_missing.length} missing</span> : v.proofs.length || "—"),
    },
  ];

  return (
    <div className="space-y-4">
      <Tabs
        tabs={FILTERS.map((f) => ({ value: f.value, label: f.label, badge: f.status === "SUBMITTED" ? counts.SUBMITTED : undefined }))}
        value={filter}
        onValueChange={setFilter}
      >
        <span />
      </Tabs>
      {list.error && !data ? (
        <ErrorState message={errorMessage(list.error)} onRetry={() => void list.reload()} />
      ) : (
        <Card>
          <DataTable
            columns={columns}
            rows={data?.items}
            loading={list.loading}
            rowKey={(v) => v.id}
            onRowClick={(v) => setOpenId(v.id)}
            cardBelowMd
            caption="Tax declarations"
            empty={
              <EmptyState
                icon={<ShieldCheck />}
                title={filter === "SUBMITTED" ? "Nothing to review" : "No declarations here"}
                description="Employees send declarations from My Tax when their country's pack asks for them."
              />
            }
          />
        </Card>
      )}
      <ReviewModal
        item={open}
        onClose={() => setOpenId(null)}
        onDone={() => {
          setVersion((v) => v + 1);
          setOpenId(null);
        }}
      />
    </div>
  );
}

function ReviewModal({ item, onClose, onDone }: { item: StaffTaxVersion | null; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey());
  const reset = () => {
    setNote("");
    setMode(null);
    setError(null);
    setKey(newIdempotencyKey());
  };
  const close = () => {
    reset();
    onClose();
  };
  if (!item) return <Modal open={false} onOpenChange={close} title="Tax declarations">{null}</Modal>;
  const currency = item.currency;
  const pending = item.status === "SUBMITTED";
  const blocked = item.is_own
    ? "You cannot review your own declarations: someone else has to."
    : item.proofs_missing.length
      ? "A proof the country's rules ask for is still missing."
      : !item.schema_current
        ? "The country's declaration form changed after this was sent. Ask the employee to send it again."
        : null;

  const act = async () => {
    if (!mode) return;
    if (mode === "reject" && !note.trim()) {
      toast.error("Write the reason for rejecting.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === "approve") await taxApi.approve(item.id, { note: note.trim() || null, row_version: item.row_version });
      else await taxApi.reject(item.id, { note: note.trim(), row_version: item.row_version });
      toast.success(mode === "approve" ? "Declarations approved. Payroll uses them from their start date." : "Declarations rejected; the employee was told.");
      reset();
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onOpenChange={(open) => !open && close()}
      size="lg"
      title={`${item.employee?.name ?? "Employee"} · version #${item.version_no}`}
      description={`Applies from ${formatDay(item.effective_from)} · submitted ${formatDay(item.submitted_at?.slice(0, 10))}`}
      footer={
        pending ? (
          mode ? (
            <>
              <Button variant="secondary" className="min-h-[44px]" onClick={reset} disabled={busy}>
                Back
              </Button>
              <Button variant={mode === "approve" ? "success" : "danger"} className="min-h-[44px]" loading={busy} onClick={() => void act()}>
                {mode === "approve" ? "Confirm approval" : "Confirm rejection"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="danger-ghost" className="min-h-[44px]" onClick={() => setMode("reject")} disabled={item.is_own}>
                <XCircle className="h-4 w-4" aria-hidden /> Reject
              </Button>
              <Button variant="success" className="min-h-[44px]" onClick={() => setMode("approve")} disabled={!!blocked}>
                <CheckCircle2 className="h-4 w-4" aria-hidden /> Approve
              </Button>
            </>
          )
        ) : (
          <Button variant="secondary" className="min-h-[44px]" onClick={close}>
            Close
          </Button>
        )
      }
    >
      <div className="space-y-5" key={key}>
        <div className="flex flex-wrap items-center gap-2">
          <TaxStatusChip status={item.status} />
          {item.schema.some((f) => f.note) && <PackNote>{item.schema.find((f) => f.note)?.note}</PackNote>}
        </div>
        <ConflictBanner error={error} onReload={onDone} />
        <ErrorSummary error={error} />
        {pending && blocked && <p className="rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm">{blocked}</p>}
        <VersionValues version={item} schema={item.schema} currency={currency} />
        <ProofPanel version={item} schema={item.schema} mode="staff" />
        {item.review_note && (
          <p className="text-sm">
            <span className="text-muted-foreground">Review note: </span>
            <bdi dir="auto">{item.review_note}</bdi>
          </p>
        )}
        {pending && mode && (
          <Field
            label={mode === "approve" ? "Note (optional)" : "Reason (the employee reads it)"}
            required={mode === "reject"}
            hint={mode === "approve" ? "Approving needs a fresh confirmation that it's you." : undefined}
          >
            <Textarea value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
          </Field>
        )}
      </div>
    </Modal>
  );
}
