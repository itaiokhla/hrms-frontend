"use client";

import { useMemo, useState } from "react";
import { Check, Search, UserMinus, UserPlus, X } from "lucide-react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlay";
import { Avatar, Badge } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api";
import type { OrgNode } from "@/lib/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: OrgNode | null;
  allNodes: OrgNode[];
  onAssigned: () => void;
}

export function AssignManagerModal({ open, onOpenChange, employee, allNodes, onAssigned }: Props) {
  const [selectedManagerId, setSelectedManagerId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  // Eligible managers:
  // Cannot be the employee themselves, and cannot be any descendant of the employee (would create cycle)
  const eligibleManagers = useMemo(() => {
    if (!employee) return [];

    // Find all descendants of this employee
    const descendants = new Set<number>();
    const findChildren = (parentId: number) => {
      allNodes.forEach((n) => {
        if (n.manager_id === parentId && !descendants.has(n.id)) {
          descendants.add(n.id);
          findChildren(n.id);
        }
      });
    };
    findChildren(employee.id);

    return allNodes.filter((node) => {
      if (node.id === employee.id) return false;
      if (descendants.has(node.id)) return false; // would create cycle
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
  }, [employee, allNodes, search]);

  const handleSave = async (managerIdToSet?: number | null) => {
    if (!employee) return;
    const managerId = managerIdToSet !== undefined ? managerIdToSet : selectedManagerId;
    setSaving(true);
    try {
      await api.put(`/org/employees/${employee.id}/manager`, {
        manager_id: managerId,
      });
      if (managerId === null) {
        toast.success(`Removed manager for ${employee.full_name}`);
      } else {
        const targetMgr = allNodes.find((n) => n.id === managerId);
        toast.success(`Assigned ${employee.full_name} to report to ${targetMgr?.full_name || "Manager"}`);
      }
      onOpenChange(false);
      onAssigned();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (!employee) return null;

  return (
    <Modal
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setSelectedManagerId(null);
          setSearch("");
        }
        onOpenChange(v);
      }}
      title="Change Reporting Manager"
      footer={
        <div className="flex w-full items-center justify-between">
          <div>
            {employee.manager_id && (
              <Button
                variant="danger-ghost"
                size="sm"
                loading={saving}
                onClick={() => handleSave(null)}
              >
                <UserMinus className="mr-1.5 h-4 w-4" />
                Remove Manager (Make Root)
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              loading={saving}
              disabled={selectedManagerId === null || selectedManagerId === employee.manager_id}
              onClick={() => handleSave()}
            >
              <UserPlus className="mr-1.5 h-4 w-4" />
              Save Manager
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Employee Banner */}
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3.5">
          <Avatar name={employee.full_name} src={employee.has_photo ? `/api/v1/employees/${employee.id}/photo` : null} size={42} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">{employee.full_name}</span>
              {employee.security_level && (
                <Badge tone="info">{employee.security_level.split(" - ")[0]}</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {employee.position || "No Title"} · {employee.department || "No Department"}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Current Manager:{" "}
              <strong className="text-foreground">
                {employee.manager_name || "None (Top Root / Executive)"}
              </strong>
            </p>
          </div>
        </div>

        {/* Manager search input */}
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Select New Manager
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search eligible managers by name, role or department..."
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

        {/* List of eligible managers */}
        <div className="max-h-64 overflow-y-auto rounded-xl border border-border divide-y divide-border">
          {eligibleManagers.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No eligible managers match your search.
            </div>
          ) : (
            eligibleManagers.map((mgr) => {
              const selected = selectedManagerId === mgr.id;
              const isCurrent = employee.manager_id === mgr.id;
              return (
                <div
                  key={mgr.id}
                  onClick={() => setSelectedManagerId(mgr.id)}
                  className={`flex cursor-pointer items-center gap-3 p-3 transition-colors hover:bg-muted/50 ${selected ? "bg-primary/5" : ""
                    }`}
                >
                  <div
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface"
                      }`}
                  >
                    {selected && <Check className="h-3 w-3 stroke-[3]" />}
                  </div>

                  <Avatar name={mgr.full_name} src={mgr.has_photo ? `/api/v1/employees/${mgr.id}/photo` : null} size={36} />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{mgr.full_name}</span>
                      {isCurrent && <Badge tone="warning">Current</Badge>}
                      {mgr.report_count > 0 && (
                        <span className="text-[11px] text-muted-foreground">({mgr.report_count} reports)</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="truncate">{mgr.position || "Employee"}</span>
                      {mgr.department && (
                        <>
                          <span>·</span>
                          <span className="truncate">{mgr.department}</span>
                        </>
                      )}
                      {mgr.security_level && (
                        <>
                          <span>·</span>
                          <span className="font-medium">{mgr.security_level}</span>
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
