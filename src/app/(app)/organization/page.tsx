"use client";

import { Suspense, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Building2,
  FolderTree,
  GitFork,
  Layers,
  Network,
  Plus,
  RotateCcw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Table,
  Trash2,
  Users,
  UsersRound,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";

import { RequireAccess, useCan } from "@/components/access/Can";
import { EmployeePicker, type PickedEmployee } from "@/components/shared/EmployeePicker";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { DataTable, EmptyState, ErrorState, PageHeader, SearchInput, TabPanel, Tabs } from "@/components/ui/layout";
import { Modal, useConfirm } from "@/components/ui/overlay";
import { Avatar, Badge, Card, Skeleton, StatusBadge } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api";
import { can, canBeyondSelf, companyWide } from "@/lib/access";
import { cn } from "@/lib/cn";
import { fmtDate, titleCase, todayISO } from "@/lib/format";
import { useApi, useDebounced } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";
import type { Delegation, Department, OrgHierarchy, OrgNode, SecondaryLine } from "@/lib/types";

import { EmployeeDrawer } from "../employees/EmployeeDrawer";
import { EmployeeForm } from "../employees/EmployeeForm";
import { AssignManagerModal } from "./AssignManagerModal";
import { AssignReportsModal } from "./AssignReportsModal";
import { HierarchyTable } from "./HierarchyTable";
import { OrgTreeChart } from "./OrgTreeChart";
import { OrgTreeExplorer } from "./OrgTreeExplorer";

export default function OrganizationPage() {
  return (
    <RequireAccess check={(me) => canBeyondSelf(me, P.EMPLOYEE_READ) || can(me, P.ORG_MANAGE_HIERARCHY)}>
      <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Loading organization...</div>}>
        <Organization />
      </Suspense>
    </RequireAccess>
  );
}

function Organization() {
  const params = useSearchParams();
  const router = useRouter();
  const { me, can: allowed } = useCan();
  const confirm = useConfirm();

  // Tab & View Modes
  const [tab, setTab] = useState(params.get("tab") ?? "chart");
  const [viewMode, setViewMode] = useState<"visual" | "tree">("visual");

  // Selection & Modals
  const [selected, setSelected] = useState<number | null>(null);
  const [version, setVersion] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [initialManager, setInitialManager] = useState<PickedEmployee | null>(null);

  // Hierarchy Modals
  const [reportsManager, setReportsManager] = useState<OrgNode | null>(null);
  const [changeManagerEmp, setChangeManagerEmp] = useState<OrgNode | null>(null);

  // Filters for Org Hierarchy
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 250);
  const [departmentId, setDepartmentId] = useState<string>("");
  const [teamId, setTeamId] = useState<string>("");
  const [securityFilter, setSecurityFilter] = useState<string>("");

  // Fetch departments for employee add form
  const { data: departments } = useApi(() => api.get<Department[]>("/departments"), [], {
    enabled: allowed(P.EMPLOYEE_CREATE),
  });

  // Fetch complete dynamic in-scope hierarchy
  const hierarchyParams = {
    q: debouncedSearch || undefined,
    department_id: departmentId || undefined,
    team_id: teamId || undefined,
  };

  const {
    data: hierarchy,
    error: hierarchyError,
    loading: hierarchyLoading,
    reload: reloadHierarchy,
  } = useApi(
    () => api.get<OrgHierarchy>("/org/hierarchy", { params: hierarchyParams }),
    [debouncedSearch, departmentId, teamId, version]
  );

  const canManage = hierarchy?.can_manage ?? (can(me, P.ORG_MANAGE_HIERARCHY) || can(me, P.EMPLOYEE_WRITE));

  // Filter nodes client-side if securityFilter is active
  const displayedNodes = useMemo(() => {
    if (!hierarchy?.nodes) return [];
    if (!securityFilter) return hierarchy.nodes;
    return hierarchy.nodes.filter((n) => String(n.security_tier) === securityFilter);
  }, [hierarchy?.nodes, securityFilter]);

  const displayedRoots = useMemo(() => {
    if (!hierarchy?.roots) return [];
    if (!securityFilter) return hierarchy.roots;
    // If security filter is active, roots are any displayed nodes whose manager is not in displayed set
    const dispIds = new Set(displayedNodes.map((n) => n.id));
    return displayedNodes
      .filter((n) => !n.manager_id || !dispIds.has(n.manager_id))
      .map((n) => n.id);
  }, [hierarchy?.roots, displayedNodes, securityFilter]);

  // Remove manager handler
  const handleRemoveManager = async (emp: OrgNode) => {
    const ok = await confirm({
      title: `Remove manager for ${emp.full_name}?`,
      message: `${emp.full_name} will become a root in your visible organization hierarchy. Any team members reporting to them will remain attached.`,
      confirmLabel: "Remove Manager",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.delete(`/org/employees/${emp.id}/manager`);
      toast.success(`Removed manager for ${emp.full_name}.`);
      setVersion((v) => v + 1);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const tabs = [
    { value: "chart", label: "Org chart & hierarchy" },
    { value: "table", label: "Hierarchy table" },
    { value: "secondary", label: "Secondary lines" },
    ...(can(me, P.DELEGATION_MANAGE) ? [{ value: "delegations", label: "Delegations" }] : []),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organization & Hierarchy"
        description="Dynamic company-wide and team-wise organizational hierarchy with role-based security clearances and reporting line controls."
        actions={
          <div className="flex items-center gap-2">
            {allowed(P.TEAM_READ) && (
              <Button variant="secondary" onClick={() => router.push("/teams")}>
                <UsersRound className="h-4 w-4" /> Manage teams
              </Button>
            )}
            {allowed(P.EMPLOYEE_CREATE) && (
              <Button
                onClick={() => {
                  setInitialManager(null);
                  setAddOpen(true);
                }}
              >
                <Plus className="h-4 w-4" /> Add employee
              </Button>
            )}
          </div>
        }
      />

      <Tabs tabs={tabs} value={tab} onValueChange={setTab}>
        {/* ======================= TAB 1: ORG CHART & HIERARCHY ======================= */}
        <TabPanel value="chart">
          <div className="space-y-4">
            {/* Summary KPI Cards */}
            {hierarchy && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Card className="flex items-center gap-3.5 px-4 py-3 shadow-sm border-border/80">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Users className="h-5 w-5" />
                  </div>
                  <div>
                    <span className="block text-2xl font-bold tabular-nums text-foreground">
                      {hierarchy.summary.total_employees}
                    </span>
                    <span className="block text-xs font-medium text-muted-foreground">Employees in scope</span>
                  </div>
                </Card>

                <Card className="flex items-center gap-3.5 px-4 py-3 shadow-sm border-border/80">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
                    <Network className="h-5 w-5" />
                  </div>
                  <div>
                    <span className="block text-2xl font-bold tabular-nums text-foreground">
                      {hierarchy.summary.total_managers}
                    </span>
                    <span className="block text-xs font-medium text-muted-foreground">People managers</span>
                  </div>
                </Card>

                <Card className="flex items-center gap-3.5 px-4 py-3 shadow-sm border-border/80">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/10 text-sky-500">
                    <Layers className="h-5 w-5" />
                  </div>
                  <div>
                    <span className="block text-2xl font-bold tabular-nums text-foreground">
                      {hierarchy.summary.max_depth + 1}
                    </span>
                    <span className="block text-xs font-medium text-muted-foreground">Hierarchy levels</span>
                  </div>
                </Card>

                <Card className="flex items-center gap-3.5 px-4 py-3 shadow-sm border-border/80">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <span className="block text-sm font-semibold text-foreground">Strict Bit Scopes</span>
                    <span className="block text-xs font-medium text-muted-foreground">
                      {canManage ? "Management permitted" : "Reporting tree view only"}
                    </span>
                  </div>
                </Card>
              </div>
            )}

            {/* Filter & View Mode Bar */}
            <Card className="p-3.5 shadow-sm border-border/80">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                {/* Search */}
                <div className="min-w-0 flex-1 lg:max-w-xs">
                  <SearchInput
                    value={search}
                    onChange={setSearch}
                    placeholder="Search person, code, email, role..."
                    className="w-full"
                  />
                </div>

                {/* Dropdowns */}
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={departmentId}
                    onChange={(e) => setDepartmentId(e.target.value)}
                    aria-label="Filter by department"
                    className="w-40 text-xs"
                  >
                    <option value="">All departments</option>
                    {hierarchy?.departments.map((dept) => (
                      <option key={dept.id} value={dept.id}>
                        {dept.name} ({dept.count})
                      </option>
                    ))}
                  </Select>

                  <Select
                    value={teamId}
                    onChange={(e) => setTeamId(e.target.value)}
                    aria-label="Filter by team"
                    className="w-36 text-xs"
                  >
                    <option value="">All teams</option>
                    {hierarchy?.teams.map((tm) => (
                      <option key={tm.id} value={tm.id}>
                        {tm.name} ({tm.count})
                      </option>
                    ))}
                  </Select>

                  <Select
                    value={securityFilter}
                    onChange={(e) => setSecurityFilter(e.target.value)}
                    aria-label="Filter by security level"
                    className="w-40 text-xs"
                  >
                    <option value="">All security levels</option>
                    <option value="1">L1 · Executive</option>
                    <option value="2">L2 · Operations Admin</option>
                    <option value="3">L3 · People Manager</option>
                    <option value="4">L4 · Team Lead</option>
                    <option value="5">L5 · Contributor</option>
                  </Select>

                  {(search || departmentId || teamId || securityFilter) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSearch("");
                        setDepartmentId("");
                        setTeamId("");
                        setSecurityFilter("");
                      }}
                      className="text-xs h-8 px-2 text-muted-foreground hover:text-foreground"
                    >
                      <RotateCcw className="h-3.5 w-3.5 mr-1" /> Reset
                    </Button>
                  )}
                </div>

                {/* View Mode Toggle: Visual Org Chart vs Indented Tree Explorer */}
                <div className="flex items-center rounded-xl bg-muted/60 p-1 shrink-0 self-start lg:self-auto">
                  <button
                    type="button"
                    onClick={() => setViewMode("visual")}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all cursor-pointer",
                      viewMode === "visual"
                        ? "bg-surface text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    title="Interactive Visual Org Chart with Zoom & Pan"
                  >
                    <GitFork className="h-3.5 w-3.5 text-primary" />
                    <span>Visual Chart</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("tree")}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all cursor-pointer",
                      viewMode === "tree"
                        ? "bg-surface text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    title="Indented Tree Hierarchy Explorer"
                  >
                    <FolderTree className="h-3.5 w-3.5 text-amber-500" />
                    <span>Tree Explorer</span>
                  </button>
                </div>
              </div>
            </Card>

            {/* Content Container */}
            {hierarchyLoading && !hierarchy ? (
              <Card className="p-8 space-y-4">
                <Skeleton className="h-16 w-full rounded-2xl" />
                <div className="space-y-3 ps-8">
                  <Skeleton className="h-16 w-3/4 rounded-2xl" />
                  <Skeleton className="h-16 w-3/4 rounded-2xl" />
                </div>
              </Card>
            ) : hierarchyError ? (
              <Card className="p-6">
                <ErrorState message={hierarchyError.message} onRetry={() => void reloadHierarchy()} />
              </Card>
            ) : displayedRoots.length === 0 ? (
              <Card className="p-6">
                <EmptyState
                  icon={<Network className="h-8 w-8 text-muted-foreground" />}
                  title="No employees found"
                  description="No employees match your selected filters within your permitted authorization scope."
                  action={
                    search || departmentId || teamId || securityFilter ? (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setSearch("");
                          setDepartmentId("");
                          setTeamId("");
                          setSecurityFilter("");
                        }}
                      >
                        Clear filters
                      </Button>
                    ) : undefined
                  }
                />
              </Card>
            ) : (
              <div>
                {viewMode === "visual" ? (
                  <OrgTreeChart
                    nodes={displayedNodes}
                    roots={displayedRoots}
                    canManage={canManage}
                    currentEmployeeId={me?.employee?.id}
                    highlightQuery={debouncedSearch}
                    onSelectEmployee={(id) => setSelected(id)}
                    onAssignReports={(mgr) => setReportsManager(mgr)}
                    onChangeManager={(emp) => setChangeManagerEmp(emp)}
                    onRemoveManager={(emp) => void handleRemoveManager(emp)}
                    onAddEmployee={(mgr) => {
                      setInitialManager({ id: mgr.id, full_name: mgr.full_name, position: mgr.position });
                      setAddOpen(true);
                    }}
                  />
                ) : (
                  <Card className="p-5 shadow-sm border-border/80">
                    <OrgTreeExplorer
                      nodes={displayedNodes}
                      roots={displayedRoots}
                      canManage={canManage}
                      currentEmployeeId={me?.employee?.id}
                      highlightQuery={debouncedSearch}
                      onSelectEmployee={(id) => setSelected(id)}
                      onAssignReports={(mgr) => setReportsManager(mgr)}
                      onChangeManager={(emp) => setChangeManagerEmp(emp)}
                      onRemoveManager={(emp) => void handleRemoveManager(emp)}
                      onAddEmployee={(mgr) => {
                        setInitialManager({ id: mgr.id, full_name: mgr.full_name, position: mgr.position });
                        setAddOpen(true);
                      }}
                    />
                  </Card>
                )}
              </div>
            )}
          </div>
        </TabPanel>

        {/* ======================= TAB 2: HIERARCHY MANAGEMENT TABLE ======================= */}
        <TabPanel value="table">
          <HierarchyTable
            nodes={hierarchy?.nodes ?? []}
            canManage={canManage}
            onSelectEmployee={(id) => setSelected(id)}
            onRefresh={() => setVersion((v) => v + 1)}
          />
        </TabPanel>

        {/* ======================= TAB 3: SECONDARY LINES ======================= */}
        <TabPanel value="secondary">
          <SecondaryLines />
        </TabPanel>

        {/* ======================= TAB 4: DELEGATIONS ======================= */}
        {can(me, P.DELEGATION_MANAGE) && (
          <TabPanel value="delegations">
            <Delegations />
          </TabPanel>
        )}
      </Tabs>

      {/* Employee Details Drawer */}
      <EmployeeDrawer
        employeeId={selected}
        onClose={() => setSelected(null)}
        onEdit={() => undefined}
        onChanged={() => setVersion((v) => v + 1)}
      />

      {/* Add Employee Form Modal */}
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

      {/* Assign Reports Modal */}
      <AssignReportsModal
        open={!!reportsManager}
        onOpenChange={(open) => !open && setReportsManager(null)}
        manager={reportsManager}
        allNodes={hierarchy?.nodes ?? []}
        onAssigned={() => {
          setReportsManager(null);
          setVersion((v) => v + 1);
        }}
      />

      {/* Change Manager Modal */}
      <AssignManagerModal
        open={!!changeManagerEmp}
        onOpenChange={(open) => !open && setChangeManagerEmp(null)}
        employee={changeManagerEmp}
        allNodes={hierarchy?.nodes ?? []}
        onAssigned={() => {
          setChangeManagerEmp(null);
          setVersion((v) => v + 1);
        }}
      />
    </div>
  );
}

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
        employee_id: employee.id,
        manager_id: manager.id,
        relation_type: type,
        effective_from: from,
        effective_until: until || null,
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
    if (
      !(await confirm({
        title: "End this reporting line?",
        message: `${line.employee_name} will no longer have ${line.manager_name} as ${titleCase(
          line.relation_type
        )} manager.`,
        confirmLabel: "End line",
        tone: "danger",
      }))
    )
      return;
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
        <p className="text-sm text-muted-foreground">
          Secondary managers see the employee as a direct report but never change the primary tree.
        </p>
        {canManage && (
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> Add line
          </Button>
        )}
      </div>
      <DataTable
        rows={data}
        loading={loading}
        rowKey={(l) => l.id}
        empty={
          <EmptyState
            title="No secondary reporting lines"
            description="Add functional, project or dotted-line managers when someone works with more than one lead."
          />
        }
        columns={[
          { key: "emp", header: "Employee", cell: (l) => <span className="font-medium">{l.employee_name}</span> },
          { key: "mgr", header: "Manager", cell: (l) => l.manager_name },
          { key: "type", header: "Type", cell: (l) => <Badge tone="info">{titleCase(l.relation_type)}</Badge> },
          {
            key: "dates",
            header: "Effective",
            cell: (l) =>
              `${fmtDate(l.effective_from)} → ${l.effective_until ? fmtDate(l.effective_until) : "ongoing"}`,
            hideOnMobile: true,
          },
          {
            key: "x",
            header: "",
            className: "text-right",
            cell: (l) =>
              canManage && (
                <Button size="icon" variant="ghost" aria-label="End line" onClick={() => end(l)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              ),
          },
        ]}
      />
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Add secondary reporting line"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={saving} disabled={!employee || !manager} onClick={save}>
              Add line
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Employee" required>
            <EmployeePicker value={employee} onChange={setEmployee} />
          </Field>
          <Field label="Manager" required>
            <EmployeePicker
              value={manager}
              onChange={setManager}
              excludeIds={employee ? [employee.id] : []}
            />
          </Field>
          <Field label="Relationship">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="functional">Functional manager</option>
              <option value="project">Project manager</option>
              <option value="dotted_line">Dotted-line manager</option>
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="From">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="Until" hint="Optional">
              <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
            </Field>
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
        delegate_employee_id: delegate.id,
        starts_on: starts,
        ends_on: ends,
        reason: reason || null,
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
    if (
      !(await confirm({
        title: "Revoke delegation?",
        message: `${d.delegate_name} will stop acting on ${d.delegator_name}'s approvals.`,
        confirmLabel: "Revoke",
        tone: "danger",
      }))
    )
      return;
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
        <p className="text-sm text-muted-foreground">
          Delegates can act on leave approvals routed to someone else, only within the dates you set.
        </p>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> Delegate approvals
        </Button>
      </div>
      <DataTable
        rows={data}
        loading={loading}
        rowKey={(d) => d.id}
        empty={
          <EmptyState
            title="No delegations"
            description="Going on leave? Delegate your approvals so requests don't wait for you."
          />
        }
        columns={[
          { key: "from", header: "Approvals of", cell: (d) => <span className="font-medium">{d.delegator_name}</span> },
          { key: "to", header: "Delegated to", cell: (d) => d.delegate_name },
          {
            key: "window",
            header: "Window",
            cell: (d) => `${fmtDate(d.starts_on, "d MMM")} – ${fmtDate(d.ends_on, "d MMM yyyy")}`,
          },
          {
            key: "status",
            header: "Status",
            cell: (d) => (
              <StatusBadge
                status={d.revoked ? "cancelled" : d.active ? "active" : "waiting"}
                label={d.revoked ? "Revoked" : d.active ? "Active" : "Scheduled/expired"}
              />
            ),
          },
          {
            key: "x",
            header: "",
            className: "text-right",
            cell: (d) =>
              !d.revoked && (
                <Button size="sm" variant="danger-ghost" onClick={() => revoke(d)}>
                  Revoke
                </Button>
              ),
          },
        ]}
      />
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Delegate leave approvals"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={saving} disabled={!delegate || ends < starts} onClick={save}>
              Delegate
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {companyScope && (
            <Field label="Whose approvals" hint="Leave empty to delegate your own.">
              <EmployeePicker value={delegator} onChange={setDelegator} />
            </Field>
          )}
          <Field label="Delegate to" required>
            <EmployeePicker
              value={delegate}
              onChange={setDelegate}
              source="/org/delegation-candidates"
              excludeIds={[delegator?.id ?? me?.employee?.id ?? -1]}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starts">
              <Input type="date" value={starts} onChange={(e) => setStarts(e.target.value)} />
            </Field>
            <Field label="Ends" error={ends < starts ? "Must be on or after the start" : undefined}>
              <Input type="date" value={ends} onChange={(e) => setEnds(e.target.value)} />
            </Field>
          </div>
          <Field label="Reason" hint="Optional">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Annual leave" />
          </Field>
        </div>
      </Modal>
    </Card>
  );
}
