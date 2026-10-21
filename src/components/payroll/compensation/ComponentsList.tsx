"use client";

import { Lock, Plus, Puzzle, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { Segmented } from "@/components/branding/fields";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { DataTable, EmptyState, ErrorState, PageHeader, SearchInput, type Column } from "@/components/ui/layout";
import { Card } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";

import { compensationApi } from "./api";
import { KIND_LABEL, humanize, kindLabel, methodLabel } from "./format";
import { ToneChip } from "./shared";
import { CATEGORIES_BY_KIND, COMPONENT_KINDS, type ComponentKind, type PayComponent } from "./types";

type StatusFilter = "ACTIVE" | "ARCHIVED" | "ALL";

const linkButton = "inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:opacity-95";

/** Components list (3.8 §5.9): search, kind and category filters, status. */
export function ComponentsList() {
  const router = useRouter();
  const { can } = useCan();
  const canEdit = can(P.PAYROLL_SALARY_STRUCTURE_EDIT);
  const [status, setStatus] = useState<StatusFilter>("ACTIVE");
  const [kind, setKind] = useState("");
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [seeding, setSeeding] = useState(false);
  const { data, error, loading, reload } = useApi(() => compensationApi.listComponents({ include_archived: status !== "ACTIVE" }), [status]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data ?? []).filter(
      (c) =>
        (status === "ALL" || c.status === status) &&
        (!kind || c.kind === kind) &&
        (!category || c.category === category) &&
        (!needle || c.code.toLowerCase().includes(needle) || c.name.toLowerCase().includes(needle)),
    );
  }, [data, q, kind, category, status]);

  const categories = kind ? CATEGORIES_BY_KIND[kind as ComponentKind] ?? [] : Array.from(new Set(Object.values(CATEGORIES_BY_KIND).flat())).sort();

  const seed = async () => {
    setSeeding(true);
    try {
      await compensationApi.seedComponents();
      toast.success("Starter components added.");
      await reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSeeding(false);
    }
  };

  const columns: Column<PayComponent>[] = [
    {
      key: "code",
      header: "Component",
      primary: true,
      cell: (c) => (
        <div className="min-w-0">
          <p className="font-medium">{c.name}</p>
          <bdi dir="ltr" className="font-mono text-xs text-muted-foreground">
            {c.code}
          </bdi>
        </div>
      ),
    },
    { key: "kind", header: "Kind", cell: (c) => kindLabel(c.kind) },
    { key: "category", header: "Category", cell: (c) => humanize(c.category), hideOnMobile: true },
    { key: "method", header: "Calculation", cell: (c) => methodLabel(c.current_version?.calc_method) },
    {
      key: "owner",
      header: "Owner",
      hideOnMobile: true,
      cell: (c) =>
        c.read_only ? (
          <span className="inline-flex items-center gap-1 text-sm">
            <Lock className="h-3.5 w-3.5" aria-hidden /> {c.owner} pack
          </span>
        ) : (
          "Company"
        ),
    },
    {
      key: "status",
      header: "Status",
      cell: (c) => (c.status === "ARCHIVED" ? <ToneChip label="Archived" tone="neutral" glossary="Can't be added to structures; existing salaries keep their version." /> : <ToneChip label="Active" tone="success" />),
    },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Compensation"
        title="Components"
        description="The building blocks of pay: earnings, deductions and contributions, each with its calculation, proration and payslip display."
        actions={
          canEdit && (
            <Link href="/payroll/components/new" className={linkButton}>
              <Plus className="h-4 w-4" aria-hidden /> New component
            </Link>
          )
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-border/70 p-4 lg:flex-row lg:items-end">
          <SearchInput value={q} onChange={setQ} placeholder="Search code or name" className="lg:w-72" />
          <label className="space-y-1.5 text-[13px] font-medium">
            <span>Kind</span>
            <Select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setCategory("");
              }}
            >
              <option value="">All kinds</option>
              {COMPONENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          </label>
          <label className="space-y-1.5 text-[13px] font-medium">
            <span>Category</span>
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {humanize(c)}
                </option>
              ))}
            </Select>
          </label>
          <Segmented<StatusFilter>
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              { value: "ACTIVE", label: "Active" },
              { value: "ARCHIVED", label: "Archived" },
              { value: "ALL", label: "All" },
            ]}
          />
        </div>
        <p className="px-4 pt-3 text-xs text-muted-foreground">Whether a component is used by a structure or a salary is shown on its page (the list API doesn&apos;t report usage yet).</p>
        {error ? (
          <ErrorState message={error.message} onRetry={reload} />
        ) : (
          <DataTable
            caption="Pay components"
            columns={columns}
            rows={rows}
            loading={loading}
            rowKey={(c) => c.id}
            onRowClick={(c) => router.push(`/payroll/components/${encodeURIComponent(c.code)}`)}
            cardBelowMd
            empty={
              data && data.length ? (
                <EmptyState title="No components match" description="Change the search or the filters." />
              ) : (
                <EmptyState
                  icon={<Puzzle />}
                  title="No components yet"
                  description="Start from the common set (basic, HRA, allowances, balancing) or create your own."
                  action={
                    canEdit && (
                      <div className="flex flex-wrap justify-center gap-2">
                        <Button onClick={seed} loading={seeding} className="min-h-[44px]">
                          <Sparkles className="h-4 w-4" aria-hidden /> Add starter components
                        </Button>
                        <Link href="/payroll/components/new" className="inline-flex min-h-[44px] items-center rounded-xl border border-border px-4 text-sm font-medium">
                          New component
                        </Link>
                      </div>
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
