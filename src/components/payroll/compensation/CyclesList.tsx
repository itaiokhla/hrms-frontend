"use client";

import { Plus, TrendingUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { MoneyText } from "@/components/payroll/MoneyText";
import { useModalRoute } from "@/components/payroll/useModalRoute";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { DataTable, EmptyState, ErrorState, PageHeader, type Column } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Card } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";

import { compensationApi } from "./api";
import { CYCLE_METHOD_LABEL, CYCLE_STATUS, decimalFromInput, percentText, todayIso } from "./format";
import { ToneChip } from "./shared";
import { CYCLE_METHODS, type CycleMethodType, type RevisionCycle } from "./types";

export function CycleStatusChip({ status }: { status: string }) {
  const s = CYCLE_STATUS[status] ?? { label: status, tone: "neutral" as const, glossary: "" };
  return <ToneChip label={s.label} tone={s.tone} glossary={s.glossary} />;
}

/** Revisions (3.8 §5.7): increment cycles with status, population, budget per currency and approval state. */
export function CyclesList() {
  const router = useRouter();
  const { can } = useCan();
  const canEdit = can(P.PAYROLL_COMPENSATION_EDIT);
  const { data, error, loading, reload } = useApi(() => compensationApi.listCycles(), []);
  const route = useModalRoute("new-cycle", { keys: [] });

  const columns: Column<RevisionCycle>[] = [
    { key: "name", header: "Cycle", primary: true, cell: (c) => <span className="font-medium">{c.name}</span> },
    { key: "from", header: "Effective from", cell: (c) => fmtDate(c.effective_from) },
    { key: "method", header: "Method", cell: (c) => `${CYCLE_METHOD_LABEL[c.method.type] ?? c.method.type}${c.method.type === "PERCENT" ? ` · ${percentText(c.method.percent)}` : ""}`, hideOnMobile: true },
    {
      key: "population",
      header: "People",
      cell: (c) => (c.totals ? Object.values(c.totals).reduce((n, t) => n + t.count, 0) : <span className="text-muted-foreground">Not previewed</span>),
    },
    {
      key: "budget",
      header: "Increase per currency",
      cell: (c) =>
        c.totals && Object.keys(c.totals).length ? (
          <ul className="space-y-0.5">
            {Object.entries(c.totals).map(([cur, t]) => (
              <li key={cur}>
                <MoneyText amount={t.increase} currency={cur} useCode={Object.keys(c.totals!).length > 1} />
                {t.change_pct && <span className="ms-1 text-xs text-muted-foreground">({percentText(t.change_pct)})</span>}
              </li>
            ))}
          </ul>
        ) : (
          "—"
        ),
    },
    { key: "status", header: "Status", cell: (c) => <CycleStatusChip status={c.status} /> },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Compensation"
        title="Revisions"
        description="Increment cycles: choose who, how much, preview every new salary and send it for approval. Single revisions are made from the employee's page."
        actions={
          canEdit && (
            <Button onClick={() => route.openModal()} className="min-h-[44px]">
              <Plus className="h-4 w-4" aria-hidden /> New cycle
            </Button>
          )
        }
      />
      <Card>
        {error ? (
          <ErrorState message={error.message} onRetry={reload} />
        ) : (
          <DataTable
            caption="Revision cycles"
            columns={columns}
            rows={data}
            loading={loading}
            rowKey={(c) => c.id}
            onRowClick={(c) => router.push(`/payroll/revisions/${c.id}`)}
            cardBelowMd
            empty={
              <EmptyState
                icon={<TrendingUp />}
                title="No revision cycles yet"
                description="Start one for the annual increment, a promotion round or a market correction."
                action={
                  canEdit && (
                    <Button onClick={() => route.openModal()} className="min-h-[44px]">
                      New cycle
                    </Button>
                  )
                }
              />
            }
          />
        )}
      </Card>
      {canEdit && <NewCycleModal />}
    </div>
  );
}

/** ?modal=new-cycle: name, effective date and method; the cycle page (full page) takes it from there. */
function NewCycleModal() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const [type, setType] = useState<CycleMethodType>("PERCENT");
  const [percent, setPercent] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const dirty = !!(name || percent);
  const route = useModalRoute("new-cycle", { keys: [], dirty });

  const submit = async () => {
    const found: Record<string, string> = {};
    if (!name.trim()) found.name = "Enter a name.";
    if (!effectiveFrom) found.effective_from = "Choose the date.";
    const pct = decimalFromInput(percent, { allowNegative: true });
    if (type === "PERCENT" && (!pct.value || pct.error)) found.percent = pct.error ?? "Enter the increase in %.";
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      // The API needs a complete method to create a cycle; other methods start as 0% and are set on the Method step.
      const created = await compensationApi.createCycle({ name: name.trim(), effective_from: effectiveFrom, method: { type: "PERCENT", percent: type === "PERCENT" ? pct.value! : "0" } });
      toast.success(type === "PERCENT" ? "Cycle created. Choose who it covers next." : "Cycle created. Set the method's amounts next.");
      setName("");
      setPercent("");
      router.push(`/payroll/revisions/${created.id}${type !== "PERCENT" ? `?method=${type}` : ""}`);
    } catch (e) {
      setErrors({ form: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={route.open}
      onOpenChange={route.onOpenChange}
      title="New revision cycle"
      description="Nothing changes for anyone until the cycle is approved and applied."
      footer={
        <>
          <Button variant="secondary" onClick={() => void route.close()}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            Create cycle
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {errors.form && (
          <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
            {errors.form}
          </p>
        )}
        <Field label="Name" required error={errors.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Annual increment 2027" />
        </Field>
        <Field label="New salaries start on" required error={errors.effective_from}>
          <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
        </Field>
        <Field label="Method">
          <Select value={type} onChange={(e) => setType(e.target.value as CycleMethodType)}>
            {CYCLE_METHODS.map((m) => (
              <option key={m} value={m}>
                {CYCLE_METHOD_LABEL[m]}
              </option>
            ))}
          </Select>
        </Field>
        {type === "PERCENT" && (
          <Field label="Increase (%)" required error={errors.percent} hint="Negative for a reduction.">
            <Input dir="ltr" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} />
          </Field>
        )}
      </form>
    </Modal>
  );
}
