"use client";

import { FileUp, UserPlus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useCan } from "@/components/access/Can";
import { MoneyText } from "@/components/payroll/MoneyText";
import { StatusChip } from "@/components/payroll/StatusChip";
import { useModalRoute } from "@/components/payroll/useModalRoute";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { DataTable, EmptyState, ErrorState, PageHeader, Pagination, SearchInput, type Column } from "@/components/ui/layout";
import { Card } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { fmtDate } from "@/lib/format";
import { useApi, useDebounced } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";

import { compensationApi } from "./api";
import { BulkImportModal } from "./BulkImport";
import { SALARY_MODAL, SalaryChangeModal } from "./SalaryChangeModal";
import { useOrgOptions } from "./shared";
import type { CompensationFilter, CompensationListItem } from "./types";

const LIMIT = 50;
const SEGMENTS: { value: CompensationFilter; label: string }[] = [
  { value: "without", label: "Without salary" },
  { value: "with", label: "With salary" },
  { value: "scheduled", label: "Scheduled" },
  { value: "pending", label: "Pending approval" },
  { value: "draft", label: "Drafts" },
];

/** Assign Salary (3.8 §5.6): segmented With / Without / Scheduled / Pending, DataTable, assign and bulk assign. */
export function CompensationList() {
  const router = useRouter();
  const { can } = useCan();
  const canEdit = can(P.PAYROLL_COMPENSATION_EDIT);
  const [filter, setFilter] = useState<CompensationFilter>("with");
  const [q, setQ] = useState("");
  const [entity, setEntity] = useState("");
  const [offset, setOffset] = useState(0);
  const search = useDebounced(q, 300);
  const org = useOrgOptions();
  const assign = useModalRoute(SALARY_MODAL.assign, { keys: ["employee"] });
  const importModal = useModalRoute("import", { keys: ["type"] });
  const { data, error, loading, reload } = useApi(
    () => compensationApi.listCompensation({ filter, q: search.trim() || undefined, legal_entity_id: entity ? Number(entity) : undefined, limit: LIMIT, offset }),
    [filter, search, entity, offset],
  );
  const counts = data?.counts;

  const columns: Column<CompensationListItem>[] = [
    {
      key: "employee",
      header: "Employee",
      primary: true,
      cell: (r) => (
        <div>
          <p className="font-medium">{r.employee.name}</p>
          <bdi dir="ltr" className="font-mono text-xs text-muted-foreground">
            {r.employee.employee_code}
          </bdi>
        </div>
      ),
    },
    { key: "entity", header: "Entity", cell: (r) => r.legal_entity?.name ?? "—", hideOnMobile: true },
    { key: "group", header: "Pay group", cell: (r) => r.pay_group?.name ?? "—", hideOnMobile: true },
    { key: "structure", header: "Structure", cell: (r) => (r.compensation ? `${r.compensation.structure.name} v${r.compensation.structure.version}` : "—") },
    {
      key: "amount",
      header: <span className="block text-end">CTC or rate</span>,
      className: "text-end",
      cell: (r) => (r.compensation ? <MoneyText money={r.compensation.pay_basis_amount} /> : <span className="text-muted-foreground">—</span>),
    },
    { key: "from", header: "Effective from", cell: (r) => (r.compensation ? fmtDate(r.compensation.effective_from) : "—"), hideOnMobile: true },
    {
      key: "status",
      header: "Status",
      cell: (r) =>
        r.compensation ? (
          <StatusChip vocabulary="compensation" code={r.compensation.status} />
        ) : canEdit ? (
          <Button
            size="sm"
            variant="secondary"
            className="min-h-[44px] sm:min-h-[32px]"
            onClick={(e) => {
              e.stopPropagation();
              assign.openModal({ employee: r.employee.id });
            }}
          >
            Assign salary
          </Button>
        ) : (
          <span className="text-sm text-muted-foreground">No salary</span>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Compensation"
        title="Assign salary"
        description="Who has a salary in force, who doesn't, and what is scheduled or waiting for approval. People without a salary are left out of payroll with that reason, never paid zero."
        actions={
          canEdit && (
            <>
              <Button variant="secondary" onClick={() => importModal.openModal({ type: "compensation" })} className="min-h-[44px]">
                <FileUp className="h-4 w-4" aria-hidden /> Bulk assign (CSV)
              </Button>
              <Button onClick={() => assign.openModal()} className="min-h-[44px]">
                <UserPlus className="h-4 w-4" aria-hidden /> Assign salary
              </Button>
            </>
          )
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-border/70 p-4">
          <div role="radiogroup" aria-label="Show" className="flex max-w-full gap-1 overflow-x-auto rounded-2xl border border-border bg-surface-muted p-1">
            {SEGMENTS.filter((s) => s.value !== "draft" || (counts?.draft ?? 0) > 0).map((s) => {
              const on = filter === s.value;
              return (
                <button
                  key={s.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    setFilter(s.value);
                    setOffset(0);
                  }}
                  className={cn("flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl px-3.5 text-sm font-medium transition-colors sm:min-h-[36px]", on ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                >
                  {s.label}
                  {counts && (
                    <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", s.value === "without" && counts.without > 0 ? "bg-warning-soft text-warning" : "bg-muted text-muted-foreground")}>
                      {counts[s.value]}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <SearchInput
              value={q}
              onChange={(v) => {
                setQ(v);
                setOffset(0);
              }}
              placeholder="Search name or code"
              className="sm:w-72"
            />
            {org.legalEntities && org.legalEntities.length > 1 && (
              <label className="space-y-1.5 text-[13px] font-medium">
                <span>Entity</span>
                <Select
                  value={entity}
                  onChange={(e) => {
                    setEntity(e.target.value);
                    setOffset(0);
                  }}
                >
                  <option value="">All entities</option>
                  {org.legalEntities.map((le) => (
                    <option key={le.id} value={le.id}>
                      {le.name}
                    </option>
                  ))}
                </Select>
              </label>
            )}
          </div>
        </div>
        {error ? (
          <ErrorState message={error.message} onRetry={reload} />
        ) : (
          <>
            <DataTable
              caption="Employee salaries"
              columns={columns}
              rows={data?.items}
              loading={loading}
              rowKey={(r) => `${r.employee.id}-${r.compensation?.id ?? "none"}`}
              onRowClick={(r) => router.push(`/payroll/compensation/${r.employee.id}`)}
              cardBelowMd
              empty={
                <EmptyState
                  icon={<Users />}
                  title={filter === "without" ? "Everyone has a salary" : filter === "with" ? "No salaries yet" : "Nothing here"}
                  description={filter === "with" ? "Assign salaries one by one or import a CSV. They are used once approved." : filter === "without" ? "Every active, placed employee in your scope has a salary in force today." : undefined}
                  action={
                    canEdit && filter === "with" ? (
                      <Button onClick={() => assign.openModal()} className="min-h-[44px]">
                        Assign salary
                      </Button>
                    ) : undefined
                  }
                />
              }
            />
            {data && <Pagination total={data.total} skip={offset} limit={LIMIT} onChange={setOffset} />}
          </>
        )}
      </Card>
      {canEdit && (
        <>
          <SalaryChangeModal mode="assign" onSaved={reload} />
          <BulkImportModal onDone={reload} />
        </>
      )}
    </div>
  );
}
