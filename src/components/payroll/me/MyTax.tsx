"use client";

import { Landmark, Undo2 } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

import { DeclarationForm, initialValues } from "@/components/payroll/tax/DeclarationForm";
import { ProofPanel } from "@/components/payroll/tax/ProofPanel";
import { taxApi } from "@/components/payroll/tax/api";
import { formatDay, PackNote, TaxStatusChip, VersionValues } from "@/components/payroll/tax/shared";
import type { MyTaxProfile, TaxVersion } from "@/components/payroll/tax/types";
import { Button } from "@/components/ui/button";
import { Column, DataTable, EmptyState, ErrorState } from "@/components/ui/layout";
import { Card, CardHeader } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/api";
import { useApi } from "@/lib/hooks";

import { ConflictBanner, LinkButton, MeHeader, Notice, PageSkeleton } from "./shared";

/**
 * My Tax (3.8 §5.18): the declarations the country pack of the employee's legal entity asks for, their status
 * (Submitted / Approved / Rejected), proofs and history. The form, its fields, labels and honesty notes all come
 * from the API (the pack); a country whose pack declares nothing says "Not available for your country yet" and
 * no form is invented. Identifiers are shown masked only. Nothing here calculates tax.
 */
export function MyTax() {
  const profile = useApi(() => taxApi.profile(), []);
  const [formOpen, setFormOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [withdrawError, setWithdrawError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const data = profile.data;

  const reload = () => void profile.reload();
  const withdraw = async (version: TaxVersion) => {
    setBusy(true);
    setWithdrawError(null);
    try {
      await taxApi.withdraw(version.id, version.row_version);
      toast.success("Your submission was withdrawn.");
      setFormOpen(true);
      setFormKey((k) => k + 1);
      reload();
    } catch (error) {
      setWithdrawError(error);
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <MeHeader title="My Tax" description="Your tax declarations and proofs, as your country's payroll rules ask for them." hideAmounts={false} />
      {profile.error && !data ? (
        <ErrorState message={errorMessage(profile.error)} onRetry={reload} />
      ) : profile.loading && !data ? (
        <PageSkeleton />
      ) : data && !data.available ? (
        <Card>
          <EmptyState
            icon={<Landmark />}
            title="Not available for your country yet"
            description={`${data.message ?? "Tax declarations are not available for your country yet."} Until then, tax shown on your payslip is calculated from the details HR holds.`}
            action={<LinkButton href="/me/payslips">See my payslips</LinkButton>}
          />
        </Card>
      ) : data ? (
        <Available data={data} formOpen={formOpen} formKey={formKey} setFormOpen={setFormOpen} onChanged={reload} withdraw={withdraw} busy={busy} withdrawError={withdrawError} />
      ) : null}
    </div>
  );
}

function Available({
  data,
  formOpen,
  formKey,
  setFormOpen,
  onChanged,
  withdraw,
  busy,
  withdrawError,
}: {
  data: MyTaxProfile;
  formOpen: boolean;
  formKey: number;
  setFormOpen: (open: boolean) => void;
  onChanged: () => void;
  withdraw: (version: TaxVersion) => Promise<void>;
  busy: boolean;
  withdrawError: unknown;
}) {
  const { pending, current, latest, schema, pack, currency } = data;
  const rejected = !pending && latest?.status === "REJECTED" ? latest : null;
  const canSubmit = data.can_edit && !pending;
  const showForm = canSubmit && (formOpen || !current);
  const columns: Column<TaxVersion>[] = [
    { key: "version", header: "Version", primary: true, cell: (v) => `#${v.version_no}` },
    { key: "status", header: "Status", cell: (v) => <TaxStatusChip status={v.status} /> },
    { key: "effective", header: "Applies from", cell: (v) => formatDay(v.effective_from) },
    { key: "submitted", header: "Submitted", hideOnMobile: true, cell: (v) => formatDay(v.submitted_at?.slice(0, 10)) },
    { key: "note", header: "HR note", hideOnMobile: true, cell: (v) => (v.review_note ? <bdi dir="auto">{v.review_note}</bdi> : "—") },
  ];
  return (
    <>
      {pack && (pack.is_fixture || pack.usage !== "VERIFIED") && (
        <Notice tone="warning" title={pack.is_fixture ? "Test data" : "Not verified"}>
          <PackNote>{pack.label}</PackNote>
        </Notice>
      )}
      <ConflictBanner error={withdrawError} onReload={onChanged} />
      {pending && (
        <Card className="space-y-4 p-5" aria-label="Submission waiting for review">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">Version #{pending.version_no}</h2>
              <TaxStatusChip status={pending.status} />
            </div>
            <Button variant="secondary" className="min-h-[44px]" loading={busy} onClick={() => void withdraw(pending)}>
              <Undo2 className="h-4 w-4" aria-hidden /> Withdraw
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Waiting for HR to review. Applies from {formatDay(pending.effective_from)}. Withdraw it to change something and send it again.
          </p>
          {!pending.schema_current && (
            <Notice tone="warning" title="The declaration form changed">
              Your country&apos;s form changed after you sent this. Withdraw it and send it again.
            </Notice>
          )}
          <VersionValues version={pending} schema={schema} currency={currency} />
          <ProofPanel version={pending} schema={schema} mode="employee" onChanged={onChanged} />
        </Card>
      )}
      {rejected && (
        <Notice tone="danger" title={`Version #${rejected.version_no} was not approved`}>
          {rejected.review_note ? <bdi dir="auto">{rejected.review_note}</bdi> : "HR did not give a reason."}
        </Notice>
      )}
      {current && (
        <Card aria-label="Declarations in force">
          <CardHeader
            title="In force"
            description={`Version #${current.version_no} · applies from ${formatDay(current.effective_from)} · approved ${formatDay(current.reviewed_at?.slice(0, 10))}`}
            action={<TaxStatusChip status={current.status} />}
          />
          <div className="p-5">
            <VersionValues version={current} schema={schema} currency={currency} />
          </div>
        </Card>
      )}
      {canSubmit && !showForm && (
        <div className="flex justify-end">
          <Button className="min-h-[44px]" onClick={() => setFormOpen(true)}>
            {current ? "Update my declarations" : "Make my declarations"}
          </Button>
        </div>
      )}
      {showForm && (
        <Card>
          <CardHeader title={current ? "Update your declarations" : "Your declarations"} description="Only what your country's payroll rules ask for. HR reviews it before payroll uses it." />
          <div className="p-5">
            <DeclarationForm
              key={formKey}
              schema={schema}
              currency={currency}
              initial={initialValues(latest && latest.status !== "WITHDRAWN" ? latest : current)}
              identifiersOnFile={(current ?? latest)?.identifiers ?? {}}
              today={data.as_of}
              onSubmitted={() => {
                setFormOpen(false);
                onChanged();
              }}
            />
          </div>
        </Card>
      )}
      {!data.can_edit && !pending && !current && (
        <Notice title="You can read but not change your declarations">Ask HR if something needs to be declared for you.</Notice>
      )}
      {data.versions.length > 0 && (
        <Card>
          <CardHeader title="History" description="Every version you sent, newest first." />
          <DataTable columns={columns} rows={data.versions} rowKey={(v) => v.id} cardBelowMd caption="Tax declaration versions" />
        </Card>
      )}
    </>
  );
}
