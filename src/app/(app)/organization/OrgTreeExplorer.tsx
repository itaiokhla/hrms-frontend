"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  MoreHorizontal,
  Network,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Unlink,
  UserCheck,
  UserCog,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, MenuItem, MenuSeparator } from "@/components/ui/overlay";
import { Avatar, Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import type { OrgNode } from "@/lib/types";

interface Props {
  nodes: OrgNode[];
  roots: number[];
  canManage: boolean;
  currentEmployeeId?: number;
  highlightQuery?: string;
  onSelectEmployee: (id: number) => void;
  onAssignReports: (manager: OrgNode) => void;
  onChangeManager: (employee: OrgNode) => void;
  onRemoveManager: (employee: OrgNode) => void;
  onAddEmployee?: (manager: OrgNode) => void;
}

const SECURITY_CONFIG: Record<
  number,
  { label: string; tone: "primary" | "warning" | "info" | "neutral" | "danger"; icon: typeof Shield }
> = {
  1: { label: "L1 · Executive", tone: "danger", icon: ShieldAlert },
  2: { label: "L2 · Operations Admin", tone: "warning", icon: ShieldCheck },
  3: { label: "L3 · People Manager", tone: "primary", icon: ShieldCheck },
  4: { label: "L4 · Team Lead", tone: "info", icon: Shield },
  5: { label: "L5 · Contributor", tone: "neutral", icon: Shield },
};

export function OrgTreeExplorer({
  nodes,
  roots,
  canManage,
  currentEmployeeId,
  highlightQuery = "",
  onSelectEmployee,
  onAssignReports,
  onChangeManager,
  onRemoveManager,
  onAddEmployee,
}: Props) {
  const byId = useMemo(() => new Map<number, OrgNode>(nodes.map((n) => [n.id, n])), [nodes]);

  const [openIds, setOpenIds] = useState<Set<number>>(() => {
    const initial = new Set<number>(roots);
    nodes.forEach((n) => {
      if (roots.includes(n.id) || (n.manager_id && roots.includes(n.manager_id))) {
        initial.add(n.id);
      }
    });
    return initial;
  });

  const expandableIds = useMemo(
    () => nodes.filter((n) => (n.children_ids?.length ?? 0) > 0 || n.report_count > 0).map((n) => n.id),
    [nodes]
  );

  const toggleOpen = (id: number) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => setOpenIds(new Set(expandableIds));
  const collapseAll = () => setOpenIds(new Set(roots));

  const rootNodes = useMemo(
    () => roots.map((id) => byId.get(id)).filter((n): n is OrgNode => !!n),
    [roots, byId]
  );

  return (
    <div className="space-y-3">
      {/* Top Toolbar */}
      <div className="flex items-center justify-between border-b border-border/80 pb-3">
        <span className="text-xs text-muted-foreground">
          Indented hierarchy tree showing direct reporting lines and security clearance
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={expandAll}
            disabled={expandableIds.length === 0}
            className="h-8 text-xs"
          >
            <ChevronsUpDown className="h-3.5 w-3.5 mr-1" /> Expand all
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={collapseAll}
            disabled={expandableIds.length === 0}
            className="h-8 text-xs"
          >
            <ChevronsDownUp className="h-3.5 w-3.5 mr-1" /> Collapse
          </Button>
        </div>
      </div>

      {/* Tree list */}
      <ul role="tree" aria-label="Organization hierarchy tree" className="space-y-2.5">
        {rootNodes.map((node) => (
          <TreeItem
            key={node.id}
            node={node}
            byId={byId}
            depth={0}
            openIds={openIds}
            onToggle={toggleOpen}
            canManage={canManage}
            currentEmployeeId={currentEmployeeId}
            highlightQuery={highlightQuery}
            onSelectEmployee={onSelectEmployee}
            onAssignReports={onAssignReports}
            onChangeManager={onChangeManager}
            onRemoveManager={onRemoveManager}
            onAddEmployee={onAddEmployee}
          />
        ))}
      </ul>
    </div>
  );
}

function TreeItem({
  node,
  byId,
  depth,
  openIds,
  onToggle,
  canManage,
  currentEmployeeId,
  highlightQuery,
  onSelectEmployee,
  onAssignReports,
  onChangeManager,
  onRemoveManager,
  onAddEmployee,
}: {
  node: OrgNode;
  byId: Map<number, OrgNode>;
  depth: number;
  openIds: Set<number>;
  onToggle: (id: number) => void;
  canManage: boolean;
  currentEmployeeId?: number;
  highlightQuery?: string;
  onSelectEmployee: (id: number) => void;
  onAssignReports: (manager: OrgNode) => void;
  onChangeManager: (employee: OrgNode) => void;
  onRemoveManager: (employee: OrgNode) => void;
  onAddEmployee?: (manager: OrgNode) => void;
}) {
  const children = (node.children_ids ?? [])
    .map((cid) => byId.get(cid))
    .filter((c): c is OrgNode => !!c);

  const open = openIds.has(node.id);
  const expandable = children.length > 0 || node.report_count > 0;
  const isSelf = currentEmployeeId === node.id;
  const secInfo = SECURITY_CONFIG[node.security_tier ?? 5] ?? SECURITY_CONFIG[5];
  const SecIcon = secInfo.icon;

  const query = (highlightQuery || "").trim().toLowerCase();
  const isMatch =
    query.length > 0 &&
    (node.full_name.toLowerCase().includes(query) ||
      (node.position || "").toLowerCase().includes(query) ||
      (node.department || "").toLowerCase().includes(query) ||
      (node.employee_code || "").toLowerCase().includes(query));

  return (
    <li role="treeitem" aria-level={depth + 1} aria-expanded={expandable ? open : undefined} className="relative">
      <div className="flex items-center gap-2">
        {/* Expand/Collapse Toggle Arrow */}
        <button
          type="button"
          onClick={() => expandable && onToggle(node.id)}
          disabled={!expandable}
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors",
            expandable
              ? "text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
              : "opacity-25 cursor-default"
          )}
          aria-label={
            expandable ? `${open ? "Collapse" : "Expand"} ${node.full_name}` : `${node.full_name} has no reports`
          }
        >
          {expandable ? (
            open ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-border" />
          )}
        </button>

        {/* Node Row Card */}
        <div
          onClick={() => onSelectEmployee(node.id)}
          className={cn(
            "group flex min-w-0 flex-1 items-center justify-between gap-3 rounded-2xl border bg-surface px-4 py-3 shadow-sm transition-all cursor-pointer",
            "hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md",
            isSelf
              ? "border-primary/70 ring-1 ring-primary/20 bg-gradient-to-r from-primary/5 via-surface to-surface"
              : "border-border/80",
            isMatch && "ring-2 ring-amber-400 border-amber-400/90 shadow-amber-400/10 shadow-md"
          )}
        >
          {/* Left section: Avatar & Details */}
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Avatar
              name={node.full_name}
              src={node.has_photo ? `/api/v1/employees/${node.id}/photo` : null}
              size={40}
              className="shrink-0 rounded-xl"
            />

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="truncate text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                  {node.full_name}
                </span>

                {isSelf && (
                  <span className="shrink-0 rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                    You
                  </span>
                )}

                {node.employee_code && (
                  <span className="text-[10px] font-mono text-muted-foreground bg-muted/60 rounded px-1.5 py-0.2">
                    {node.employee_code}
                  </span>
                )}
              </div>

              <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                <span>{node.position || node.role_name || "Employee"}</span>
                {node.department && (
                  <>
                    <span>·</span>
                    <span className="font-medium text-foreground/80">{node.department}</span>
                  </>
                )}
                {!!node.teams?.length && (
                  <>
                    <span>·</span>
                    <span className="text-[11px] text-muted-foreground">
                      {node.teams.join(", ")}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Right section: Badges & Dropdown */}
          <div className="flex shrink-0 items-center gap-2.5">
            {/* Security clearance badge */}
            <Badge tone={secInfo.tone} className="gap-1 py-0.5 px-2.5 text-xs font-medium">
              <SecIcon className="h-3.5 w-3.5" />
              {secInfo.label}
            </Badge>

            {/* Reports count */}
            {node.report_count > 0 && (
              <span className="hidden sm:inline-flex items-center rounded-lg bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                {node.report_count} report{node.report_count === 1 ? "" : "s"}
              </span>
            )}

            {/* Actions Menu */}
            <div onClick={(e) => e.stopPropagation()}>
              <DropdownMenu
                trigger={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    aria-label={`Actions for ${node.full_name}`}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                }
              >
                <MenuItem icon={<UserCog />} onSelect={() => onSelectEmployee(node.id)}>
                  View Full Profile
                </MenuItem>
                {canManage && node.can_manage !== false && (
                  <>
                    <MenuSeparator />
                    {onAddEmployee && (
                      <MenuItem icon={<UserPlus />} onSelect={() => onAddEmployee(node)}>
                        Add Direct Report
                      </MenuItem>
                    )}
                    <MenuItem icon={<Users />} onSelect={() => onAssignReports(node)}>
                      Assign Multiple Employees
                    </MenuItem>
                    {!isSelf && (
                      <>
                        <MenuSeparator />
                        <MenuItem icon={<Network />} onSelect={() => onChangeManager(node)}>
                          Change Manager
                        </MenuItem>
                        {node.manager_id && (
                          <MenuItem
                            icon={<Unlink />}
                            tone="danger"
                            onSelect={() => onRemoveManager(node)}
                          >
                            Remove Reporting Line
                          </MenuItem>
                        )}
                      </>
                    )}
                  </>
                )}
              </DropdownMenu>
            </div>
          </div>
        </div>
      </div>

      {/* Children Subtree */}
      <AnimatePresence initial={false}>
        {open && children.length > 0 && (
          <motion.ul
            role="group"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="ms-4 mt-2 space-y-2 overflow-hidden border-s-2 border-dashed border-border/80 ps-5 sm:ms-4 sm:ps-7"
          >
            {children.map((child) => (
              <TreeItem
                key={child.id}
                node={child}
                byId={byId}
                depth={depth + 1}
                openIds={openIds}
                onToggle={onToggle}
                canManage={canManage}
                currentEmployeeId={currentEmployeeId}
                highlightQuery={highlightQuery}
                onSelectEmployee={onSelectEmployee}
                onAssignReports={onAssignReports}
                onChangeManager={onChangeManager}
                onRemoveManager={onRemoveManager}
                onAddEmployee={onAddEmployee}
              />
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </li>
  );
}
