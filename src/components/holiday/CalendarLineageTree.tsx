"use client";

import { motion } from "framer-motion";
import { CalendarDays, CornerDownRight, MinusCircle, Repeat } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import type { LineageNode } from "@/lib/holiday/api";

/**
 * The include graph of a calendar (09-ui-ux/02 §18 "Includes & exclusions"): the calendar at the root, its includes
 * in priority order below it, recursively (depth ≤ MAX_CALENDAR_DEPTH). A calendar reached twice (diamond) is shown
 * again but marked "also included above" and not expanded; it contributes its holidays once.
 */
export function CalendarLineageTree({ root, year, linkNodes = true }: { root: LineageNode; year: number; linkNodes?: boolean }) {
  return (
    <ul role="tree" aria-label={`Calendars ${root.code} includes`} className="space-y-1" data-testid="lineage-tree">
      <TreeNode node={root} depth={0} year={year} linkNodes={linkNodes} />
    </ul>
  );
}

function TreeNode({ node, depth, year, linkNodes }: { node: LineageNode; depth: number; year: number; linkNodes: boolean }) {
  const label = (
    <span className="font-mono text-xs font-semibold">{node.code}</span>
  );
  return (
    <motion.li
      role="treeitem"
      aria-expanded={node.children.length ? true : undefined}
      aria-level={depth + 1}
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: depth * 0.05 }}
      data-testid={`lineage-node-${node.code}`}
    >
      <div
        className={cn(
          "flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm",
          depth === 0 ? "border-primary/40 bg-primary-soft" : "border-border bg-surface",
          node.repeated && "border-dashed opacity-70",
        )}
      >
        {depth === 0 ? <CalendarDays className="h-4 w-4 text-primary" aria-hidden /> : <CornerDownRight className="h-4 w-4 text-muted-foreground" aria-hidden />}
        {linkNodes && depth > 0 ? (
          <Link href={`/holidays/calendars/${node.id}`} className="hover:underline">
            {label}
          </Link>
        ) : (
          label
        )}
        {node.name && <span className="text-muted-foreground">{node.name}</span>}
        {node.priority !== null && <Badge tone="neutral">priority {node.priority}</Badge>}
        <Badge tone="info">
          {node.own_count} own in {year}
        </Badge>
        {node.exclusions > 0 && (
          <Badge tone="warning">
            <MinusCircle className="mr-1 inline h-3 w-3" aria-hidden />
            {node.exclusions} excluded
          </Badge>
        )}
        {node.status === "INACTIVE" && <Badge tone="neutral">inactive</Badge>}
        {node.repeated && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Repeat className="h-3 w-3" aria-hidden /> also included above (counted once)
          </span>
        )}
      </div>
      {node.children.length > 0 && (
        <ul role="group" className="ml-5 mt-1 space-y-1 border-l border-dashed border-border pl-3">
          {node.children.map((child) => (
            <TreeNode key={`${node.id}-${child.id}`} node={child} depth={depth + 1} year={year} linkNodes={linkNodes} />
          ))}
        </ul>
      )}
    </motion.li>
  );
}
