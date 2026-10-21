"use client";

import { Check, Pencil, UserPlus, Wallet, X } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { Segmented } from "@/components/branding/fields";
import { DiffView } from "@/components/payroll/DiffView";
import { MoneyText } from "@/components/payroll/MoneyText";
import { StatusChip } from "@/components/payroll/StatusChip";
import { Timeline, type TimelineItem } from "@/components/payroll/Timeline";
import { useModalRoute } from "@/components/payroll/useModalRoute";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Card, CardHeader } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { percentChange } from "@/lib/payroll/labels";
import { P } from "@/lib/permissions.generated";

import { compensationApi } from "./api";
import { BreakdownTable, type Period } from "./BreakdownTable";
import { REASON_LABEL } from "./format";
import { GradePosition } from "./GradePosition";
import { SALARY_MODAL, SalaryChangeModal } from "./SalaryChangeModal";
import { BackLink, LoadError, PageSkeleton } from "./shared";
import type { Assignment } from "./types";

/**
 * Employee compensation (3.8 §5.6 row page): current package, component breakdown, scheduled and
 * pending changes (approve/reject for approvers; the maker can't approve), the history timeline with
 * diffs, and "Revise salary" (?modal=revise&employee=). Out-of-scope employees are "not found".
 */
export function EmployeeCompensationView({ employeeId }: { employeeId: number }) {
  const { me, can } = useCan();
  const canEdit = can(P.PAYROLL_COMPENSATION_EDIT);
  const canApprove = can(P.PAYROLL_COMPENSATION_APPROVE);
  const { data, error, reload } = useApi(() => compensationApi.employeeCompensation(employeeId), [employeeId]);
  const revise = useModalRoute(SALARY_MODAL.revise, { keys: ["employee"] });
  const assign = useModalRoute(SALARY_MODAL.assign, { keys: ["employee"] });
  const [period, setPeriod] = useState<Period>("monthly");
  const [deciding, setDeciding] = useState<{ row: Assignment; decision: "approve" | "reject" } | null>(null);
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [decideError, setDecideError] = useState<string | null>(null);

  if (error) return <LoadError error={error} onRetry={reload} what="Employee" backHref="/payroll/compensation" backLabel="Back to Assign salary" />;
  if (!data) return <PageSkeleton />;

  const editable = canEdit && !data.self_service;
  const current = data.current;

  const decide = async () => {
    if (!deciding) return;
    if (deciding.decision === "reject" && !remarks.trim()) {
      setDecideError("Give the reason for rejecting.");
      return;
    }
    setBusy(true);
    setDecideError(null);
    try {
      if (deciding.decision === "approve") await compensationApi.approveAssignment(deciding.row.id, remarks.trim() || undefined);
      else await compensationApi.rejectAssignment(deciding.row.id, remarks.trim());
      toast.success(deciding.decision === "approve" ? "Approved. The salary takes effect on its effective date." : "Rejected. The current salary stays.");
      setDeciding(null);
      setRemarks("");
      await reload();
    } catch (e) {
      setDecideError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const history: TimelineItem[] = data.history.map((h) => {
    const change = h.change?.change_pct ? percentChange(h.change.change_pct) : null;
    return {
      id: h.id,
      at: h.approved_at ?? h.created_at,
      tone: h.status === "ACTIVE" ? "success" : h.status === "REJECTED" ? "danger" : h.status === "PENDING_APPROVAL" ? "warning" : "neutral",
      title: (
        <span className="inline-flex flex-wrap items-center gap-2">
          {REASON_LABEL[h.reason] ?? h.reason} from {fmtDate(h.effective_from)}
          <StatusChip vocabulary="compensation" code={h.status} />
        </span>
      ),
      actor: `${h.structure.name} v${h.structure.version}${h.split_period ? " · starts inside a pay period (split)" : ""}`,
      body: (
        <div className="space-y-1">
          <DiffView
            caption={`Change ${h.id}`}
            rows={[
              { key: "basis", label: "Pay basis", before: h.change?.pay_basis_before ? <MoneyText money={h.change.pay_basis_before} /> : null, after: <MoneyText money={h.pay_basis_amount} />, kind: h.change ? "changed" : "added" },
            ]}
          />
          {change && (
            <p className={change.direction === "up" ? "text-success" : change.direction === "down" ? "text-danger" : ""} aria-label={change.spoken}>
              {change.text}
            </p>
          )}
          {h.note && <p className="text-xs">“{h.note}”</p>}
        </div>
      ),
    };
  });

  const waiting = [...data.pending, ...data.scheduled];

  return (
    <div>
      <BackLink href="/payroll/compensation">Assign salary</BackLink>
      <PageHeader
        eyebrow={<bdi dir="ltr">{data.employee.employee_code}</bdi>}
        title={data.employee.name}
        description={[data.legal_entity?.name, data.pay_group?.name].filter(Boolean).join(" · ") || undefined}
        actions={
          editable &&
          (current ? (
            <Button onClick={() => revise.openModal({ employee: employeeId })} className="min-h-[44px]" disabled={data.pending.some((p) => p.status === "PENDING_APPROVAL")} title={data.pending.some((p) => p.status === "PENDING_APPROVAL") ? "A change is already waiting for approval" : undefined}>
              <Pencil className="h-4 w-4" aria-hidden /> Revise salary
            </Button>
          ) : (
            <Button onClick={() => assign.openModal({ employee: employeeId })} className="min-h-[44px]">
              <UserPlus className="h-4 w-4" aria-hidden /> Assign salary
            </Button>
          ))
        }
      />

      {waiting.length > 0 && (
        <Card className="mb-6">
          <CardHeader title="Scheduled and waiting" description="Not in force yet." />
          <ul className="divide-y divide-border/70">
            {waiting.map((p) => {
              const ownChange = p.created_by_user_id !== null && p.created_by_user_id === me?.user.id;
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  <StatusChip vocabulary="compensation" code={p.status} />
                  <span>
                    <MoneyText money={p.pay_basis_amount} /> from {fmtDate(p.effective_from)} · {p.structure.name} v{p.structure.version}
                  </span>
                  {p.status === "PENDING_APPROVAL" && canApprove && (
                    <span className="ms-auto flex gap-2">
                      {ownChange ? (
                        <span className="text-xs text-muted-foreground">You proposed this change, so someone else approves it.</span>
                      ) : (
                        <>
                          <Button size="sm" variant="secondary" className="min-h-[44px] sm:min-h-[32px]" onClick={() => setDeciding({ row: p, decision: "reject" })}>
                            <X className="h-4 w-4" aria-hidden /> Reject
                          </Button>
                          <Button size="sm" className="min-h-[44px] sm:min-h-[32px]" onClick={() => setDeciding({ row: p, decision: "approve" })}>
                            <Check className="h-4 w-4" aria-hidden /> Approve
                          </Button>
                        </>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {!current ? (
        <Card>
          <EmptyState
            icon={<Wallet />}
            title="No salary in force"
            description="This employee is left out of payroll with the reason “no salary” until a salary is approved. They are never paid zero."
            action={
              editable && (
                <Button onClick={() => assign.openModal({ employee: employeeId })} className="min-h-[44px]">
                  Assign salary
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader title="Current package" description={`${current.structure.name} v${current.structure.version} · since ${fmtDate(current.effective_from)}`} />
            <div className="space-y-4 p-5">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Pay basis</p>
                <p className="text-2xl font-semibold">
                  <MoneyText money={current.pay_basis_amount} emphasis />
                </p>
              </div>
              {data.grade_range && <GradePosition range={data.grade_range} />}
              {data.breakdown && (
                <>
                  <Segmented<Period>
                    label="Show"
                    value={period}
                    onChange={setPeriod}
                    options={[
                      { value: "monthly", label: "Monthly" },
                      { value: "annual", label: "Annual" },
                    ]}
                  />
                  <BreakdownTable breakdown={data.breakdown} period={period} caption="Current salary breakdown" />
                </>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="History" description="Every salary change with what changed." />
            <div className="p-5">
              <Timeline items={history} label="Salary history" />
            </div>
          </Card>
        </div>
      )}

      {editable && (
        <>
          <SalaryChangeModal mode="revise" onSaved={reload} />
          <SalaryChangeModal mode="assign" onSaved={reload} />
        </>
      )}

      <Modal
        open={!!deciding}
        onOpenChange={(o) => !o && setDeciding(null)}
        title={deciding?.decision === "approve" ? "Approve this salary?" : "Reject this salary?"}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeciding(null)}>
              Cancel
            </Button>
            <Button variant={deciding?.decision === "reject" ? "danger" : "primary"} onClick={decide} loading={busy}>
              {deciding?.decision === "approve" ? "Approve" : "Reject"}
            </Button>
          </>
        }
      >
        {deciding && (
          <div className="space-y-3 text-sm">
            <p>
              {deciding.decision === "approve"
                ? `It takes effect on ${fmtDate(deciding.row.effective_from)}${deciding.row.split_period ? " (inside a pay period: that period is split)" : ""}. The salary before it ends the day before.`
                : "The proposed salary will not be used. The current salary stays."}
            </p>
            <Field label={deciding.decision === "reject" ? "Reason" : "Comment"} required={deciding.decision === "reject"} error={decideError ?? undefined}>
              <Textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
