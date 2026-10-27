"use client";

import { ClipboardList } from "lucide-react";
import { useState } from "react";

import { RequireAccess } from "@/components/access/Can";
import { Select } from "@/components/ui/field";
import { DataTable, EmptyState, Pagination, PageHeader } from "@/components/ui/layout";
import { Badge, Card } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { can } from "@/lib/access";
import { fmtDateTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";
import type { AuditEntry } from "@/lib/types";

const MODULES = ["Authentication", "Users", "Roles", "Employees", "Organization", "Attendance", "Location", "Leave", "Payroll", "Compensation", "Assets", "Holidays", "Reports", "Settings", "Company"];
const PAGE_SIZES = [25, 50];

export default function AuditLogsPage() {
  return (
    <RequireAccess check={(me) => can(me, P.AUDIT_READ)}>
      <AuditLog />
    </RequireAccess>
  );
}

function AuditLog() {
  const [module, setModule] = useState("");
  const [skip, setSkip] = useState(0);
  const [limit, setLimit] = useState(PAGE_SIZES[0]);
  // The list standard envelope (BUG-AS-55): items, total, skip, limit.
  const { data, loading } = useApi(
    () => api.get<{ total: number; items: AuditEntry[] }>("/audit-logs", { params: { module: module || undefined, skip, limit } }),
    [module, skip, limit],
  );
  return (
    <div>
      <PageHeader title="Audit log" description="An append-only record of sensitive actions in your company. Entries can't be edited or deleted." />
      <Card>
        <div className="flex items-center gap-3 border-b border-border p-4">
          <Select value={module} onChange={(e) => { setModule(e.target.value); setSkip(0); }} className="w-56" aria-label="Module">
            <option value="">All modules</option>
            {MODULES.map((m) => <option key={m} value={m}>{m}</option>)}
          </Select>
          <p className="text-sm text-muted-foreground">{data?.total ?? 0} entries</p>
        </div>
        <DataTable rows={data?.items} loading={loading} rowKey={(l) => l.id}
          empty={<EmptyState icon={<ClipboardList />} title="No entries" />}
          columns={[
            { key: "t", header: "When", cell: (l) => <span className="whitespace-nowrap text-xs">{fmtDateTime(l.created_at)}</span> },
            { key: "a", header: "Who", cell: (l) => <span className="text-xs">{l.actor_email ?? "System"}</span>, hideOnMobile: true },
            { key: "m", header: "Action", cell: (l) => <div className="flex flex-wrap gap-1"><Badge>{l.module}</Badge><Badge tone="primary">{l.action}</Badge></div> },
            { key: "d", header: "Details", cell: (l) => <span className="text-sm">{l.description}</span> },
            { key: "ip", header: "IP", cell: (l) => <span className="font-mono text-xs text-muted-foreground">{l.ip_address ?? "—"}</span>, hideOnMobile: true },
          ]} />
        {data && <Pagination total={data.total} skip={skip} limit={limit} onChange={setSkip} pageSizes={PAGE_SIZES}
          onLimitChange={(n) => { setSkip(Math.floor(skip / n) * n); setLimit(n); }} />}
      </Card>
    </div>
  );
}
