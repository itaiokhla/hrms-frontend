"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Calculator, Check, Play, Send, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { MoneyText } from "@/components/payroll/MoneyText";
import { useTypedConfirm } from "@/components/payroll/TypedConfirmModal";
import { EmployeePicker, type PickedEmployee } from "@/components/shared/EmployeePicker";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { DataTable, EmptyState, PageHeader, type Column } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Card, CardHeader } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fmtDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { isConflict } from "@/lib/payroll/api";
import { percentChange } from "@/lib/payroll/labels";
import { P } from "@/lib/permissions.generated";

import { compensationApi } from "./api";
import { CycleStatusChip } from "./CyclesList";
import { CYCLE_METHOD_LABEL, GRADE_POSITION, ITEM_STATUS, decimalFromInput, percentText } from "./format";
import { BackLink, ConflictBanner, ErrorSummary, IdChips, LoadError, PageSkeleton, ToneChip, useOrgOptions } from "./shared";
import { CYCLE_METHODS, type CycleItem, type CycleMethod, type CycleMethodType, type CyclePopulation, type RevisionCycle } from "./types";

const STEPS = ["Population", "Method", "Preview", "Approve and apply"] as const;
const EDITABLE = ["DRAFT", "PREVIEWED"];

function stepFor(status: string): number {
  if (status === "DRAFT") return 0;
  if (status === "PREVIEWED") return 2;
  return 3;
}

interface MethodForm {
  type: CycleMethodType;
  percent: string;
  amounts: string;
  rows: string;
  matrix: string;
  ratings: string;
  default_percent: string;
  structure_id: string;
}

function methodForm(m: CycleMethod, type?: string | null): MethodForm {
  return {
    type: (type && (CYCLE_METHODS as readonly string[]).includes(type) ? type : m.type) as CycleMethodType,
    percent: m.percent ?? "",
    amounts: Object.entries(m.amounts ?? {}).map(([c, a]) => `${c},${a}`).join("\n"),
    rows: (m.rows ?? []).map((r) => `${r.employee_code ?? r.employee_id},${r.pay_basis_amount}`).join("\n"),
    matrix: Object.entries(m.matrix ?? {}).flatMap(([g, rs]) => Object.entries(rs).map(([r, p]) => `${g},${r},${p}`)).join("\n"),
    ratings: Object.entries(m.ratings ?? {}).map(([e, r]) => `${e},${r}`).join("\n"),
    default_percent: m.default_percent ?? "0",
    structure_id: "",
  };
}

const lines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.split(",").map((x) => x.trim()))
    .filter((p) => p.some(Boolean));

/** Build the API method; returns errors instead when something is missing. */
function methodBody(f: MethodForm, structureVersionId: number | null): { method?: CycleMethod; errors: string[] } {
  const errors: string[] = [];
  const base: CycleMethod = { type: f.type, ...(structureVersionId ? { structure_version_id: structureVersionId } : {}) };
  if (f.type === "PERCENT") {
    const p = decimalFromInput(f.percent, { allowNegative: true });
    if (!p.value) errors.push(p.error ?? "Enter the increase in %.");
    return { method: { ...base, percent: p.value ?? undefined }, errors };
  }
  if (f.type === "FIXED_AMOUNT") {
    const amounts: Record<string, string> = {};
    for (const [cur, amt] of lines(f.amounts)) {
      const v = decimalFromInput(amt ?? "", { allowNegative: true });
      if (!/^[A-Z]{3}$/.test(cur ?? "") || !v.value) errors.push(`"${cur},${amt ?? ""}" should be CURRENCY,amount (INR,5000).`);
      else amounts[cur] = v.value;
    }
    if (!Object.keys(amounts).length && !errors.length) errors.push("Add at least one CURRENCY,amount line.");
    return { method: { ...base, amounts }, errors };
  }
  if (f.type === "PER_ROW") {
    const rows: NonNullable<CycleMethod["rows"]> = [];
    for (const [who, amt] of lines(f.rows)) {
      const v = decimalFromInput(amt ?? "");
      if (!who || !v.value) errors.push(`"${who},${amt ?? ""}" should be employee code,new amount.`);
      else rows.push(/^\d+$/.test(who) ? { employee_id: Number(who), pay_basis_amount: v.value } : { employee_code: who, pay_basis_amount: v.value });
    }
    if (!rows.length && !errors.length) errors.push("Add at least one employee code,amount line.");
    return { method: { ...base, rows }, errors };
  }
  const matrix: Record<string, Record<string, string>> = {};
  for (const [grade, rating, pct] of lines(f.matrix)) {
    const v = decimalFromInput(pct ?? "", { allowNegative: true });
    if (!grade || !rating || !v.value) errors.push(`"${grade},${rating ?? ""},${pct ?? ""}" should be GRADE,RATING,percent.`);
    else (matrix[grade] ??= {})[rating] = v.value;
  }
  if (!Object.keys(matrix).length && !errors.length) errors.push("Add at least one GRADE,RATING,percent line.");
  const ratings = Object.fromEntries(lines(f.ratings).filter((p) => p[0] && p[1]).map(([e, r]) => [e, r]));
  const d = decimalFromInput(f.default_percent || "0", { allowNegative: true });
  if (!d.value) errors.push("The default % must be a number.");
  return { method: { ...base, matrix, ratings, default_percent: d.value ?? "0" }, errors };
}

/**
 * Revision cycle page (3.8 §5.7): Population → Method → Preview (old, new, change %, range position,
 * totals per currency) → Approve and apply (typed confirmation; step-up when the server asks).
 */
export function CycleWizard({ id }: { id: number }) {
  const { me, can } = useCan();
  const canEdit = can(P.PAYROLL_COMPENSATION_EDIT);
  const canApprove = can(P.PAYROLL_COMPENSATION_APPROVE);
  const search = useSearchParams();
  const reduceMotion = useReducedMotion();
  const { data, error, reload, setData } = useApi(() => compensationApi.getCycle(id), [id]);
  const structures = useApi(() => compensationApi.listStructures(), [], { enabled: canEdit });
  const org = useOrgOptions();
  const { confirmTyped, modal: typedModal } = useTypedConfirm();
  const [step, setStep] = useState<number | null>(null);
  const [seeded, setSeeded] = useState<RevisionCycle | null>(null);
  const [population, setPopulation] = useState<CyclePopulation>({});
  const [people, setPeople] = useState<PickedEmployee[]>([]);
  const [picker, setPicker] = useState<PickedEmployee | null>(null);
  const [form, setForm] = useState<MethodForm | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [conflict, setConflict] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<"approve" | "reject" | null>(null);
  const [remarks, setRemarks] = useState("");

  if (data && data !== seeded) {
    setSeeded(data);
    setPopulation(data.population ?? {});
    setForm(methodForm(data.method, seeded ? null : search?.get("method")));
    if (step === null) setStep(search?.get("method") && data.status === "DRAFT" ? 1 : stepFor(data.status));
  }

  if (error) return <LoadError error={error} onRetry={reload} what="Revision cycle" backHref="/payroll/revisions" backLabel="Back to revisions" />;
  if (!data || !form || step === null) return <PageSkeleton />;

  const cycle = data;
  const editable = canEdit && EDITABLE.includes(cycle.status);
  const items = cycle.items ?? [];
  const proposed = items.filter((i) => i.status === "PROPOSED");
  const ownCycle = cycle.created_by_user_id !== null && cycle.created_by_user_id === me?.user.id;

  const act = async (name: string, fn: () => Promise<RevisionCycle>, success: string, next?: number) => {
    setBusy(name);
    setErrors([]);
    try {
      const result = await fn();
      // submit/approve/reject return the cycle without items: reload for the full view.
      if (result.items) setData(result);
      else await reload();
      toast.success(success);
      if (next !== undefined) setStep(next);
    } catch (e) {
      if (isConflict(e) && (e as { code?: string }).code === "ROW_VERSION_CONFLICT") setConflict(errorMessage(e));
      else setErrors([errorMessage(e)]);
    } finally {
      setBusy(null);
    }
  };

  const savePopulation = () => act("population", () => compensationApi.updateCycle(cycle.id, { row_version: cycle.row_version, population }), "Population saved.", 1);

  const saveMethod = async () => {
    let versionId: number | null = null;
    if (form.structure_id) {
      try {
        const s = await compensationApi.getStructure(form.structure_id);
        versionId = s.versions?.find((v) => v.status === "ACTIVE")?.id ?? null;
      } catch (e) {
        setErrors([errorMessage(e)]);
        return;
      }
    } else versionId = cycle.method.structure_version_id ?? null;
    const built = methodBody(form, versionId);
    if (built.errors.length) {
      setErrors(built.errors);
      return;
    }
    await act("method", () => compensationApi.updateCycle(cycle.id, { row_version: cycle.row_version, method: built.method }), "Method saved.", 2);
  };

  const apply = async () => {
    const ok = await confirmTyped({
      title: `Apply ${cycle.name}?`,
      message: "New salaries go into force from the effective date. This can't be undone from here; a later revision is needed to change them.",
      consequences: [
        `${proposed.length} salaries change from ${fmtDate(cycle.effective_from)}.`,
        "Each change is checked again; any that no longer validates is marked failed and the rest apply.",
        "Pay runs that already covered the effective date get arrears proposals.",
      ],
      confirmText: cycle.name,
      confirmLabel: "Apply cycle",
      tone: "danger",
    });
    if (!ok) return;
    await act("apply", () => compensationApi.applyCycle(cycle.id), "Cycle applied. The new salaries are in force from the effective date.");
  };

  const decide = async () => {
    if (deciding === "reject" && !remarks.trim()) {
      setErrors(["Give the reason for rejecting."]);
      return;
    }
    const d = deciding;
    setDeciding(null);
    await act(d!, () => (d === "approve" ? compensationApi.approveCycle(cycle.id, remarks.trim() || undefined) : compensationApi.rejectCycle(cycle.id, remarks.trim())), d === "approve" ? "Cycle approved. It can now be applied." : "Cycle rejected.");
    setRemarks("");
  };

  const pName = (ids: number[] | undefined, opts: typeof org.legalEntities) => (ids ?? []).map((id) => opts?.find((o) => o.id === id)?.name ?? `#${id}`).join(", ");

  const columns: Column<CycleItem>[] = [
    { key: "employee", header: "Employee", primary: true, cell: (i) => <span className="font-medium">{i.employee.name}</span> },
    { key: "old", header: <span className="block text-end">Current</span>, className: "text-end", cell: (i) => (i.proposed ? <MoneyText amount={i.proposed.old_pay_basis_amount} currency={i.proposed.currency} /> : "—") },
    { key: "new", header: <span className="block text-end">New</span>, className: "text-end", cell: (i) => (i.proposed ? <MoneyText amount={i.proposed.pay_basis_amount} currency={i.proposed.currency} emphasis /> : "—") },
    {
      key: "pct",
      header: "Change",
      cell: (i) => {
        const c = percentChange(i.proposed?.change_pct ?? null);
        return <span className={c.direction === "up" ? "text-success" : c.direction === "down" ? "text-danger" : ""} aria-label={c.spoken}>{c.text}</span>;
      },
    },
    {
      key: "range",
      header: "Range position",
      hideOnMobile: true,
      cell: (i) => {
        if (!i.proposed) return "—";
        const g = GRADE_POSITION[i.proposed.grade_range] ?? { label: i.proposed.grade_range, tone: "neutral" as const };
        return (
          <span className="inline-flex items-center gap-2">
            <ToneChip label={g.label} tone={g.tone} />
            {i.proposed.position_pct && <span className="text-xs tabular-nums text-muted-foreground">{i.proposed.position_pct}%</span>}
          </span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      cell: (i) => (
        <span className="space-y-0.5">
          <ToneChip label={ITEM_STATUS[i.status]?.label ?? i.status} tone={ITEM_STATUS[i.status]?.tone ?? "neutral"} />
          {i.note && <span className="block text-xs text-muted-foreground">{i.note}</span>}
        </span>
      ),
    },
  ];

  const totals = Object.entries(cycle.totals ?? {});
  const multi = totals.length > 1;

  return (
    <div>
      <BackLink href="/payroll/revisions">Revisions</BackLink>
      <PageHeader
        eyebrow={`Effective ${fmtDate(cycle.effective_from)}`}
        title={
          <span className="inline-flex flex-wrap items-center gap-3">
            {cycle.name} <CycleStatusChip status={cycle.status} />
          </span>
        }
        description={`${CYCLE_METHOD_LABEL[cycle.method.type] ?? cycle.method.type}${cycle.method.type === "PERCENT" ? ` · ${percentText(cycle.method.percent)}` : ""}`}
      />

      <nav aria-label="Cycle steps" className="mb-6">
        <ol className="relative grid grid-cols-4 gap-2">
          {STEPS.map((label, i) => {
            const done = i < stepFor(cycle.status) || cycle.status === "APPLIED";
            const current = i === step;
            return (
              <li key={label} aria-current={current ? "step" : undefined}>
                <button
                  type="button"
                  onClick={() => setStep(i)}
                  className={cn("relative flex min-h-[44px] w-full flex-col items-center gap-1 rounded-2xl px-1 py-2 text-center text-xs sm:flex-row sm:text-sm", current ? "font-semibold text-foreground" : "text-muted-foreground")}
                >
                  {current && <motion.span layoutId="cycle-step" className="absolute inset-0 rounded-2xl bg-primary-soft" transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }} />}
                  <span className={cn("relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs", done ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface")}>{done ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}</span>
                  <span className="relative">{label}</span>
                  <span className="sr-only">{done ? ", completed" : current ? ", current" : ""}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {conflict && (
        <ConflictBanner
          message={conflict}
          onReload={() => {
            setConflict(null);
            setSeeded(null);
            void reload();
          }}
          className="mb-4"
        />
      )}
      <ErrorSummary errors={errors} className="mb-4" />
      {!EDITABLE.includes(cycle.status) && step < 2 && <p className="mb-4 rounded-xl bg-surface-muted px-4 py-3 text-sm">This cycle is {cycle.status.toLowerCase().replace(/_/g, " ")}; its population and method can no longer change.</p>}

      {step === 0 && (
        <Card>
          <CardHeader title="Who is in this cycle" description="Active employees placed on the effective date, inside your scope. Empty filters mean everyone you can edit." />
          <fieldset disabled={!editable} className="space-y-4 p-5">
            <IdChips label="Legal entities" options={org.legalEntities} value={population.legal_entity_ids ?? []} onChange={(ids) => setPopulation((p) => ({ ...p, legal_entity_ids: ids }))} />
            <IdChips label="Departments" options={org.departments} value={population.department_ids ?? []} onChange={(ids) => setPopulation((p) => ({ ...p, department_ids: ids }))} />
            <IdChips label="Grades" options={org.grades} value={population.grade_ids ?? []} onChange={(ids) => setPopulation((p) => ({ ...p, grade_ids: ids }))} />
            <div className="space-y-2">
              <p className="text-[13px] font-medium">Only these employees (optional)</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="flex-1">
                  <EmployeePicker value={picker} onChange={setPicker} excludeIds={population.employee_ids ?? []} />
                </div>
                <Button
                  variant="secondary"
                  className="min-h-[44px]"
                  disabled={!picker}
                  onClick={() => {
                    if (!picker) return;
                    setPeople((p) => [...p, picker]);
                    setPopulation((p) => ({ ...p, employee_ids: [...(p.employee_ids ?? []), picker.id] }));
                    setPicker(null);
                  }}
                >
                  Add
                </Button>
              </div>
              <ul className="flex flex-wrap gap-1.5">
                {(population.employee_ids ?? []).map((eid) => (
                  <li key={eid} className="inline-flex items-center gap-1 rounded-xl border border-border ps-3 text-sm">
                    {people.find((p) => p.id === eid)?.full_name ?? `Employee #${eid}`}
                    <button type="button" aria-label={`Remove employee ${eid}`} className="flex h-11 w-11 items-center justify-center sm:h-8 sm:w-8" onClick={() => setPopulation((p) => ({ ...p, employee_ids: (p.employee_ids ?? []).filter((x) => x !== eid) }))}>
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Hired on or after">
                <Input type="date" value={population.hire_date_after ?? ""} onChange={(e) => setPopulation((p) => ({ ...p, hire_date_after: e.target.value || undefined }))} />
              </Field>
              <Field label="Hired on or before">
                <Input type="date" value={population.hire_date_before ?? ""} onChange={(e) => setPopulation((p) => ({ ...p, hire_date_before: e.target.value || undefined }))} />
              </Field>
            </div>
            {editable && (
              <div className="flex justify-end">
                <Button onClick={savePopulation} loading={busy === "population"} className="min-h-[44px]">
                  Save and continue
                </Button>
              </div>
            )}
          </fieldset>
        </Card>
      )}

      {step === 1 && (
        <Card>
          <CardHeader title="How much" description="New amounts are rounded to the currency's minor unit." />
          <fieldset disabled={!editable} className="space-y-4 p-5">
            <Field label="Method">
              <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as CycleMethodType })}>
                {CYCLE_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {CYCLE_METHOD_LABEL[m]}
                  </option>
                ))}
              </Select>
            </Field>
            {form.type === "PERCENT" && (
              <Field label="Increase (%)" hint="Negative for a reduction.">
                <Input dir="ltr" inputMode="decimal" value={form.percent} onChange={(e) => setForm({ ...form, percent: e.target.value })} />
              </Field>
            )}
            {form.type === "FIXED_AMOUNT" && (
              <Field label="Amount per currency" hint="One line per currency: INR,5000">
                <Textarea dir="ltr" rows={3} value={form.amounts} onChange={(e) => setForm({ ...form, amounts: e.target.value })} />
              </Field>
            )}
            {form.type === "PER_ROW" && (
              <Field label="New pay basis per employee" hint="One line per employee: employee code,new amount (E001,1350000)">
                <Textarea dir="ltr" rows={6} value={form.rows} onChange={(e) => setForm({ ...form, rows: e.target.value })} />
              </Field>
            )}
            {form.type === "MATRIX" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Grade × rating → %" hint="GRADE,RATING,percent: G3,A,12">
                  <Textarea dir="ltr" rows={6} value={form.matrix} onChange={(e) => setForm({ ...form, matrix: e.target.value })} />
                </Field>
                <Field label="Ratings" hint="employee id,rating: 142,A">
                  <Textarea dir="ltr" rows={6} value={form.ratings} onChange={(e) => setForm({ ...form, ratings: e.target.value })} />
                </Field>
                <Field label="Default % (no rating or cell)">
                  <Input dir="ltr" inputMode="decimal" value={form.default_percent} onChange={(e) => setForm({ ...form, default_percent: e.target.value })} />
                </Field>
              </div>
            )}
            <Field label="Also move everyone to a structure (optional)" hint={cycle.method.structure_version_id ? "A structure version is set; choose another to change it." : "Empty: each employee keeps their structure."}>
              <Select value={form.structure_id} onChange={(e) => setForm({ ...form, structure_id: e.target.value })}>
                <option value="">{cycle.method.structure_version_id ? "Keep the chosen version" : "Keep each employee's structure"}</option>
                {(structures.data ?? []).filter((s) => s.active_version).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} (v{s.active_version})
                  </option>
                ))}
              </Select>
            </Field>
            {editable && (
              <div className="flex justify-end">
                <Button onClick={saveMethod} loading={busy === "method"} className="min-h-[44px]">
                  Save and continue
                </Button>
              </div>
            )}
          </fieldset>
        </Card>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium">{cycle.status === "DRAFT" ? "Calculate every new salary." : cycle.totals ? "Preview calculated." : "No preview yet."}</p>
              <p className="text-muted-foreground">
                Population: {pName(cycle.population?.legal_entity_ids, org.legalEntities) || "all entities"}
                {cycle.population?.grade_ids?.length ? ` · grades ${pName(cycle.population.grade_ids, org.grades)}` : ""}
                {cycle.population?.employee_ids?.length ? ` · ${cycle.population.employee_ids.length} named employees` : ""}
              </p>
            </div>
            {editable && (
              <Button onClick={() => act("preview", () => compensationApi.previewCycle(cycle.id), "Preview calculated.")} loading={busy === "preview"} variant={cycle.status === "PREVIEWED" ? "secondary" : "primary"} className="min-h-[44px]">
                <Calculator className="h-4 w-4" aria-hidden /> {cycle.status === "PREVIEWED" ? "Recalculate" : "Calculate preview"}
              </Button>
            )}
          </Card>
          {totals.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {totals.map(([cur, t]) => {
                const c = percentChange(t.change_pct);
                return (
                  <Card key={cur} className="space-y-1 p-5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {cur} · {t.count} {t.count === 1 ? "person" : "people"}
                    </p>
                    <p className="text-sm">
                      <MoneyText amount={t.old} currency={cur} useCode={multi} /> → <MoneyText amount={t.new} currency={cur} useCode={multi} emphasis />
                    </p>
                    <p className="text-sm">
                      Increase <MoneyText amount={t.increase} currency={cur} useCode={multi} />{" "}
                      <span className={c.direction === "up" ? "text-success" : c.direction === "down" ? "text-danger" : ""} aria-label={c.spoken}>
                        {c.text}
                      </span>
                    </p>
                  </Card>
                );
              })}
            </div>
          )}
          <Card>
            <DataTable
              caption="Proposed salaries"
              columns={columns}
              rows={items}
              rowKey={(i) => i.id}
              cardBelowMd
              empty={<EmptyState title={cycle.status === "DRAFT" ? "Not calculated yet" : "Nobody in the population"} description={cycle.status === "DRAFT" ? "Calculate the preview to see every new salary." : "Change the population filters."} />}
            />
          </Card>
          {cycle.status === "PREVIEWED" && (
            <div className="flex justify-end">
              <Button onClick={() => setStep(3)} className="min-h-[44px]">
                Continue to approval
              </Button>
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <Card>
          <CardHeader title="Approve and apply" description="An approver other than the person who prepared the cycle decides; then the cycle is applied." />
          <div className="space-y-4 p-5 text-sm">
            {cycle.status === "DRAFT" && <p>Calculate the preview first.</p>}
            {cycle.status === "PREVIEWED" && (
              <>
                <p>
                  {proposed.length} new salaries are ready. Submitting sends the cycle to the approvers; nothing changes for anyone yet.
                </p>
                {canEdit && (
                  <Button onClick={() => act("submit", () => compensationApi.submitCycle(cycle.id), "Cycle sent for approval.")} loading={busy === "submit"} disabled={!proposed.length} className="min-h-[44px]">
                    <Send className="h-4 w-4" aria-hidden /> Submit for approval
                  </Button>
                )}
              </>
            )}
            {cycle.status === "PENDING_APPROVAL" && (
              <>
                <p>Waiting for approval. Salaries have not changed.</p>
                {canApprove &&
                  (ownCycle ? (
                    <p className="text-muted-foreground">You prepared this cycle, so someone else approves it.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" onClick={() => setDeciding("reject")} className="min-h-[44px]">
                        <X className="h-4 w-4" aria-hidden /> Reject
                      </Button>
                      <Button onClick={() => setDeciding("approve")} loading={busy === "approve"} className="min-h-[44px]">
                        <Check className="h-4 w-4" aria-hidden /> Approve
                      </Button>
                    </div>
                  ))}
              </>
            )}
            {cycle.status === "APPROVED" && (
              <>
                <p>Approved. Applying puts {proposed.length} new salaries in force from {fmtDate(cycle.effective_from)}.</p>
                {canEdit && (
                  <Button variant="danger" onClick={apply} loading={busy === "apply"} className="min-h-[44px]">
                    <Play className="h-4 w-4" aria-hidden /> Apply cycle
                  </Button>
                )}
              </>
            )}
            {cycle.status === "APPLIED" && (
              <p>
                Applied {cycle.applied_at ? fmtDate(cycle.applied_at) : ""}: {items.filter((i) => i.status === "APPLIED").length} in force, {items.filter((i) => i.status === "FAILED").length} failed. Failed items show their reason in the preview list.
              </p>
            )}
            {cycle.status === "REJECTED" && <p>Rejected. Salaries did not change. Create a new cycle to try again.</p>}
          </div>
        </Card>
      )}

      <Modal
        open={!!deciding}
        onOpenChange={(o) => !o && setDeciding(null)}
        title={deciding === "approve" ? `Approve ${cycle.name}?` : `Reject ${cycle.name}?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeciding(null)}>
              Cancel
            </Button>
            <Button variant={deciding === "reject" ? "danger" : "primary"} onClick={decide}>
              {deciding === "approve" ? "Approve" : "Reject"}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p>{deciding === "approve" ? `${proposed.length} salaries can then be applied from ${fmtDate(cycle.effective_from)}.` : "The cycle stops here; salaries do not change."}</p>
          <Field label={deciding === "reject" ? "Reason" : "Comment"} required={deciding === "reject"}>
            <Textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
        </div>
      </Modal>
      {typedModal}
    </div>
  );
}
