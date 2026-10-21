"use client";

import { Layers, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { useCan } from "@/components/access/Can";
import { Segmented } from "@/components/branding/fields";
import { DataTable, EmptyState, ErrorState, PageHeader, SearchInput, type Column } from "@/components/ui/layout";
import { Card } from "@/components/ui/primitives";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";

import { compensationApi } from "./api";
import { structureTypeLabel } from "./format";
import { optionName, ToneChip, useOrgOptions } from "./shared";
import type { SalaryStructure } from "./types";

const linkButton = "inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:opacity-95";

/** Salary Structures list (3.8 §4, §5.8). */
export function StructuresList() {
  const router = useRouter();
  const { can } = useCan();
  const canEdit = can(P.PAYROLL_SALARY_STRUCTURE_EDIT);
  const [archived, setArchived] = useState<"active" | "all">("active");
  const [q, setQ] = useState("");
  const org = useOrgOptions();
  const { data, error, loading, reload } = useApi(() => compensationApi.listStructures(archived === "all"), [archived]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data ?? []).filter((s) => !needle || s.name.toLowerCase().includes(needle) || s.code.toLowerCase().includes(needle));
  }, [data, q]);

  const columns: Column<SalaryStructure>[] = [
    {
      key: "name",
      header: "Structure",
      primary: true,
      cell: (s) => (
        <div>
          <p className="font-medium">{s.name}</p>
          <bdi dir="ltr" className="font-mono text-xs text-muted-foreground">
            {s.code}
          </bdi>
        </div>
      ),
    },
    { key: "type", header: "Type", cell: (s) => structureTypeLabel(s.type) },
    { key: "currency", header: "Currency", cell: (s) => s.currency ?? "From pay group", hideOnMobile: true },
    {
      key: "versions",
      header: "Versions",
      cell: (s) => (
        <span className="inline-flex flex-wrap gap-1.5">
          {s.active_version ? <ToneChip label={`v${s.active_version} published`} tone="success" /> : <ToneChip label="Not published" tone="warning" glossary="No salary can use this structure until a version is published." />}
          {s.draft_version ? <ToneChip label={`v${s.draft_version} draft`} tone="info" /> : null}
        </span>
      ),
    },
    {
      key: "used",
      header: "Salaries",
      cell: (s) => {
        const n = Object.values(s.assignment_counts).reduce((a, b) => a + b, 0);
        return <span className="tabular-nums">{n}</span>;
      },
    },
    {
      key: "eligibility",
      header: "Eligible",
      hideOnMobile: true,
      cell: (s) => {
        const e = s.eligibility ?? {};
        const parts = [
          ...(e.legal_entity_ids ?? []).map((id) => optionName(org.legalEntities, id)),
          ...(e.grade_ids ?? []).map((id) => `grade ${optionName(org.grades, id)}`),
        ];
        return parts.length ? parts.slice(0, 3).join(" · ") + (parts.length > 3 ? ` +${parts.length - 3}` : "") : "Everyone";
      },
    },
    { key: "status", header: "Status", cell: (s) => (s.status === "ARCHIVED" ? <ToneChip label="Archived" tone="neutral" /> : <ToneChip label="Active" tone="success" />) },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Compensation"
        title="Salary structures"
        description="Templates that split a pay basis (CTC, gross or a rate) into components. Salaries use a published version."
        actions={
          canEdit && (
            <Link href="/payroll/structures/new" className={linkButton}>
              <Plus className="h-4 w-4" aria-hidden /> New structure
            </Link>
          )
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-border/70 p-4 sm:flex-row sm:items-end">
          <SearchInput value={q} onChange={setQ} placeholder="Search structures" className="sm:w-72" />
          <Segmented
            label="Show"
            value={archived}
            onChange={setArchived}
            options={[
              { value: "active", label: "Active" },
              { value: "all", label: "Include archived" },
            ]}
          />
        </div>
        {error ? (
          <ErrorState message={error.message} onRetry={reload} />
        ) : (
          <DataTable
            caption="Salary structures"
            columns={columns}
            rows={rows}
            loading={loading}
            rowKey={(s) => s.id}
            onRowClick={(s) => router.push(`/payroll/structures/${s.id}`)}
            cardBelowMd
            empty={
              data?.length ? (
                <EmptyState title="No structures match" description="Change the search." />
              ) : (
                <EmptyState
                  icon={<Layers />}
                  title="No salary structures yet"
                  description="Create components first, then a structure that combines them for a group of employees."
                  action={
                    canEdit && (
                      <Link href="/payroll/structures/new" className={linkButton}>
                        <Plus className="h-4 w-4" aria-hidden /> New structure
                      </Link>
                    )
                  }
                />
              )
            }
          />
        )}
      </Card>
    </div>
  );
}
