"use client";

import { CalendarCheck2, Plus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { DataTable, EmptyState, ErrorState, PageHeader, Pagination, SearchInput, type Column } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Badge, Card, Skeleton } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useApi, useDebounced } from "@/lib/hooks";
import { workWeeksApi, type Kind, type Template, type WorkWeek, type WorkWeekDetail } from "@/lib/holiday/api";
import { useModalRoute } from "@/lib/useModalRoute";

import { WorkWeekEditor, type EntityOption } from "./WorkWeekEditor";

export const WORK_WEEK_MODAL = "work-week";

function usedBy(row: WorkWeek): string {
  const parts = [];
  if (row.used_by.branches) parts.push(`${row.used_by.branches} br`);
  if (row.used_by.criteria) parts.push(`crit ${row.used_by.criteria}`);
  parts.push(`${row.used_by.employees} people`);
  return parts.join(" · ");
}

/** Shared data of the editor: templates, legal entities, local today. */
export function useEditorData() {
  const templates = useApi(() => workWeeksApi.templates(), []);
  const entities = useApi(() => api.get<EntityOption[]>("/legal-entities").catch(() => [] as EntityOption[]), []);
  return { templates: templates.data ?? ([] as Template[]), entities: entities.data ?? ([] as EntityOption[]), ready: !!templates.data };
}

/**
 * Holidays › Work weeks (09-ui-ux/02 §19; 04-holiday/03 §5.10). The list shows kind, rules summary, versions,
 * users and the next scheduled change; `?modal=work-week` (no id) creates a pattern, the full-page twin is
 * /holidays/work-weeks/new and every row opens the pattern detail.
 */
export function WorkWeeksPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"" | Kind>("");
  const [status, setStatus] = useState<"ACTIVE" | "INACTIVE" | "">("ACTIVE");
  const [sort, setSort] = useState<string | undefined>("code");
  const [skip, setSkip] = useState(0);
  const [limit, setLimit] = useState(25);
  const query = useDebounced(q, 300);
  const [dirty, setDirty] = useState(false);
  const modal = useModalRoute(WORK_WEEK_MODAL, { dirty });
  const { data, loading, error, reload } = useApi(
    () => workWeeksApi.list({ q: query || undefined, kind: kind || undefined, status: status || undefined, sort, skip, limit }),
    [query, kind, status, sort, skip, limit],
  );
  const editorData = useEditorData();
  useEffect(() => setSkip(0), [query, kind, status]);

  const columns: Column<WorkWeek>[] = [
    {
      key: "code",
      header: "Code",
      sortKey: "code",
      primary: true,
      cell: (r) => <span className="font-mono text-xs font-semibold">{r.code}</span>,
    },
    { key: "name", header: "Name", sortKey: "name", cell: (r) => <span className="font-medium">{r.name}</span> },
    {
      key: "kind",
      header: "Kind",
      sortKey: "kind",
      cell: (r) => <Badge tone={r.kind === "CYCLE" ? "info" : "neutral"}>{r.kind === "CYCLE" ? "Cycle" : "Weekly"}</Badge>,
    },
    { key: "summary", header: "Summary", hideOnMobile: true, cell: (r) => <span className="text-muted-foreground">{r.summary}</span> },
    { key: "owner", header: "Owner", hideOnMobile: true, cell: (r) => r.owner },
    { key: "versions", header: "Versions", hideOnMobile: true, cell: (r) => r.versions_count },
    { key: "used", header: "Used by", cell: (r) => usedBy(r) },
    {
      key: "next",
      header: "Next change",
      cell: (r) => (r.next_change ? <Badge tone="warning">{`${fmtDate(r.next_change.effective_from)} · v${r.next_change.version}`}</Badge> : "—"),
    },
    { key: "status", header: "Status", hideOnMobile: true, cell: (r) => <Badge tone={r.status === "ACTIVE" ? "success" : "neutral"} dot>{r.status === "ACTIVE" ? "Active" : "Inactive"}</Badge> },
  ];

  const canCreate = !!data?.can_create;
  const today = data?.local_today ?? new Date().toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader
        eyebrow="Holidays"
        title="Work weeks"
        description="Define which days are off for each group, and see the effect before it applies."
        actions={
          canCreate && (
            <Button onClick={() => modal.openModal()} data-testid="new-work-week">
              <Plus className="h-4 w-4" /> New work week
            </Button>
          )
        }
      />
      <Card className="p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="min-w-[14rem] flex-1">
            <SearchInput value={q} onChange={setQ} placeholder="Search code or name" />
          </div>
          <Select aria-label="Kind" className="w-36" value={kind} onChange={(e) => setKind(e.target.value as "" | Kind)}>
            <option value="">All kinds</option>
            <option value="WEEKLY">Weekly</option>
            <option value="CYCLE">Cycle</option>
          </Select>
          <Select aria-label="Status" className="w-36" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="">All statuses</option>
          </Select>
          <Button variant="ghost" size="icon" aria-label="Refresh" onClick={() => void reload()}>
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          </Button>
        </div>
        {error ? (
          <ErrorState message="Couldn't load the work weeks." onRetry={() => void reload()} />
        ) : (
          <>
            <DataTable
              caption="Work weeks"
              columns={columns}
              rows={data?.items}
              loading={loading && !data}
              busy={loading && !!data}
              rowKey={(r) => r.id}
              rowHref={(r) => `/holidays/work-weeks/${r.id}`}
              onRowClick={(r) => router.push(`/holidays/work-weeks/${r.id}`)}
              sort={sort}
              onSortChange={setSort}
              cardBelowMd
              empty={
                <EmptyState
                  icon={<CalendarCheck2 />}
                  title="No work weeks yet"
                  description="Everyone uses Monday to Friday until you add one."
                  action={canCreate ? <Button onClick={() => modal.openModal()}>New work week</Button> : undefined}
                />
              }
            />
            {data && (
              <Pagination total={data.total} skip={skip} limit={limit} onChange={setSkip} pageSizes={[25, 50]} onLimitChange={setLimit} />
            )}
          </>
        )}
      </Card>

      <Modal open={modal.open} onOpenChange={modal.onOpenChange} title="New work week" description="Start from a template or set the days yourself." size="xl">
        {editorData.ready ? (
          <WorkWeekEditor
            mode="create"
            templates={editorData.templates}
            entities={editorData.entities}
            today={today}
            onDirtyChange={setDirty}
            onCancel={() => void modal.close()}
            onSaved={(created: WorkWeekDetail) => {
              setDirty(false);
              router.push(`/holidays/work-weeks/${created.id}`);
            }}
          />
        ) : (
          <Skeleton className="h-96 w-full" />
        )}
      </Modal>
      <p className="mt-3 text-xs text-muted-foreground">
        Prefer a full page? <Link className="text-primary underline-offset-2 hover:underline" href="/holidays/work-weeks/new">Open the editor</Link>.
      </p>
    </div>
  );
}
