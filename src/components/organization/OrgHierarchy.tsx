"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  MoreHorizontal,
  Network,
  Plus,
  ShieldCheck,
  Unlink,
  UserCog,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { EmployeePicker, type PickedEmployee } from "@/components/shared/EmployeePicker";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, SearchInput } from "@/components/ui/layout";
import { DropdownMenu, MenuItem, MenuSeparator, Modal, useConfirm } from "@/components/ui/overlay";
import { Avatar, Badge, Card, Skeleton } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useApi, useDebounced } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";
import type { OrgHierarchy, OrgNode } from "@/lib/types";

const SECURITY_TONES: Record<number, "danger" | "warning" | "primary" | "info" | "neutral"> = {
  1: "danger",
  2: "warning",
  3: "primary",
  4: "info",
  5: "neutral",
};

function compactSecurity(level?: string) {
  if (!level) return "L5 · Contributor";
  return level.replace(" - ", " · ");
}

function directChildren(node: OrgNode, byId: Map<number, OrgNode>) {
  return (node.children_ids ?? []).map((id) => byId.get(id)).filter((child): child is OrgNode => !!child);
}

function HierarchySkeleton() {
  return (
    <div className="space-y-3 p-5 sm:p-6">
      <Skeleton className="h-20 w-full max-w-3xl rounded-2xl" />
      <div className="space-y-3 ps-8">
        <Skeleton className="h-20 w-full max-w-3xl rounded-2xl" />
        <Skeleton className="h-20 w-full max-w-3xl rounded-2xl" />
        <Skeleton className="h-20 w-full max-w-3xl rounded-2xl" />
      </div>
    </div>
  );
}

function PersonMenu({
  node,
  isSelf,
  onSelect,
  onAddReport,
  onAssignReports,
  onChangeManager,
  onRemoveManager,
}: {
  node: OrgNode;
  isSelf: boolean;
  onSelect: (id: number) => void;
  onAddReport: (manager: OrgNode) => void;
  onAssignReports: (manager: OrgNode) => void;
  onChangeManager: (employee: OrgNode) => void;
  onRemoveManager: (employee: OrgNode) => void;
}) {
  const { can } = useCan();
  return (
    <DropdownMenu
      trigger={
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          aria-label={`Actions for ${node.full_name}`}
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      }
    >
      <MenuItem icon={<UserCog />} onSelect={() => onSelect(node.id)}>View person details</MenuItem>
      {node.can_manage && (
        <>
          <MenuSeparator />
          {can(P.EMPLOYEE_CREATE) && (
            <MenuItem icon={<UserPlus />} onSelect={() => onAddReport(node)}>Add a new direct report</MenuItem>
          )}
          <MenuItem icon={<UsersRound />} onSelect={() => onAssignReports(node)}>Assign existing people</MenuItem>
          {!isSelf && (
            <>
              <MenuSeparator />
              <MenuItem icon={<Network />} onSelect={() => onChangeManager(node)}>Change manager</MenuItem>
              {node.manager_id && (
                <MenuItem icon={<Unlink />} tone="danger" onSelect={() => onRemoveManager(node)}>
                  Remove reporting line
                </MenuItem>
              )}
            </>
          )}
        </>
      )}
    </DropdownMenu>
  );
}

function TreePerson({
  node,
  byId,
  depth,
  openIds,
  onToggle,
  onSelect,
  currentEmployeeId,
  onAddReport,
  onAssignReports,
  onChangeManager,
  onRemoveManager,
}: {
  node: OrgNode;
  byId: Map<number, OrgNode>;
  depth: number;
  openIds: Set<number>;
  onToggle: (id: number) => void;
  onSelect: (id: number) => void;
  currentEmployeeId?: number;
  onAddReport: (manager: OrgNode) => void;
  onAssignReports: (manager: OrgNode) => void;
  onChangeManager: (employee: OrgNode) => void;
  onRemoveManager: (employee: OrgNode) => void;
}) {
  const children = directChildren(node, byId);
  const open = openIds.has(node.id);
  const expandable = children.length > 0;
  const isSelf = currentEmployeeId === node.id;

  return (
    <li role="treeitem" aria-level={depth + 1} aria-expanded={expandable ? open : undefined} className="relative">
      <div className="flex min-w-[340px] items-stretch gap-2 sm:min-w-[520px]">
        <button
          type="button"
          onClick={() => expandable && onToggle(node.id)}
          disabled={!expandable}
          className={cn(
            "mt-6 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors",
            expandable ? "hover:bg-muted hover:text-foreground" : "opacity-30",
          )}
          aria-label={expandable ? `${open ? "Collapse" : "Expand"} ${node.full_name}'s team` : `${node.full_name} has no reports`}
        >
          {expandable ? (open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />) : <span className="h-1.5 w-1.5 rounded-full bg-border" />}
        </button>

        <motion.div
          layout="position"
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.22 }}
          className={cn(
            "group flex min-w-0 max-w-3xl flex-1 items-center gap-3 rounded-2xl border bg-surface px-3.5 py-3 shadow-sm transition-all",
            "hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-lift",
            isSelf ? "border-primary/35 ring-1 ring-primary/10" : "border-border/80",
          )}
        >
          <button type="button" onClick={() => onSelect(node.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
            <Avatar name={node.full_name} src={node.has_photo ? `/api/v1/employees/${node.id}/photo` : null} size={44} />
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="truncate text-sm font-semibold group-hover:text-primary sm:text-[15px]">{node.full_name}</span>
                {isSelf && <Badge tone="primary">You</Badge>}
              </span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground sm:text-sm">
                {node.position || node.role_name || "No title"}{node.department ? ` · ${node.department}` : ""}
              </span>
              {!!node.teams?.length && (
                <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                  {node.teams.slice(0, 2).join(" · ")}{node.teams.length > 2 ? ` +${node.teams.length - 2}` : ""}
                </span>
              )}
              <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground md:hidden">
                <ShieldCheck className="h-3 w-3" /> {compactSecurity(node.security_level)}
              </span>
            </span>
          </button>

          <div className="hidden shrink-0 flex-col items-end gap-1.5 md:flex">
            <Badge tone={SECURITY_TONES[node.security_tier ?? 5]} className="whitespace-nowrap">
              <ShieldCheck className="h-3 w-3" /> {compactSecurity(node.security_level)}
            </Badge>
            {node.report_count > 0 && (
              <span className="text-[11px] font-medium text-muted-foreground">
                {node.report_count} direct report{node.report_count === 1 ? "" : "s"}
              </span>
            )}
          </div>

          <PersonMenu
            node={node}
            isSelf={isSelf}
            onSelect={onSelect}
            onAddReport={onAddReport}
            onAssignReports={onAssignReports}
            onChangeManager={onChangeManager}
            onRemoveManager={onRemoveManager}
          />
        </motion.div>
      </div>

      <AnimatePresence initial={false}>
        {open && children.length > 0 && (
          <motion.ul
            role="group"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="ms-4 mt-2 space-y-2 overflow-hidden border-s-2 border-dashed border-border/80 ps-5 sm:ms-4 sm:ps-7"
          >
            {children.map((child) => (
              <TreePerson
                key={child.id}
                node={child}
                byId={byId}
                depth={depth + 1}
                openIds={openIds}
                onToggle={onToggle}
                onSelect={onSelect}
                currentEmployeeId={currentEmployeeId}
                onAddReport={onAddReport}
                onAssignReports={onAssignReports}
                onChangeManager={onChangeManager}
                onRemoveManager={onRemoveManager}
              />
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </li>
  );
}

function ChangeManagerModal({
  employee,
  byId,
  onClose,
  onSaved,
}: {
  employee: OrgNode | null;
  byId: Map<number, OrgNode>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const current = employee?.manager_id ? byId.get(employee.manager_id) : null;
  const [manager, setManager] = useState<PickedEmployee | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setManager(current ? { id: current.id, full_name: current.full_name, position: current.position } : null);
  }, [employee?.id, current?.id]);

  const save = async () => {
    if (!employee || !manager) return;
    setSaving(true);
    try {
      await api.put(`/org/employees/${employee.id}/manager`, { manager_id: manager.id });
      toast.success(`${employee.full_name} now reports to ${manager.full_name}.`);
      onClose();
      onSaved();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={!!employee}
      onOpenChange={(open) => !open && onClose()}
      title={employee ? `Change ${employee.full_name}'s manager` : "Change manager"}
      description="The reporting tree and pending manager approvals update immediately."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={saving} disabled={!manager || manager.id === employee?.manager_id} onClick={() => void save()}>Save reporting line</Button>
        </>
      }
    >
      <Field label="New manager" required>
        <EmployeePicker
          value={manager}
          onChange={setManager}
          excludeIds={employee ? [employee.id, ...(employee.children_ids ?? [])] : []}
          placeholder="Find the new manager"
          allowClear={false}
        />
      </Field>
    </Modal>
  );
}

function AssignReportsModal({ manager, onClose, onSaved }: {
  manager: OrgNode | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [picked, setPicked] = useState<PickedEmployee | null>(null);
  const [selected, setSelected] = useState<PickedEmployee[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPicked(null);
    setSelected([]);
  }, [manager?.id]);

  const add = (employee: PickedEmployee | null) => {
    setPicked(null);
    if (!employee || selected.some((item) => item.id === employee.id)) return;
    setSelected((items) => [...items, employee]);
  };

  const save = async () => {
    if (!manager || selected.length === 0) return;
    setSaving(true);
    try {
      const result = await api.post<{ assigned_count: number }>("/org/assign-reports", {
        manager_id: manager.id,
        employee_ids: selected.map((employee) => employee.id),
      });
      toast.success(`${result.assigned_count} ${result.assigned_count === 1 ? "person" : "people"} assigned to ${manager.full_name}.`);
      onClose();
      onSaved();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={!!manager}
      onOpenChange={(open) => !open && onClose()}
      title={manager ? `Assign reports to ${manager.full_name}` : "Assign reports"}
      description="Add one or many existing employees. The operation is all-or-nothing if a reporting line is invalid."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={saving} disabled={selected.length === 0} onClick={() => void save()}>
            Assign {selected.length || ""} {selected.length === 1 ? "person" : "people"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Find employees" hint="Only people inside your permitted scope are searchable.">
          <EmployeePicker
            value={picked}
            onChange={add}
            excludeIds={[manager?.id ?? -1, ...selected.map((employee) => employee.id)]}
            placeholder="Search and add a person"
          />
        </Field>
        {selected.length > 0 ? (
          <ul className="space-y-2" aria-label="People to assign">
            {selected.map((employee) => (
              <li key={employee.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface-muted/60 px-3 py-2.5">
                <Avatar name={employee.full_name} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{employee.full_name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{employee.position || "No title"}</span>
                </span>
                <Button variant="ghost" size="sm" onClick={() => setSelected((items) => items.filter((item) => item.id !== employee.id))}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No employees selected yet.
          </div>
        )}
      </div>
    </Modal>
  );
}

export function OrgHierarchyView({
  version,
  onSelect,
  onAddEmployee,
}: {
  version: number;
  onSelect: (id: number) => void;
  onAddEmployee: (manager: PickedEmployee | null) => void;
}) {
  const { me, can } = useCan();
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 250);
  const [department, setDepartment] = useState("");
  const [team, setTeam] = useState("");
  const [openIds, setOpenIds] = useState<Set<number>>(new Set());
  const [changeManager, setChangeManager] = useState<OrgNode | null>(null);
  const [assignManager, setAssignManager] = useState<OrgNode | null>(null);

  const params = {
    q: q || undefined,
    department_id: department || undefined,
    team_id: team || undefined,
  };
  const { data, error, loading, reload } = useApi(
    () => api.get<OrgHierarchy>("/org/hierarchy", { params }),
    [q, department, team, version],
  );

  const byId = useMemo(() => new Map((data?.nodes ?? []).map((node) => [node.id, node])), [data?.nodes]);
  const roots = (data?.roots ?? []).map((id) => byId.get(id)).filter((node): node is OrgNode => !!node);
  const expandableIds = useMemo(
    () => (data?.nodes ?? []).filter((node) => (node.children_ids?.length ?? 0) > 0).map((node) => node.id),
    [data?.nodes],
  );

  useEffect(() => {
    if (!data) return;
    setOpenIds((current) => {
      const next = new Set([...current].filter((id) => byId.has(id)));
      data.roots.forEach((id) => next.add(id));
      return next;
    });
  }, [data, byId]);

  const removeManager = async (employee: OrgNode) => {
    const ok = await confirm({
      title: `Remove ${employee.full_name}'s manager?`,
      message: "They will become a root in your visible organization tree. Their own reports remain attached.",
      confirmLabel: "Remove reporting line",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.delete(`/org/employees/${employee.id}/manager`);
      toast.success("Reporting line removed.");
      void reload();
    } catch (caught) {
      toast.error(errorMessage(caught));
    }
  };

  const filtered = !!(q || department || team);

  return (
    <div className="space-y-4">
      {data && (
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { label: "People in view", value: data.summary.total_employees, icon: <UsersRound className="h-4 w-4" /> },
            { label: "People managers", value: data.summary.total_managers, icon: <Network className="h-4 w-4" /> },
            { label: "Hierarchy depth", value: data.summary.max_depth + 1, icon: <ShieldCheck className="h-4 w-4" /> },
          ].map((item) => (
            <Card key={item.label} className="flex items-center gap-3 px-4 py-3 shadow-sm">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-soft text-primary">{item.icon}</span>
              <span>
                <span className="block text-xl font-semibold tabular-nums">{item.value}</span>
                <span className="block text-xs text-muted-foreground">{item.label}</span>
              </span>
            </Card>
          ))}
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border/80 bg-surface-muted/35 p-4 lg:flex-row lg:items-center">
          <SearchInput value={search} onChange={setSearch} placeholder="Find a person, role, code or email" className="min-w-0 flex-1 lg:max-w-sm" />
          <div className="grid gap-2 sm:grid-cols-2 lg:ms-auto lg:flex">
            <Select value={department} onChange={(event) => setDepartment(event.target.value)} aria-label="Filter by department" className="lg:w-48">
              <option value="">All departments</option>
              {data?.departments.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.count})</option>)}
            </Select>
            <Select value={team} onChange={(event) => setTeam(event.target.value)} aria-label="Filter by team" className="lg:w-48">
              <option value="">All teams</option>
              {data?.teams.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.count})</option>)}
            </Select>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => setOpenIds(new Set(expandableIds))} disabled={expandableIds.length === 0}>
              <ChevronsUpDown className="h-4 w-4" /> Expand all
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setOpenIds(new Set(data?.roots ?? []))} disabled={expandableIds.length === 0}>
              <ChevronsDownUp className="h-4 w-4" /> Collapse
            </Button>
          </div>
        </div>

        {loading && !data ? <HierarchySkeleton /> : error ? (
          <ErrorState message={error.message} onRetry={() => void reload()} />
        ) : roots.length === 0 ? (
          <EmptyState
            icon={filtered ? <Building2 /> : <Network />}
            title={filtered ? "No people match these filters" : "No one is in the hierarchy yet"}
            description={filtered ? "Clear a filter or try a broader search." : "Add an employee and choose who they report to."}
            action={filtered ? (
              <Button variant="secondary" onClick={() => { setSearch(""); setDepartment(""); setTeam(""); }}>Clear filters</Button>
            ) : data?.can_manage && can(P.EMPLOYEE_CREATE) ? (
              <Button onClick={() => onAddEmployee(null)}><Plus className="h-4 w-4" /> Add employee</Button>
            ) : undefined}
          />
        ) : (
          <div className={cn("scrollbar-thin overflow-x-auto p-4 sm:p-6", loading && "opacity-60")} aria-busy={loading || undefined}>
            <ul role="tree" aria-label="Organization hierarchy" className="space-y-3">
              {roots.map((node) => (
                <TreePerson
                  key={node.id}
                  node={node}
                  byId={byId}
                  depth={0}
                  openIds={openIds}
                  onToggle={(id) => setOpenIds((current) => {
                    const next = new Set(current);
                    if (next.has(id)) next.delete(id); else next.add(id);
                    return next;
                  })}
                  onSelect={onSelect}
                  currentEmployeeId={me?.employee?.id}
                  onAddReport={(manager) => onAddEmployee({ id: manager.id, full_name: manager.full_name, position: manager.position })}
                  onAssignReports={setAssignManager}
                  onChangeManager={setChangeManager}
                  onRemoveManager={(employee) => void removeManager(employee)}
                />
              ))}
            </ul>
          </div>
        )}

        {data && data.nodes.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 bg-surface-muted/25 px-4 py-3 text-xs text-muted-foreground">
            <span>Security levels describe access responsibility; API scopes still enforce every record.</span>
            <span>{filtered ? `${data.nodes.length} matching people` : `${data.nodes.length} people loaded`}</span>
          </div>
        )}
      </Card>

      <ChangeManagerModal employee={changeManager} byId={byId} onClose={() => setChangeManager(null)} onSaved={() => void reload()} />
      <AssignReportsModal manager={assignManager} onClose={() => setAssignManager(null)} onSaved={() => void reload()} />
    </div>
  );
}
