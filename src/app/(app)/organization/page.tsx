"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, Network, Plus, Trash2, UsersRound } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import toast from "react-hot-toast";

import { RequireAccess, useCan } from "@/components/access/Can";
import { OrgHierarchyView } from "@/components/organization/OrgHierarchy";
import { EmployeePicker, type PickedEmployee } from "@/components/shared/EmployeePicker";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { DataTable, EmptyState, PageHeader, SearchInput, TabPanel, Tabs } from "@/components/ui/layout";
import { Modal, useConfirm } from "@/components/ui/overlay";
import { Avatar, Badge, Card, Skeleton, StatusBadge } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api";
import { can, canBeyondSelf, companyWide } from "@/lib/access";
import { fmtDate, titleCase, todayISO } from "@/lib/format";
import { useApi, useDebounced } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";
import type { Delegation, Department, OrgNode, SecondaryLine } from "@/lib/types";

import { EmployeeDrawer } from "../employees/EmployeeDrawer";
import { EmployeeForm } from "../employees/EmployeeForm";

export default function OrganizationPage() {
  return (
    <RequireAccess check={(me) => canBeyondSelf(me, P.EMPLOYEE_READ) || can(me, P.ORG_MANAGE_HIERARCHY)}>
      <Suspense>
        <Organization />
      </Suspense>
    </RequireAccess>
  );
}

function Organization() {
  const params = useSearchParams();
  const router = useRouter();
  const { me, can: allowed } = useCan();
  const [tab, setTab] = useState(params.get("tab") ?? "chart");
  const [selected, setSelected] = useState<number | null>(null);
  const [version, setVersion] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [initialManager, setInitialManager] = useState<PickedEmployee | null>(null);
  const { data: departments } = useApi(() => api.get<Department[]>("/departments"), [], {
    enabled: allowed(P.EMPLOYEE_CREATE),
  });

  const tabs = [
    { value: "chart", label: "Org chart" },
    { value: "secondary", label: "Secondary lines" },
    ...(can(me, P.DELEGATION_MANAGE) ? [{ value: "delegations", label: "Delegations" }] : []),
  ];

  return (
    <div>
      <PageHeader
        title="Organization"
        description="Explore reporting lines, security responsibility and team membership without exposing anyone above your permitted scope."
        actions={
          <>
            {allowed(P.TEAM_READ) && (
              <Button variant="secondary" onClick={() => router.push("/teams")}>
                <UsersRound className="h-4 w-4" /> Manage teams
              </Button>
            )}
            {allowed(P.EMPLOYEE_CREATE) && (
              <Button onClick={() => { setInitialManager(null); setAddOpen(true); }}>
                <Plus className="h-4 w-4" /> Add employee
              </Button>
            )}
          </>
        }
      />
      <Tabs tabs={tabs} value={tab} onValueChange={setTab}>
        <TabPanel value="chart">
          <OrgHierarchyView
            version={version}
            onSelect={setSelected}
            onAddEmployee={(manager) => { setInitialManager(manager); setAddOpen(true); }}
          />
        </TabPanel>
        <TabPanel value="secondary">
          <SecondaryLines />
        </TabPanel>
        {can(me, P.DELEGATION_MANAGE) && (
          <TabPanel value="delegations">
            <Delegations />
          </TabPanel>
        )}
      </Tabs>
      <EmployeeDrawer employeeId={selected} onClose={() => setSelected(null)} onEdit={() => undefined}
        onChanged={() => setVersion((v) => v + 1)} />
      <EmployeeForm
        open={addOpen}
        onOpenChange={setAddOpen}
        employee={null}
        departments={departments ?? []}
        initialManager={initialManager}
        onSaved={(employee) => {
          setAddOpen(false);
          setInitialManager(null);
          setVersion((value) => value + 1);
          setSelected(employee.id);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ Chart */
function OrgChart({ onSelect }: { onSelect: (id: number) => void }) {
  const [q, setQ] = useState("");
  const query = useDebounced(q);
  const { data: roots, loading } = useApi(
    () => api.get<OrgNode[]>("/org/nodes", { params: { q: query || undefined } }),
    [query],
  );
  return (
    <Card className="p-4 sm:p-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput value={q} onChange={setQ} placeholder="Find a person or role" className="sm:w-80" />
        <p className="text-xs text-muted-foreground">Click a person for details · expand to load their team</p>
      </div>
      {loading && !roots && <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full sm:w-96" />)}</div>}
      {roots && roots.length === 0 && <EmptyState icon={<Network />} title="No one to show" description="There are no active employees in your scope yet." />}
      {roots && roots.length > 0 && (
        <ul className="space-y-2" role="tree" aria-label="Organization chart">
          {roots.map((node) => (
            <TreeNode key={node.id} node={node} depth={0} onSelect={onSelect} flat={!!query} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function TreeNode({ node, depth, onSelect, flat }: { node: OrgNode; depth: number; onSelect: (id: number) => void; flat?: boolean }) {
  const [open, setOpen] = useState(depth === 0 && !flat);
  const { data: children, loading } = useApi(
    () => api.get<OrgNode[]>("/org/nodes", { params: { parent_id: node.id } }),
    [node.id],
    { enabled: open && node.report_count > 0 },
  );
  const expandable = node.report_count > 0 && !flat;
  return (
    <li role="treeitem" aria-expanded={expandable ? open : undefined} className="relative">
      <motion.div
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        className="flex items-center gap-2"
      >
        {expandable ? (
          <button
            onClick={() => setOpen((o) => !o)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
            aria-label={open ? `Collapse ${node.full_name}'s team` : `Expand ${node.full_name}'s team`}
          >
            <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.2 }}>
              <ChevronRight className="h-4 w-4" />
            </motion.span>
          </button>
        ) : (
          <span className="w-7 shrink-0" />
        )}
        <button
          onClick={() => onSelect(node.id)}
          className="group flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-border bg-surface px-3 py-2.5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lift sm:max-w-md"
        >
          <Avatar name={node.full_name} src={node.has_photo ? `/api/v1/employees/${node.id}/photo` : null} size={38} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold group-hover:text-primary">{node.full_name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {node.position || "No title"}{node.department ? ` · ${node.department}` : ""}
            </span>
          </span>
          {node.report_count > 0 && (
            <Badge tone="primary" className="shrink-0">{node.report_count} report{node.report_count > 1 ? "s" : ""}</Badge>
          )}
        </button>
      </motion.div>
      <AnimatePresence initial={false}>
        {open && expandable && (
          <motion.ul
            role="group"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="ml-[13px] mt-2 space-y-2 overflow-hidden border-l-2 border-dashed border-border pl-5"
          >
            {loading && !children && <Skeleton className="h-14 w-full sm:w-96" />}
            {children?.map((child) => (
              <TreeNode key={child.id} node={child} depth={depth + 1} onSelect={onSelect} />
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </li>
  );
}

// Kept temporarily as a compatibility renderer for older embedded callers;
// the page itself uses the richer OrgHierarchyView above.
void OrgChart;

/* --------------------------------------------------------- Secondary lines */
function SecondaryLines() {
  const { me } = useCan();
  const confirm = useConfirm();
  const { data, loading, reload } = useApi(() => api.get<SecondaryLine[]>("/org/secondary-lines"), []);
  const [open, setOpen] = useState(false);
  const [employee, setEmployee] = useState<PickedEmployee | null>(null);
  const [manager, setManager] = useState<PickedEmployee | null>(null);
  const [type, setType] = useState("functional");
  const [from, setFrom] = useState(todayISO());
  const [until, setUntil] = useState("");
  const [saving, setSaving] = useState(false);
  const canManage = can(me, P.ORG_MANAGE_HIERARCHY);

  const save = async () => {
    if (!employee || !manager) return;
    setSaving(true);
    try {
      await api.post("/org/secondary-lines", {
        employee_id: employee.id, manager_id: manager.id, relation_type: type,
        effective_from: from, effective_until: until || null,
      });
      toast.success("Reporting line added");
      setOpen(false);
      setEmployee(null);
      setManager(null);
      void reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const end = async (line: SecondaryLine) => {
    if (!(await confirm({ title: "End this reporting line?", message: `${line.employee_name} will no longer have ${line.manager_name} as ${titleCase(line.relation_type)} manager.`, confirmLabel: "End line", tone: "danger" }))) return;
    try {
      await api.delete(`/org/secondary-lines/${line.id}`);
      void reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-border p-4">
        <p className="text-sm text-muted-foreground">Secondary managers see the employee as a direct report but never change the primary tree.</p>
        {canManage && <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Add line</Button>}
      </div>
      <DataTable
        rows={data}
        loading={loading}
        rowKey={(l) => l.id}
        empty={<EmptyState title="No secondary reporting lines" description="Add functional, project or dotted-line managers when someone works with more than one lead." />}
        columns={[
          { key: "emp", header: "Employee", cell: (l) => <span className="font-medium">{l.employee_name}</span> },
          { key: "mgr", header: "Manager", cell: (l) => l.manager_name },
          { key: "type", header: "Type", cell: (l) => <Badge tone="info">{titleCase(l.relation_type)}</Badge> },
          { key: "dates", header: "Effective", cell: (l) => `${fmtDate(l.effective_from)} → ${l.effective_until ? fmtDate(l.effective_until) : "ongoing"}`, hideOnMobile: true },
          { key: "x", header: "", className: "text-right", cell: (l) => canManage && (
            <Button size="icon" variant="ghost" aria-label="End line" onClick={() => end(l)}><Trash2 className="h-4 w-4" /></Button>
          ) },
        ]}
      />
      <Modal open={open} onOpenChange={setOpen} title="Add secondary reporting line"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={saving} disabled={!employee || !manager} onClick={save}>Add line</Button></>}>
        <div className="space-y-4">
          <Field label="Employee" required><EmployeePicker value={employee} onChange={setEmployee} /></Field>
          <Field label="Manager" required><EmployeePicker value={manager} onChange={setManager} excludeIds={employee ? [employee.id] : []} /></Field>
          <Field label="Relationship">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="functional">Functional manager</option>
              <option value="project">Project manager</option>
              <option value="dotted_line">Dotted-line manager</option>
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="Until" hint="Optional"><Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></Field>
          </div>
        </div>
      </Modal>
    </Card>
  );
}

/* ------------------------------------------------------------- Delegations */
function Delegations() {
  const { me } = useCan();
  const confirm = useConfirm();
  const { data, loading, reload } = useApi(() => api.get<Delegation[]>("/org/delegations"), []);
  const [open, setOpen] = useState(false);
  const [delegator, setDelegator] = useState<PickedEmployee | null>(null);
  const [delegate, setDelegate] = useState<PickedEmployee | null>(null);
  const [starts, setStarts] = useState(todayISO());
  const [ends, setEnds] = useState(todayISO());
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const companyScope = companyWide(me, P.DELEGATION_MANAGE);

  const save = async () => {
    if (!delegate) return;
    setSaving(true);
    try {
      await api.post("/org/delegations", {
        delegator_employee_id: companyScope && delegator ? delegator.id : null,
        delegate_employee_id: delegate.id, starts_on: starts, ends_on: ends, reason: reason || null,
      });
      toast.success("Approvals delegated");
      setOpen(false);
      void reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const revoke = async (d: Delegation) => {
    if (!(await confirm({ title: "Revoke delegation?", message: `${d.delegate_name} will stop acting on ${d.delegator_name}'s approvals.`, confirmLabel: "Revoke", tone: "danger" }))) return;
    try {
      await api.delete(`/org/delegations/${d.id}`);
      void reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-border p-4">
        <p className="text-sm text-muted-foreground">Delegates can act on leave approvals routed to someone else, only within the dates you set.</p>
        <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Delegate approvals</Button>
      </div>
      <DataTable
        rows={data}
        loading={loading}
        rowKey={(d) => d.id}
        empty={<EmptyState title="No delegations" description="Going on leave? Delegate your approvals so requests don't wait for you." />}
        columns={[
          { key: "from", header: "Approvals of", cell: (d) => <span className="font-medium">{d.delegator_name}</span> },
          { key: "to", header: "Delegated to", cell: (d) => d.delegate_name },
          { key: "window", header: "Window", cell: (d) => `${fmtDate(d.starts_on, "d MMM")} – ${fmtDate(d.ends_on, "d MMM yyyy")}` },
          { key: "status", header: "Status", cell: (d) => <StatusBadge status={d.revoked ? "cancelled" : d.active ? "active" : "waiting"} label={d.revoked ? "Revoked" : d.active ? "Active" : "Scheduled/expired"} /> },
          { key: "x", header: "", className: "text-right", cell: (d) => !d.revoked && (
            <Button size="sm" variant="danger-ghost" onClick={() => revoke(d)}>Revoke</Button>
          ) },
        ]}
      />
      <Modal open={open} onOpenChange={setOpen} title="Delegate leave approvals"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={saving} disabled={!delegate || ends < starts} onClick={save}>Delegate</Button></>}>
        <div className="space-y-4">
          {companyScope && (
            <Field label="Whose approvals" hint="Leave empty to delegate your own.">
              <EmployeePicker value={delegator} onChange={setDelegator} />
            </Field>
          )}
          <Field label="Delegate to" required>
            <EmployeePicker value={delegate} onChange={setDelegate} source="/org/delegation-candidates"
              excludeIds={[delegator?.id ?? me?.employee?.id ?? -1]} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starts"><Input type="date" value={starts} onChange={(e) => setStarts(e.target.value)} /></Field>
            <Field label="Ends" error={ends < starts ? "Must be on or after the start" : undefined}>
              <Input type="date" value={ends} onChange={(e) => setEnds(e.target.value)} />
            </Field>
          </div>
          <Field label="Reason" hint="Optional"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Annual leave" /></Field>
        </div>
      </Modal>
    </Card>
  );
}

