"use client";

import { ArrowLeft, Download } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { ExplainPanel } from "@/components/payroll/ExplainPanel";
import { MoneyText } from "@/components/payroll/MoneyText";
import { StatusChip } from "@/components/payroll/StatusChip";
import { Timeline, type TimelineItem } from "@/components/payroll/Timeline";
import { useModalRoute } from "@/components/payroll/useModalRoute";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/primitives";
import { can } from "@/lib/access";
import { fmtDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";

import { fetchBlob, saveBlob, wageInputsApi } from "./api";
import { ImportRowsTable } from "./ImportCsvModal";
import { DecisionModal, Decimal, DetailGate, LocalStatusChip, Notice, ReasonModal, WorkspaceHeader, errorText, useEmployeeDirectory } from "./shared";
import { WageInputModal } from "./WageInputModal";

const back = "inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,10rem)_1fr] gap-3 border-b border-border/60 py-2.5 text-sm last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/** Full page of one wage input (D-12 parity with the Add / edit modal): `/payroll/inputs/[id]`. */
export function WageInputDetail({ id }: { id: string }) {
  const { me } = useCan();
  const people = useEmployeeDirectory();
  const { data, error, loading, reload } = useApi(() => wageInputsApi.get(id), [id]);
  const [dirty, setDirty] = useState(false);
  const edit = useModalRoute("wage-input", { keys: ["id"], dirty });
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const canEdit = can(me, P.PAYROLL_INPUTS_EDIT);
  const canApprove = can(me, P.PAYROLL_INPUTS_APPROVE);

  const events: TimelineItem[] = data
    ? [
        data.created_at && { id: "created", at: data.created_at, title: `Entered (${data.source.toLowerCase()})`, tone: "neutral" as const },
        data.submitted_at && { id: "submitted", at: data.submitted_at, title: "Submitted", tone: "info" as const },
        data.decided_at && {
          id: "decided",
          at: data.decided_at,
          title: data.status === "REJECTED" ? "Rejected" : data.status === "CANCELLED" ? "Cancelled" : "Approved",
          body: data.status_reason,
          tone: (data.status === "REJECTED" ? "danger" : data.status === "CANCELLED" ? "neutral" : "success") as TimelineItem["tone"],
        },
      ].filter(Boolean) as TimelineItem[]
    : [];

  return (
    <DetailGate loading={loading} error={error} hasData={!!data} onRetry={reload} what="Wage input" backHref="/payroll/inputs" backLabel="Back to Wage Inputs">
      {data && (
        <div className="space-y-6">
          <Link href="/payroll/inputs" className={back}>
            <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden /> Wage Inputs
          </Link>
          <WorkspaceHeader
            title={`${data.component_code} · ${people.name(data.employee_id)}`}
            description={`Input #${data.id} for ${fmtDate(data.target_period.start)} – ${fmtDate(data.target_period.end)}`}
            actions={
              <>
                {canEdit && data.status === "DRAFT" && (
                  <Button className="min-h-[44px]" onClick={() => edit.openModal({ id: data.id })}>
                    Edit draft
                  </Button>
                )}
                {canApprove && data.status === "PENDING_APPROVAL" && (
                  <>
                    <Button className="min-h-[44px]" onClick={() => setDecision("approve")}>
                      Approve
                    </Button>
                    <Button variant="ghost" className="min-h-[44px] text-danger" onClick={() => setDecision("reject")}>
                      Reject
                    </Button>
                  </>
                )}
                {canEdit && !data.reserved_by_run_employee_id && ["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(data.status) && (
                  <Button variant="ghost" className="min-h-[44px]" onClick={() => setCancelling(true)}>
                    Cancel input
                  </Button>
                )}
              </>
            }
          />
          {data.flags.length > 0 && (
            <Notice tone="warning" title="Flags on this input">
              <ul className="list-disc ps-5">
                {data.flags.map((f, i) => (
                  <li key={i}>{f.message ?? f.code}</li>
                ))}
              </ul>
            </Notice>
          )}
          {data.reserved_by_run_employee_id && <Notice title="Locked by a pay run">A draft pay run has picked this input up. Release the run to change it.</Notice>}
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <Card>
              <CardHeader title="Details" />
              <dl className="px-5 pb-4">
                <Row label="Status">
                  <StatusChip vocabulary="wage_input" code={data.status} />
                </Row>
                <Row label="Amount">
                  {data.amount ? <MoneyText money={data.amount} emphasis /> : <Decimal value={data.units} suffix="units" />}
                </Row>
                {data.rate && (
                  <Row label="Rate per unit">
                    <MoneyText amount={data.rate} currency={data.currency} />
                  </Row>
                )}
                <Row label="Reason">{data.reason ?? "—"}</Row>
                <Row label="External reference">{data.external_ref ?? "—"}</Row>
                <Row label="Source">{data.source}</Row>
                {data.import_id && (
                  <Row label="Import">
                    <Link className="text-primary hover:underline" href={`/payroll/inputs/imports/${data.import_id}`}>
                      Import #{data.import_id}
                    </Link>
                  </Row>
                )}
                {data.consumed_by_run_employee_id && <Row label="Paid in">A finalized pay run</Row>}
              </dl>
              {!data.amount && (
                <div className="px-5 pb-5">
                  <ExplainPanel
                    explanation="This input is entered as units. The pay run multiplies the units by the rate (this input's rate, or the component's rate when none is given) and rounds with the component's rounding."
                    inputs={[
                      { label: "Units", value: <Decimal value={data.units} /> },
                      { label: "Rate", value: data.rate ? <MoneyText amount={data.rate} currency={data.currency} /> : "Component's rate" },
                    ]}
                  />
                </div>
              )}
            </Card>
            <Card>
              <CardHeader title="History" />
              <div className="px-5 pb-5">
                <Timeline items={events} label="Input history" />
              </div>
            </Card>
          </div>

          <WageInputModal open={edit.open} onOpenChange={edit.onOpenChange} inputId={edit.id} onDirtyChange={setDirty} onSaved={reload} />
          {decision && (
            <DecisionModal
              open
              onOpenChange={(o) => !o && setDecision(null)}
              decision={decision}
              subject={`${data.component_code} for ${people.name(data.employee_id)}`}
              acknowledge={data.flags.map((f) => f.message ?? f.code)}
              onReload={reload}
              onSubmit={async (remarks) => {
                if (decision === "approve") await wageInputsApi.approve(data.id, remarks);
                else await wageInputsApi.reject(data.id, remarks);
                toast.success(decision === "approve" ? "Input approved." : "Input rejected.");
                void reload();
              }}
            />
          )}
          <ReasonModal
            open={cancelling}
            onOpenChange={setCancelling}
            title="Cancel this input?"
            consequence="A cancelled input is never paid. To correct it, add a new input."
            confirmLabel="Cancel input"
            danger
            onReload={reload}
            onSubmit={async (reason) => {
              await wageInputsApi.cancel(data.id, reason);
              toast.success("Input cancelled.");
              void reload();
            }}
          />
        </div>
      )}
    </DetailGate>
  );
}

/** Full page of one CSV import (parity with the Import CSV modal): `/payroll/inputs/imports/[id]`. */
export function ImportDetail({ id }: { id: string }) {
  const { me } = useCan();
  const { data, error, loading, reload } = useApi(() => wageInputsApi.getImport(id), [id]);
  const [busy, setBusy] = useState(false);
  const canImport = can(me, P.PAYROLL_INPUTS_IMPORT);

  const commit = async () => {
    if (!data) return;
    setBusy(true);
    try {
      await wageInputsApi.commitImport(data.id);
      toast.success("Import queued. Rows are being created.");
      void reload();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DetailGate loading={loading} error={error} hasData={!!data} onRetry={reload} what="Import" backHref="/payroll/inputs?tab=imports" backLabel="Back to imports">
      {data && (
        <div className="space-y-6">
          <Link href="/payroll/inputs?tab=imports" className={back}>
            <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden /> Imports
          </Link>
          <WorkspaceHeader
            title={data.file_name}
            description={`Import #${data.id} · uploaded ${fmtDate(data.created_at, "d MMM yyyy, h:mm a")}`}
            showHideAmounts={false}
            actions={
              <>
                {(data.status === "COMMITTED" || data.status === "FAILED") && (
                  <Button
                    variant="secondary"
                    className="min-h-[44px]"
                    onClick={async () => {
                      try {
                        saveBlob(await fetchBlob(wageInputsApi.resultUrl(data.id)), `import-${data.id}-result.csv`);
                      } catch (e) {
                        toast.error(errorText(e));
                      }
                    }}
                  >
                    <Download className="h-4 w-4" aria-hidden /> Result file
                  </Button>
                )}
                {canImport && data.status === "VALIDATED" && (
                  <Button className="min-h-[44px]" loading={busy} onClick={commit}>
                    Import {data.row_count} rows
                  </Button>
                )}
              </>
            }
          />
          <Card className="p-5">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <LocalStatusChip vocabulary="import" code={data.status} />
              <span>
                {data.row_count} rows · {data.error_count} with errors
              </span>
              <span className="font-mono text-xs text-muted-foreground" title="SHA-256 of the uploaded file">
                <bdi dir="ltr">{data.sha256.slice(0, 16)}…</bdi>
              </span>
            </div>
          </Card>
          {(data.rows ?? []).length > 0 && (
            <Card>
              <CardHeader title="Rows" description="Every row as checked in the dry run." />
              <ImportRowsTable rows={data.rows ?? []} />
            </Card>
          )}
        </div>
      )}
    </DetailGate>
  );
}
