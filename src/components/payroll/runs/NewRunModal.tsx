"use client";

import { AlertTriangle, ArrowUpRight, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import toast from "react-hot-toast";

import { useModalRoute } from "@/components/payroll/useModalRoute";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { Skeleton } from "@/components/ui/primitives";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useApi } from "@/lib/hooks";
import { newIdempotencyKey } from "@/lib/payroll/api";

import { runsApi } from "./api";
import { EXCLUSION_LABELS, Notice, RUN_TYPE_LABELS, dateRange, useLookups } from "./shared";
import type { PayPeriodOption, PopulationPreview, Run } from "./types";

type CreatableType = "REGULAR" | "OFF_CYCLE" | "FINAL_SETTLEMENT";

const TYPE_HINTS: Record<CreatableType, string> = {
  REGULAR: "Everyone eligible in the pay group for the period.",
  OFF_CYCLE: "Selected employees only, outside the regular run (for example a bonus or a correction).",
  FINAL_SETTLEMENT: "One employee who is leaving: final pay and settlement items.",
};

/**
 * New pay run (3.8 §6, deep link `?modal=new-run`): legal entity → pay group → period → type, with
 * the population the run would have (eligible = included + excluded with reasons) and a warning
 * when a regular run already exists for the period. The server still enforces uniqueness.
 */
export function NewRunModal() {
  const router = useRouter();
  const lookups = useLookups();
  const [entityId, setEntityId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [runType, setRunType] = useState<CreatableType>("REGULAR");
  const [label, setLabel] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [touched, setTouched] = useState(false);
  const key = useRef(newIdempotencyKey());
  const created = useRef(false);
  const dirty = !!groupId || !!label.trim() || selected.length > 0;
  const route = useModalRoute("new-run", { keys: ["pay_group"], dirty: dirty && !busy && !created.current });

  useEffect(() => {
    if (!route.open) {
      created.current = false;
      setEntityId("");
      setGroupId(route.param("pay_group") ?? "");
      setPeriodId("");
      setRunType("REGULAR");
      setLabel("");
      setSelected([]);
      setError(null);
      setTouched(false);
      key.current = newIdempotencyKey();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.open]);

  const groups = useMemo(
    () => lookups.payGroups.filter((g) => (g.status ?? "ACTIVE") === "ACTIVE" && (!entityId || String(g.legal_entity_id) === entityId)),
    [lookups.payGroups, entityId],
  );
  const group = lookups.payGroups.find((g) => String(g.id) === groupId);
  const groupNumber = Number(groupId) || 0;

  const periods = useApi(() => runsApi.periods(groupNumber, { status: runType === "REGULAR" ? "OPEN" : undefined }), [groupNumber, runType], {
    enabled: route.open && groupNumber > 0,
  });
  const periodList: PayPeriodOption[] = periods.data?.items ?? [];
  const periodNumber = Number(periodId) || 0;

  const preview = useApi<PopulationPreview>(() => runsApi.populationPreview(groupNumber, periodNumber), [groupNumber, periodNumber], {
    enabled: route.open && groupNumber > 0 && periodNumber > 0,
  });
  const existing = useApi(
    () => runsApi.list({ pay_group_id: groupNumber, pay_period_id: periodNumber, run_type: "REGULAR", limit: 20 }),
    [groupNumber, periodNumber],
    { enabled: route.open && groupNumber > 0 && periodNumber > 0 },
  );
  const duplicates: Run[] = (existing.data?.items ?? []).filter((r) => r.status !== "CANCELLED");

  const needsSelection = runType !== "REGULAR";
  const selectionError =
    runType === "OFF_CYCLE" && selected.length === 0
      ? "Select at least one employee."
      : runType === "FINAL_SETTLEMENT" && selected.length !== 1
        ? "Select exactly one employee."
        : null;
  const fieldErrors = {
    group: !groupNumber ? "Choose a pay group." : null,
    period: !periodNumber ? "Choose a pay period." : null,
    selection: needsSelection ? selectionError : null,
  };
  const invalid = Object.values(fieldErrors).some(Boolean);

  const toggle = (employeeId: number) =>
    setSelected((current) =>
      runType === "FINAL_SETTLEMENT" ? [employeeId] : current.includes(employeeId) ? current.filter((id) => id !== employeeId) : [...current, employeeId],
    );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (invalid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        run_type: runType,
        pay_group_id: groupNumber,
        pay_period_id: periodNumber,
        label: label.trim() || null,
        ...(needsSelection ? { employee_ids: selected } : {}),
      };
      const result = await runsApi.create(body, key.current);
      created.current = true;
      toast.success(`Pay run ${result.number} created — run the pre-checks next`);
      router.push(`/payroll/runs/${result.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "Something went wrong. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const summaryErrors = touched ? Object.values(fieldErrors).filter(Boolean) : [];

  return (
    <Modal
      open={route.open}
      onOpenChange={route.onOpenChange}
      title="New pay run"
      description="Pick the pay group and period. The run starts as a draft; nothing is calculated until you lock the inputs."
      size="md"
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={() => void route.close()}>
            Cancel
          </Button>
          <Button type="submit" form="new-run-form" loading={busy} disabled={touched && invalid}>
            Create pay run
          </Button>
        </>
      }
    >
      <form id="new-run-form" onSubmit={submit} className="space-y-4" noValidate>
        {summaryErrors.length > 0 && (
          <div role="alert" className="rounded-xl border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">
            <p className="font-medium">Fix these to continue:</p>
            <ul className="mt-1 list-disc ps-5">
              {summaryErrors.map((m) => (
                <li key={m as string}>{m}</li>
              ))}
            </ul>
          </div>
        )}
        {error && (
          <Notice tone="danger" title={error.status === 409 ? "This run can't be created" : "Couldn't create the run"}>
            {error.message}
          </Notice>
        )}

        {lookups.entities.length > 0 && (
          <Field label="Legal entity" hint="Optional: narrows the pay groups.">
            <Select
              value={entityId}
              onChange={(e) => {
                setEntityId(e.target.value);
                setGroupId("");
                setPeriodId("");
              }}
            >
              <option value="">All legal entities</option>
              {lookups.entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.legal_name || entity.code}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {lookups.loading ? (
          <Skeleton className="h-11 w-full" />
        ) : lookups.payGroups.length === 0 ? (
          <>
            <Notice tone="warning" title="Pay groups can't be listed for your role">
              Listing pay groups needs organisation read access or payroll settings access. Enter the pay group number your administrator gave you.
            </Notice>
            <Field label="Pay group number" required error={touched && fieldErrors.group ? fieldErrors.group : undefined}>
              <Input inputMode="numeric" value={groupId} onChange={(e) => setGroupId(e.target.value.replace(/\D/g, ""))} />
            </Field>
          </>
        ) : (
          <Field label="Pay group" required error={touched && fieldErrors.group ? fieldErrors.group : undefined}>
            <Select
              value={groupId}
              onChange={(e) => {
                setGroupId(e.target.value);
                setPeriodId("");
                setSelected([]);
              }}
            >
              <option value="">Choose a pay group</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} · {g.currency}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field
          label="Pay period"
          required
          error={touched && fieldErrors.period ? fieldErrors.period : undefined}
          hint={runType === "REGULAR" ? "Open periods only: a regular run needs an open period." : undefined}
        >
          <Select value={periodId} disabled={!groupNumber || periods.loading} onChange={(e) => setPeriodId(e.target.value)}>
            <option value="">{!groupNumber ? "Choose a pay group first" : periods.loading ? "Loading periods…" : periodList.length ? "Choose a period" : "No periods available"}</option>
            {periodList.map((p) => (
              <option key={p.id} value={p.id}>
                {dateRange(p.start, p.end)} · pay date {p.pay_date}
              </option>
            ))}
          </Select>
        </Field>
        {periods.error && <p className="text-sm text-danger">{periods.error.message}</p>}

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Run type</legend>
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Run type">
            {(Object.keys(TYPE_HINTS) as CreatableType[]).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={runType === t}
                onClick={() => {
                  setRunType(t);
                  setSelected([]);
                }}
                className={cn(
                  "min-h-[44px] rounded-xl border px-3 py-2 text-start text-sm transition-colors",
                  runType === t ? "border-primary bg-primary-soft font-medium" : "border-border hover:bg-surface-muted",
                )}
              >
                {RUN_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">{TYPE_HINTS[runType]}</p>
        </fieldset>

        <Field label="Label" hint={group ? `Optional. Leave empty for the standard label (period · ${group.name}).` : "Optional."}>
          <Input value={label} maxLength={150} onChange={(e) => setLabel(e.target.value)} />
        </Field>

        {duplicates.length > 0 && runType === "REGULAR" && (
          <Notice
            tone="warning"
            title="A regular run already exists for this period"
            action={
              <Link href={`/payroll/runs/${duplicates[0].id}`} className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-primary hover:underline">
                Open {duplicates[0].number} <ArrowUpRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
              </Link>
            }
          >
            {duplicates.map((d) => d.number).join(", ")}. A second regular run is allowed only when your settings permit it, and then only for selected employees.
          </Notice>
        )}

        {periodNumber > 0 && groupNumber > 0 && (
          <PopulationPreviewPanel
            loading={preview.loading}
            error={preview.error}
            data={preview.data}
            selectable={needsSelection}
            selected={selected}
            onToggle={toggle}
            selectionError={touched ? fieldErrors.selection : null}
            single={runType === "FINAL_SETTLEMENT"}
          />
        )}
      </form>
    </Modal>
  );
}

function PopulationPreviewPanel({
  loading,
  error,
  data,
  selectable,
  selected,
  onToggle,
  selectionError,
  single,
}: {
  loading: boolean;
  error: ApiError | null;
  data?: PopulationPreview;
  selectable: boolean;
  selected: number[];
  onToggle: (employeeId: number) => void;
  selectionError: string | null;
  single: boolean;
}) {
  if (loading && !data) return <Skeleton className="h-20 w-full" />;
  if (error) return <Notice tone="warning" title="Population preview unavailable">{error.message}</Notice>;
  if (!data) return null;
  const reasons = Object.entries(data.excluded_by_reason ?? {});
  return (
    <section className="rounded-2xl border border-border p-3" aria-label="Population preview">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Users className="h-4 w-4 text-muted-foreground" aria-hidden />
        Population: eligible {data.eligible} = included {data.included} + excluded {data.excluded}
      </p>
      {reasons.length > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          Excluded: {reasons.map(([code, n]) => `${EXCLUSION_LABELS[code] ?? code} × ${n}`).join(" · ")}
        </p>
      )}
      {data.included === 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-warning">
          <AlertTriangle className="h-4 w-4" aria-hidden /> Nobody would be paid by this run. Assign salaries first.
        </p>
      )}
      {selectable && (
        <div className="mt-3">
          <p className="text-sm font-medium">{single ? "Employee" : "Employees"}</p>
          {selectionError && (
            <p role="alert" className="text-sm text-danger">
              {selectionError}
            </p>
          )}
          <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto">
            {data.items.map((item) => (
              <li key={`${item.employee_id}-${item.assignment_id ?? ""}`}>
                <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-surface-muted">
                  <input
                    type={single ? "radio" : "checkbox"}
                    name="run-employees"
                    className="h-4 w-4"
                    checked={selected.includes(item.employee_id)}
                    onChange={() => onToggle(item.employee_id)}
                  />
                  <span className="text-sm">
                    {item.employee_name ?? `Employee #${item.employee_id}`}
                    {item.employee_code && <span className="ms-1.5 text-xs text-muted-foreground">{item.employee_code}</span>}
                    {item.status === "EXCLUDED" && item.exclusion_reason && (
                      <span className="ms-1.5 text-xs text-warning">({EXCLUSION_LABELS[item.exclusion_reason] ?? item.exclusion_reason})</span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
