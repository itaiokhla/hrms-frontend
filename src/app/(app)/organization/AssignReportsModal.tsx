"use client";

import { useMemo, useState } from "react";
import { Check, Search, UserCheck, X } from "lucide-react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlay";
import { Avatar, Badge } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api";
import type { OrgNode } from "@/lib/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  manager: OrgNode | null;
  allNodes: OrgNode[];
  onAssigned: () => void;
}

export function AssignReportsModal({ open, onOpenChange, manager, allNodes, onAssigned }: Props) {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  // Eligible employees to become reports:
  // Exclude the manager themselves, and exclude anyone who would create a cycle (ancestors of manager)
  const eligibleEmployees = useMemo(() => {
    if (!manager) return [];

    // Find all ancestors of the manager to prevent cycle
    const ancestors = new Set<number>();
    let currManagerId = manager.manager_id;
    while (currManagerId) {
      ancestors.add(currManagerId);
      const parentNode = allNodes.find((n) => n.id === currManagerId);
      currManagerId = parentNode ? parentNode.manager_id : null;
    }

    return allNodes.filter((node) => {
      if (node.id === manager.id) return false;
      if (ancestors.has(node.id)) return false; // would create cycle
      if (node.manager_id === manager.id) return false; // already reports to this manager
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchName = node.full_name.toLowerCase().includes(q);
        const matchPos = (node.position || "").toLowerCase().includes(q);
        const matchDept = (node.department || "").toLowerCase().includes(q);
        const matchCode = (node.employee_code || "").toLowerCase().includes(q);
        return matchName || matchPos || matchDept || matchCode;
      }
      return true;
    });
  }, [manager, allNodes, search]);

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  };

  const selectAll = () => {
    const eligibleIds = eligibleEmployees.map((e) => e.id);
    setSelectedIds(eligibleIds);
  };

  const clearSelection = () => {
    setSelectedIds([]);
  };

  const handleSave = async () => {
    if (!manager || selectedIds.length === 0) return;
    setSaving(true);
    try {
      const res = await api.post<{ success: boolean; assigned_count: number; errors?: { employee_id: number; error: string }[] }>(
        "/org/assign-reports",
        {
          manager_id: manager.id,
          employee_ids: selectedIds,
        }
      );
      if (res.errors && res.errors.length > 0) {
        toast.error(`Assigned ${res.assigned_count} employees, but ${res.errors.length} failed.`);
      } else {
        toast.success(`Successfully assigned ${res.assigned_count} report(s) to ${manager.full_name}`);
      }
      setSelectedIds([]);
      onOpenChange(false);
      onAssigned();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (!manager) return null;

  return (
    <Modal
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setSelectedIds([]);
          setSearch("");
        }
        onOpenChange(v);
      }}
      title="Assign Reports to Manager"
      footer={
        <div className="flex w-full items-center justify-between">
          <div className="text-xs text-muted-foreground">
            {selectedIds.length} employee{selectedIds.length !== 1 ? "s" : ""} selected
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button loading={saving} disabled={selectedIds.length === 0} onClick={handleSave}>
              <UserCheck className="mr-1.5 h-4 w-4" />
              Assign {selectedIds.length > 0 ? selectedIds.length : ""} Report{selectedIds.length !== 1 ? "s" : ""}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Target Manager Banner */}
        <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 p-3.5">
          <Avatar name={manager.full_name} src={manager.has_photo ? `/api/v1/employees/${manager.id}/photo` : null} size={42} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">{manager.full_name}</span>
              <Badge tone="primary">Manager</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {manager.position || "No Title"} · {manager.department || "No Department"} · Current reports: {manager.report_count}
            </p>
          </div>
        </div>

        {/* Selection & Search controls */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Select Employees to Report to {manager.full_name}
            </label>
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={selectAll}
                className="font-medium text-primary hover:underline"
              >
                Select all ({eligibleEmployees.length})
              </button>
              {selectedIds.length > 0 && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="font-medium text-muted-foreground hover:text-foreground hover:underline"
                  >
                    Clear
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by name, role, department or code..."
              className="w-full rounded-xl border border-border bg-surface pl-9 pr-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Scrollable employee list with checkboxes */}
        <div className="max-h-72 overflow-y-auto rounded-xl border border-border divide-y divide-border">
          {eligibleEmployees.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {search ? "No eligible employees match your search." : "No eligible employees available to assign."}
            </div>
          ) : (
            eligibleEmployees.map((emp) => {
              const selected = selectedIds.includes(emp.id);
              return (
                <div
                  key={emp.id}
                  onClick={() => toggleSelect(emp.id)}
                  className={`flex cursor-pointer items-center gap-3 p-3 transition-colors hover:bg-muted/50 ${
                    selected ? "bg-primary/5" : ""
                  }`}
                >
                  <div
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
                      selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface"
                    }`}
                  >
                    {selected && <Check className="h-3.5 w-3.5 stroke-[3]" />}
                  </div>

                  <Avatar name={emp.full_name} src={emp.has_photo ? `/api/v1/employees/${emp.id}/photo` : null} size={34} />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{emp.full_name}</span>
                      {emp.employee_code && (
                        <span className="font-mono text-[11px] text-muted-foreground">({emp.employee_code})</span>
                      )}
                      {emp.security_level && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {emp.security_level.split(" - ")[0]}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="truncate">{emp.position || "Employee"}</span>
                      {emp.department && (
                        <>
                          <span>·</span>
                          <span className="truncate">{emp.department}</span>
                        </>
                      )}
                      {emp.manager_name && (
                        <>
                          <span>·</span>
                          <span className="truncate text-amber-500/90 dark:text-amber-400">Current mgr: {emp.manager_name}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </Modal>
  );
}
