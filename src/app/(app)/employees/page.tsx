"use client";

import { Download, Plus, Users } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

import { Can, RequireAccess, useCan } from "@/components/access/Can";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { DataTable, EmptyState, Pagination, PageHeader, SearchInput, type Column } from "@/components/ui/layout";
import { Avatar, Badge, Card, StatusBadge } from "@/components/ui/primitives";
import { api, downloadFile, errorMessage } from "@/lib/api";
import { canBeyondSelf } from "@/lib/access";
import { fmtDate } from "@/lib/format";
import { useApi, useDebounced } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";
import type { Department, Employee, Page } from "@/lib/types";

import { EmployeeDrawer } from "./EmployeeDrawer";
import { EmployeeForm } from "./EmployeeForm";

const LIMIT = 25;

export default function EmployeesPage() {
  return (
    <RequireAccess check={(me) => canBeyondSelf(me, P.EMPLOYEE_READ)}>
      <Directory />
    </RequireAccess>
  );
}

function Directory() {
  const { can } = useCan();
  const [q, setQ] = useState("");
  const [department, setDepartment] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [skip, setSkip] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const query = useDebounced(q);

  const { data, loading, reload } = useApi(
    () =>
      api.get<Page<Employee>>("/employees", {
        params: { q: query || undefined, department_id: department || undefined, include_inactive: includeInactive, skip, limit: LIMIT },
      }),
    [query, department, includeInactive, skip],
  );
  const { data: departments } = useApi(() => api.get<Department[]>("/departments"), []);

  const columns: Column<Employee>[] = [
    {
      key: "name",
      header: "Employee",
      cell: (e) => (
        <div className="flex items-center gap-3">
          <Avatar name={e.full_name} src={e.has_photo ? `/api/v1/employees/${e.id}/photo` : null} size={36} />
          <div className="min-w-0">
            <p className="truncate font-medium">{e.full_name}</p>
            <p className="truncate text-xs text-muted-foreground">{e.email}</p>
          </div>
        </div>
      ),
    },
    { key: "code", header: "Code", cell: (e) => <span className="font-mono text-xs">{e.employee_code}</span>, hideOnMobile: true },
    { key: "position", header: "Role", cell: (e) => e.position || <span className="text-muted-foreground">—</span>, hideOnMobile: true },
    { key: "department", header: "Department", cell: (e) => e.department || <span className="text-muted-foreground">—</span>, hideOnMobile: true },
    { key: "manager", header: "Manager", cell: (e) => e.manager_name || <span className="text-muted-foreground">—</span>, hideOnMobile: true },
    { key: "hired", header: "Joined", cell: (e) => fmtDate(e.hire_date), hideOnMobile: true },
    {
      key: "status",
      header: "Status",
      cell: (e) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={e.is_active ? "active" : "deactivated"} label={e.is_active ? "Active" : "Inactive"} />
          {!e.has_login && <Badge>No login</Badge>}
        </div>
      ),
    },
  ];

  const exportFile = async () => {
    try {
      await downloadFile("/employees/export", "employees.xlsx");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div>
      <PageHeader
        title="Employees"
        description="Everyone you're allowed to see. Personal and salary details appear only where your access covers them."
        actions={
          <>
            {can(P.REPORT_EXPORT) && (
              <Button variant="secondary" onClick={exportFile}>
                <Download className="h-4 w-4" /> Export
              </Button>
            )}
            <Can permission={P.EMPLOYEE_CREATE}>
              <Button onClick={() => { setEditing(null); setFormOpen(true); }}>
                <Plus className="h-4 w-4" /> Add employee
              </Button>
            </Can>
          </>
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center">
          <SearchInput value={q} onChange={(v) => { setQ(v); setSkip(0); }} placeholder="Search name, email, code or role" className="flex-1" />
          <Select value={department} onChange={(e) => { setDepartment(e.target.value); setSkip(0); }} className="sm:w-52" aria-label="Department">
            <option value="">All departments</option>
            {departments?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={includeInactive} onChange={(e) => { setIncludeInactive(e.target.checked); setSkip(0); }} className="h-4 w-4 rounded accent-[hsl(var(--primary))]" />
            Include inactive
          </label>
        </div>
        <DataTable
          columns={columns}
          rows={data?.items}
          loading={loading}
          rowKey={(e) => e.id}
          onRowClick={(e) => setSelected(e.id)}
          empty={
            <EmptyState
              icon={<Users />}
              title={q ? "No matching employees" : "No employees yet"}
              description={q ? "Try a different search." : "Add your first employee to start building your organization."}
              action={can(P.EMPLOYEE_CREATE) && !q && <Button onClick={() => setFormOpen(true)}><Plus className="h-4 w-4" /> Add employee</Button>}
            />
          }
        />
        {data && <Pagination total={data.total} skip={skip} limit={LIMIT} onChange={setSkip} />}
      </Card>

      <EmployeeForm
        open={formOpen}
        onOpenChange={setFormOpen}
        employee={editing}
        departments={departments ?? []}
        onSaved={(e) => { setFormOpen(false); void reload(); setSelected(e.id); }}
      />
      <EmployeeDrawer
        employeeId={selected}
        onClose={() => setSelected(null)}
        onEdit={(e) => { setEditing(e); setFormOpen(true); }}
        onChanged={() => void reload()}
      />
    </div>
  );
}
