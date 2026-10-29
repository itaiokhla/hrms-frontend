"use client";

import { useMemo, useState } from "react";
import {
  Check,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Avatar, Badge, Card } from "@/components/ui/primitives";
import { useConfirm } from "@/components/ui/overlay";
import { api, errorMessage } from "@/lib/api";
import type { OrgNode } from "@/lib/types";

import { AssignManagerModal } from "./AssignManagerModal";
import { AssignReportsModal } from "./AssignReportsModal";

interface Props {
  nodes: OrgNode[];
  canManage: boolean;
  onSelectEmployee: (id: number) => void;
  onRefresh: () => void;
}

const SECURITY_BADGES: Record<number, { tone: "primary" | "info" | "success" | "warning" | "neutral"; icon: typeof Shield }> = {
  1: { tone: "primary", icon: ShieldAlert },
  2: { tone: "info", icon: ShieldCheck },
  3: { tone: "success", icon: Shield },
  4: { tone: "warning", icon: Shield },
  5: { tone: "neutral", icon: Shield },
};

export function HierarchyTable({ nodes, canManage, onSelectEmployee, onRefresh }: Props) {
  const confirm = useConfirm();
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState<string>("ALL");
  const [secFilter, setSecFilter] = useState<string>("ALL");

  // Modals state
  const [managerModalNode, setManagerModalNode] = useState<OrgNode | null>(null);
  const [reportsModalNode, setReportsModalNode] = useState<OrgNode | null>(null);
  const [bulkAssignManagerOpen, setBulkAssignManagerOpen] = useState(false);
  const [bulkActionSaving, setBulkActionSaving] = useState(false);

  // Departments list for filter
  const departments = useMemo(() => {
    const set = new Set<string>();
    nodes.forEach((n) => {
      if (n.department) set.add(n.department);
    });
    return Array.from(set).sort();
  }, [nodes]);

  // Filtered nodes
  const filteredNodes = useMemo(() => {
    return nodes.filter((n) => {
      if (deptFilter !== "ALL" && n.department !== deptFilter) return false;
      if (secFilter !== "ALL" && String(n.security_tier) !== secFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchName = n.full_name.toLowerCase().includes(q);
        const matchPos = (n.position || "").toLowerCase().includes(q);
        const matchCode = (n.employee_code || "").toLowerCase().includes(q);
        const matchEmail = (n.email || "").toLowerCase().includes(q);
        const matchMgr = (n.manager_name || "").toLowerCase().includes(q);
        return matchName || matchPos || matchCode || matchEmail || matchMgr;
      }
      return true;
    });
  }, [nodes, deptFilter, secFilter, search]);

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredNodes.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredNodes.map((n) => n.id));
    }
  };

  const toggleSelectRow = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  };

  // Single remove manager
  const handleRemoveManager = async (emp: OrgNode) => {
    if (
      !(await confirm({
        title: "Remove Manager?",
        message: `${emp.full_name} will no longer report to ${emp.manager_name || "their current manager"} and will become a root-level node.`,
        confirmLabel: "Remove Manager",
        tone: "danger",
      }))
    )
      return;

    try {
      await api.delete(`/org/employees/${emp.id}/manager`);
      toast.success(`Removed manager for ${emp.full_name}`);
      onRefresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  // Bulk remove managers
  const handleBulkRemoveManagers = async () => {
    if (selectedIds.length === 0) return;
    if (
      !(await confirm({
        title: `Remove managers for ${selectedIds.length} employees?`,
        message: `The selected ${selectedIds.length} employees will no longer report to their managers and will become root-level nodes.`,
        confirmLabel: "Remove Managers",
        tone: "danger",
      }))
    )
      return;

    setBulkActionSaving(true);
    try {
      const res = await api.post<{ success: boolean; assigned_count: number }>(
        "/org/assign-reports",
        {
          manager_id: null,
          employee_ids: selectedIds,
        }
      );
      toast.success(`Removed manager for ${res.assigned_count} employee(s)`);
      setSelectedIds([]);
      onRefresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBulkActionSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Search & Filter Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1 max-w-md">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, role, email, code or manager..."
              className="w-full rounded-xl border border-border bg-surface pl-9 pr-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Department Filter */}
          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className="rounded-xl border border-border bg-surface px-3 py-2 text-sm focus:border-primary focus:outline-none"
          >
            <option value="ALL">All Departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>

          {/* Security Clearance Filter */}
          <select
            value={secFilter}
            onChange={(e) => setSecFilter(e.target.value)}
            className="rounded-xl border border-border bg-surface px-3 py-2 text-sm focus:border-primary focus:outline-none"
          >
            <option value="ALL">All Security Levels</option>
            <option value="1">L1 - Executive / Admin</option>
            <option value="2">L2 - Operations Admin</option>
            <option value="3">L3 - People Manager</option>
            <option value="4">L4 - Team Lead</option>
            <option value="5">L5 - Contributor</option>
          </select>
        </div>

        <div className="text-xs text-muted-foreground">
          Showing {filteredNodes.length} of {nodes.length} members
        </div>
      </div>

      {/* Floating Bulk Action Bar when items selected */}
      {canManage && selectedIds.length > 0 && (
        <div className="sticky top-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3 shadow-lg backdrop-blur-md">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
              {selectedIds.length}
            </span>
            <span className="text-sm font-semibold text-foreground">
              employee{selectedIds.length !== 1 ? "s" : ""} selected
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setBulkAssignManagerOpen(true);
              }}
            >
              <UserCheck className="mr-1.5 h-4 w-4" />
              Assign to Manager...
            </Button>
            <Button
              size="sm"
              variant="danger-ghost"
              loading={bulkActionSaving}
              onClick={handleBulkRemoveManagers}
            >
              <UserMinus className="mr-1.5 h-4 w-4" />
              Remove Managers
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds([])}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Table Card */}
      <Card className="overflow-hidden border-border/80">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {canManage && (
                  <th className="w-10 px-4 py-3 text-center">
                    <input
                      type="checkbox"
                      checked={filteredNodes.length > 0 && selectedIds.length === filteredNodes.length}
                      onChange={toggleSelectAll}
                      className="rounded border-border"
                    />
                  </th>
                )}
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Role & Dept</th>
                <th className="px-4 py-3">Security Level</th>
                <th className="px-4 py-3">Hierarchy Depth</th>
                <th className="px-4 py-3">Reporting Manager</th>
                <th className="px-4 py-3 text-center">Direct Reports</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredNodes.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 8 : 7} className="p-8 text-center text-muted-foreground">
                    No employees match your criteria.
                  </td>
                </tr>
              ) : (
                filteredNodes.map((emp) => {
                  const isSelected = selectedIds.includes(emp.id);
                  const tier = emp.security_tier || 5;
                  const secBadge = SECURITY_BADGES[tier] || SECURITY_BADGES[5];
                  const SecIcon = secBadge.icon;

                  return (
                    <tr
                      key={emp.id}
                      className={`transition-colors hover:bg-muted/40 ${isSelected ? "bg-primary/5" : ""}`}
                    >
                      {canManage && (
                        <td className="w-10 px-4 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectRow(emp.id)}
                            className="rounded border-border"
                          />
                        </td>
                      )}

                      {/* Employee details */}
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => onSelectEmployee(emp.id)}
                          className="flex items-center gap-3 text-left group"
                        >
                          <Avatar
                            name={emp.full_name}
                            src={emp.has_photo ? `/api/v1/employees/${emp.id}/photo` : null}
                            size={36}
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-foreground group-hover:text-primary transition-colors">
                                {emp.full_name}
                              </span>
                              {emp.employee_code && (
                                <span className="font-mono text-[11px] text-muted-foreground">
                                  {emp.employee_code}
                                </span>
                              )}
                            </div>
                            <span className="block truncate text-xs text-muted-foreground">
                              {emp.email || "No email"}
                            </span>
                          </div>
                        </button>
                      </td>

                      {/* Role & Dept */}
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{emp.position || "Staff"}</div>
                        <div className="text-xs text-muted-foreground">{emp.department || "No department"}</div>
                      </td>

                      {/* Security Clearance */}
                      <td className="px-4 py-3">
                        <Badge tone={secBadge.tone} className="gap-1.5 text-xs py-1">
                          <SecIcon className="h-3.5 w-3.5" />
                          <span>{emp.security_level || "L5 - Contributor"}</span>
                        </Badge>
                      </td>

                      {/* Hierarchy Depth */}
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-lg bg-surface border border-border px-2.5 py-1 text-xs font-mono font-medium">
                          {emp.level === 0 ? "Root (L0)" : `Level ${emp.level}`}
                        </span>
                      </td>

                      {/* Reporting Manager */}
                      <td className="px-4 py-3">
                        {emp.manager_name ? (
                          <div className="flex items-center gap-2">
                            <Avatar name={emp.manager_name} size={24} />
                            <span className="font-medium text-foreground">{emp.manager_name}</span>
                          </div>
                        ) : (
                          <span className="text-xs italic text-muted-foreground">None (Top Executive)</span>
                        )}
                      </td>

                      {/* Direct Reports */}
                      <td className="px-4 py-3 text-center">
                        {emp.report_count > 0 ? (
                          <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                            {emp.report_count} report{emp.report_count > 1 ? "s" : ""}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {canManage && (
                            <>
                              <Button
                                size="sm"
                                variant="secondary"
                                title="Change Manager"
                                onClick={() => setManagerModalNode(emp)}
                              >
                                <UserPlus className="h-3.5 w-3.5 sm:mr-1" />
                                <span className="hidden sm:inline">Change Mgr</span>
                              </Button>

                              <Button
                                size="sm"
                                variant="ghost"
                                title="Assign Direct Reports"
                                onClick={() => setReportsModalNode(emp)}
                              >
                                <Users className="h-3.5 w-3.5 sm:mr-1" />
                                <span className="hidden sm:inline">+ Reports</span>
                              </Button>

                              {emp.manager_id && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  title="Remove Manager"
                                  onClick={() => handleRemoveManager(emp)}
                                >
                                  <UserMinus className="h-3.5 w-3.5 text-danger" />
                                </Button>
                              )}
                            </>
                          )}

                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onSelectEmployee(emp.id)}
                            title="View Employee Profile"
                          >
                            Details
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Modal: Change Single Employee's Manager */}
      <AssignManagerModal
        open={!!managerModalNode}
        onOpenChange={(open) => !open && setManagerModalNode(null)}
        employee={managerModalNode}
        allNodes={nodes}
        onAssigned={onRefresh}
      />

      {/* Modal: Assign Reports to Manager */}
      <AssignReportsModal
        open={!!reportsModalNode}
        onOpenChange={(open) => !open && setReportsModalNode(null)}
        manager={reportsModalNode}
        allNodes={nodes}
        onAssigned={onRefresh}
      />

      {/* Modal: Bulk Assign selected employees to Manager */}
      {bulkAssignManagerOpen && (
        <AssignBulkManagerPicker
          open={bulkAssignManagerOpen}
          onOpenChange={setBulkAssignManagerOpen}
          selectedEmployeeIds={selectedIds}
          allNodes={nodes}
          onAssigned={() => {
            setSelectedIds([]);
            onRefresh();
          }}
        />
      )}
    </div>
  );
}

// Bulk assign modal picker
function AssignBulkManagerPicker({
  open,
  onOpenChange,
  selectedEmployeeIds,
  allNodes,
  onAssigned,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedEmployeeIds: number[];
  allNodes: OrgNode[];
  onAssigned: () => void;
}) {
  const [targetManagerId, setTargetManagerId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  const eligibleManagers = useMemo(() => {
    return allNodes.filter((n) => {
      if (selectedEmployeeIds.includes(n.id)) return false; // can't assign to someone being moved
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          n.full_name.toLowerCase().includes(q) ||
          (n.position || "").toLowerCase().includes(q) ||
          (n.department || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [allNodes, selectedEmployeeIds, search]);

  const handleBulkAssign = async () => {
    if (!targetManagerId) return;
    setSaving(true);
    try {
      const res = await api.post<{ success: boolean; assigned_count: number; errors?: any[] }>(
        "/org/assign-reports",
        {
          manager_id: targetManagerId,
          employee_ids: selectedEmployeeIds,
        }
      );
      toast.success(`Assigned ${res.assigned_count} employees to target manager.`);
      onOpenChange(false);
      onAssigned();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${
        open ? "visible" : "invisible pointer-events-none"
      }`}
    >
      <div className="fixed inset-0 bg-background/80 backdrop-blur-sm" onClick={() => onOpenChange(false)} />
      <div className="relative w-full max-w-lg rounded-2xl border border-border bg-surface p-6 shadow-2xl">
        <h3 className="text-lg font-semibold text-foreground">
          Assign {selectedEmployeeIds.length} Selected Employees to Manager
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Choose which manager the selected team members will report to.
        </p>

        <div className="mt-4 space-y-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search managers..."
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm focus:border-primary focus:outline-none"
          />

          <div className="max-h-60 overflow-y-auto rounded-xl border border-border divide-y divide-border">
            {eligibleManagers.map((mgr) => {
              const selected = targetManagerId === mgr.id;
              return (
                <div
                  key={mgr.id}
                  onClick={() => setTargetManagerId(mgr.id)}
                  className={`flex cursor-pointer items-center gap-3 p-3 transition-colors hover:bg-muted/50 ${
                    selected ? "bg-primary/5" : ""
                  }`}
                >
                  <div
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                      selected ? "border-primary bg-primary text-primary-foreground" : "border-border"
                    }`}
                  >
                    {selected && <Check className="h-3 w-3 stroke-[3]" />}
                  </div>
                  <Avatar name={mgr.full_name} size={32} />
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{mgr.full_name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {mgr.position || "Employee"} · {mgr.department || "No dept"} · {mgr.report_count} reports
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={saving} disabled={!targetManagerId} onClick={handleBulkAssign}>
            Confirm Assignment
          </Button>
        </div>
      </div>
    </div>
  );
}
