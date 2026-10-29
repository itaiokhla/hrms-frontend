"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ChevronsDownUp,
  ChevronsUpDown,
  Compass,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Move,
  Network,
  RotateCcw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Unlink,
  UserCheck,
  UserCog,
  UserMinus,
  UserPlus,
  Users,
  ZoomIn,
  ZoomOut,
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

const CARD_WIDTH = 260;
const CARD_HEIGHT = 140;
const GAP_X = 48;
const GAP_Y = 72;

const HORIZ_CARD_WIDTH = 260;
const HORIZ_CARD_HEIGHT = 120;
const HORIZ_GAP_X = 80;
const HORIZ_GAP_Y = 24;

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

interface PositionedNode {
  node: OrgNode;
  x: number;
  y: number;
  width: number;
  height: number;
  children: PositionedNode[];
  parent?: PositionedNode;
  isExpanded: boolean;
}

interface TreeLayoutItem {
  node: OrgNode;
  children: TreeLayoutItem[];
  subtreeWidth: number;
  subtreeHeight: number;
}

export function OrgTreeChart({
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
  const containerRef = useRef<HTMLDivElement>(null);

  // Layout mode: 'vertical' (top-down) or 'horizontal' (left-right)
  const [orientation, setOrientation] = useState<"vertical" | "horizontal">("vertical");
  const [curveStyle, setCurveStyle] = useState<"bezier" | "stepped">("bezier");

  // Expanded nodes set
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => {
    // Default to expanding root nodes and 1st level
    const initial = new Set<number>(roots);
    nodes.forEach((n) => {
      if (roots.includes(n.id) || (n.manager_id && roots.includes(n.manager_id))) {
        initial.add(n.id);
      }
    });
    return initial;
  });

  // Pan and Zoom
  const [zoom, setZoom] = useState<number>(0.9);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 60, y: 40 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const panStart = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Node lookup map
  const byId = useMemo(() => new Map<number, OrgNode>(nodes.map((n) => [n.id, n])), [nodes]);

  // Keep expandedIds valid when nodes change
  useEffect(() => {
    setExpandedIds((prev) => {
      const next = new Set<number>();
      prev.forEach((id) => {
        if (byId.has(id)) next.add(id);
      });
      roots.forEach((id) => next.add(id));
      return next;
    });
  }, [roots, byId]);

  // Toggle node expand/collapse
  const toggleExpand = useCallback((nodeId: number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    const all = new Set<number>();
    nodes.forEach((n) => {
      if ((n.children_ids?.length ?? 0) > 0 || n.report_count > 0) {
        all.add(n.id);
      }
    });
    setExpandedIds(all);
  }, [nodes]);

  const collapseAll = useCallback(() => {
    setExpandedIds(new Set(roots));
  }, [roots]);

  // Build Layout Tree
  const { positionedNodes, boundingBox } = useMemo(() => {
    if (nodes.length === 0 || roots.length === 0) {
      return { positionedNodes: [], boundingBox: { minX: 0, minY: 0, maxX: 800, maxY: 600, width: 800, height: 600 } };
    }

    const isVert = orientation === "vertical";
    const cardW = isVert ? CARD_WIDTH : HORIZ_CARD_WIDTH;
    const cardH = isVert ? CARD_HEIGHT : HORIZ_CARD_HEIGHT;
    const gapX = isVert ? GAP_X : HORIZ_GAP_X;
    const gapY = isVert ? GAP_Y : HORIZ_GAP_Y;

    // Recursive subtree measurement
    const measureTree = (nodeId: number): TreeLayoutItem | null => {
      const node = byId.get(nodeId);
      if (!node) return null;

      const isExpanded = expandedIds.has(nodeId);
      const childIds = isExpanded ? node.children_ids ?? [] : [];
      const children: TreeLayoutItem[] = [];

      for (const cid of childIds) {
        const measuredChild = measureTree(cid);
        if (measuredChild) children.push(measuredChild);
      }

      if (isVert) {
        if (children.length === 0) {
          return { node, children, subtreeWidth: cardW, subtreeHeight: cardH };
        }
        const totalChildrenWidth =
          children.reduce((acc, c) => acc + c.subtreeWidth, 0) + (children.length - 1) * gapX;
        const maxChildHeight = Math.max(...children.map((c) => c.subtreeHeight));
        return {
          node,
          children,
          subtreeWidth: Math.max(cardW, totalChildrenWidth),
          subtreeHeight: cardH + gapY + maxChildHeight,
        };
      } else {
        // Horizontal mode
        if (children.length === 0) {
          return { node, children, subtreeWidth: cardW, subtreeHeight: cardH };
        }
        const totalChildrenHeight =
          children.reduce((acc, c) => acc + c.subtreeHeight, 0) + (children.length - 1) * gapY;
        const maxChildWidth = Math.max(...children.map((c) => c.subtreeWidth));
        return {
          node,
          children,
          subtreeWidth: cardW + gapX + maxChildWidth,
          subtreeHeight: Math.max(cardH, totalChildrenHeight),
        };
      }
    };

    // Position tree elements
    const flatPositioned: PositionedNode[] = [];

    const positionVertical = (
      item: TreeLayoutItem,
      originX: number,
      originY: number,
      parent?: PositionedNode
    ): PositionedNode => {
      const isExpanded = expandedIds.has(item.node.id);
      let nodeX: number;

      if (item.children.length === 0) {
        nodeX = originX + (item.subtreeWidth - cardW) / 2;
      } else {
        const totalChildrenWidth =
          item.children.reduce((acc, c) => acc + c.subtreeWidth, 0) + (item.children.length - 1) * gapX;
        nodeX = originX + (totalChildrenWidth - cardW) / 2;
      }

      const posNode: PositionedNode = {
        node: item.node,
        x: nodeX,
        y: originY,
        width: cardW,
        height: cardH,
        children: [],
        parent,
        isExpanded,
      };

      flatPositioned.push(posNode);

      let currentChildX = originX;
      for (const childItem of item.children) {
        const childNode = positionVertical(childItem, currentChildX, originY + cardH + gapY, posNode);
        posNode.children.push(childNode);
        currentChildX += childItem.subtreeWidth + gapX;
      }

      return posNode;
    };

    const positionHorizontal = (
      item: TreeLayoutItem,
      originX: number,
      originY: number,
      parent?: PositionedNode
    ): PositionedNode => {
      const isExpanded = expandedIds.has(item.node.id);
      let nodeY: number;

      if (item.children.length === 0) {
        nodeY = originY + (item.subtreeHeight - cardH) / 2;
      } else {
        const totalChildrenHeight =
          item.children.reduce((acc, c) => acc + c.subtreeHeight, 0) + (item.children.length - 1) * gapY;
        nodeY = originY + (totalChildrenHeight - cardH) / 2;
      }

      const posNode: PositionedNode = {
        node: item.node,
        x: originX,
        y: nodeY,
        width: cardW,
        height: cardH,
        children: [],
        parent,
        isExpanded,
      };

      flatPositioned.push(posNode);

      let currentChildY = originY;
      for (const childItem of item.children) {
        const childNode = positionHorizontal(childItem, originX + cardW + gapX, currentChildY, posNode);
        posNode.children.push(childNode);
        currentChildY += childItem.subtreeHeight + gapY;
      }

      return posNode;
    };

    // Process all roots
    let currentRootOffset = 40;
    for (const rootId of roots) {
      const measuredRoot = measureTree(rootId);
      if (!measuredRoot) continue;

      if (isVert) {
        positionVertical(measuredRoot, currentRootOffset, 40);
        currentRootOffset += measuredRoot.subtreeWidth + gapX * 1.5;
      } else {
        positionHorizontal(measuredRoot, 40, currentRootOffset);
        currentRootOffset += measuredRoot.subtreeHeight + gapY * 1.5;
      }
    }

    // Calculate bounding box
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    flatPositioned.forEach((p) => {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + p.width);
      maxY = Math.max(maxY, p.y + p.height);
    });

    if (!isFinite(minX)) {
      minX = 0;
      minY = 0;
      maxX = 800;
      maxY = 600;
    }

    return {
      positionedNodes: flatPositioned,
      boundingBox: {
        minX,
        minY,
        maxX,
        maxY,
        width: Math.max(maxX - minX + 80, 800),
        height: Math.max(maxY - minY + 80, 600),
      },
    };
  }, [nodes, roots, expandedIds, byId, orientation]);

  // Center / Fit to screen function
  const fitToScreen = useCallback(() => {
    if (!containerRef.current || positionedNodes.length === 0) return;
    const { clientWidth, clientHeight } = containerRef.current;
    if (clientWidth === 0 || clientHeight === 0) return;

    const padding = 80;
    const scaleX = (clientWidth - padding) / boundingBox.width;
    const scaleY = (clientHeight - padding) / boundingBox.height;
    const newZoom = Math.min(Math.max(Math.min(scaleX, scaleY), 0.4), 1.2);

    const centerX = (clientWidth - boundingBox.width * newZoom) / 2 - boundingBox.minX * newZoom;
    const centerY = Math.max(40, (clientHeight - boundingBox.height * newZoom) / 2 - boundingBox.minY * newZoom);

    setZoom(Number(newZoom.toFixed(2)));
    setPan({ x: Math.round(centerX), y: Math.round(centerY) });
  }, [boundingBox, positionedNodes.length]);

  // Zoom controls
  const handleZoom = (delta: number) => {
    setZoom((prev) => Math.min(Math.max(Number((prev + delta).toFixed(2)), 0.3), 1.8));
  };

  const handleReset = () => {
    setZoom(0.9);
    setPan({ x: 60, y: 40 });
  };

  // Drag pan handlers
  const handlePointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    panStart.current = { ...pan };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setPan({
      x: panStart.current.x + dx,
      y: panStart.current.y + dy,
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDragging) {
      setIsDragging(false);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

  // Mouse wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.08 : -0.08;
      handleZoom(delta);
    }
  };

  // Generate SVG path between parent and child
  const renderPath = (parent: PositionedNode, child: PositionedNode) => {
    const isVert = orientation === "vertical";

    if (isVert) {
      const startX = parent.x + parent.width / 2;
      const startY = parent.y + parent.height;
      const endX = child.x + child.width / 2;
      const endY = child.y;

      if (curveStyle === "bezier") {
        const midY = (startY + endY) / 2;
        return `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`;
      } else {
        const midY = startY + (endY - startY) / 2;
        return `M ${startX} ${startY} V ${midY} H ${endX} V ${endY}`;
      }
    } else {
      const startX = parent.x + parent.width;
      const startY = parent.y + parent.height / 2;
      const endX = child.x;
      const endY = child.y + child.height / 2;

      if (curveStyle === "bezier") {
        const midX = (startX + endX) / 2;
        return `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`;
      } else {
        const midX = startX + (endX - startX) / 2;
        return `M ${startX} ${startY} H ${midX} V ${endY} H ${endX}`;
      }
    }
  };

  return (
    <div className="relative flex h-[740px] w-full flex-col overflow-hidden rounded-2xl border border-border bg-surface-muted/20 shadow-inner">
      {/* Canvas Floating Toolbar */}
      <div className="absolute left-4 top-4 z-20 flex flex-wrap items-center gap-2 rounded-2xl border border-border/80 bg-surface/90 p-1.5 shadow-lg backdrop-blur-md">
        {/* Orientation switch */}
        <div className="flex items-center rounded-xl bg-muted/60 p-0.5">
          <button
            type="button"
            onClick={() => setOrientation("vertical")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all",
              orientation === "vertical"
                ? "bg-surface text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
            title="Vertical Tree (Top to Bottom)"
          >
            <ChevronsUpDown className="h-3.5 w-3.5" />
            <span>Vertical</span>
          </button>
          <button
            type="button"
            onClick={() => setOrientation("horizontal")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all",
              orientation === "horizontal"
                ? "bg-surface text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
            title="Horizontal Tree (Left to Right)"
          >
            <ChevronsDownUp className="h-3.5 w-3.5 rotate-90" />
            <span>Horizontal</span>
          </button>
        </div>

        <div className="h-4 w-px bg-border" />

        {/* Line Curve style */}
        <button
          type="button"
          onClick={() => setCurveStyle((s) => (s === "bezier" ? "stepped" : "bezier"))}
          className="flex items-center gap-1 rounded-xl px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/70 hover:text-foreground transition-colors"
          title={`Line style: ${curveStyle === "bezier" ? "Curved Bezier" : "Stepped Orthogonal"}`}
        >
          <Compass className="h-3.5 w-3.5" />
          <span className="capitalize">{curveStyle}</span>
        </button>

        <div className="h-4 w-px bg-border" />

        {/* Expand / Collapse All */}
        <Button variant="ghost" size="sm" onClick={expandAll} className="h-7 px-2 text-xs" title="Expand All Branches">
          <ChevronsUpDown className="h-3.5 w-3.5 mr-1" /> Expand
        </Button>
        <Button variant="ghost" size="sm" onClick={collapseAll} className="h-7 px-2 text-xs" title="Collapse to Roots">
          <ChevronsDownUp className="h-3.5 w-3.5 mr-1" /> Collapse
        </Button>
      </div>

      {/* Floating Zoom & Position Controls */}
      <div className="absolute right-4 top-4 z-20 flex items-center gap-1 rounded-2xl border border-border/80 bg-surface/90 p-1.5 shadow-lg backdrop-blur-md">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => handleZoom(0.15)}
          title="Zoom In (Ctrl + Scroll)"
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <span className="w-12 text-center text-xs font-medium tabular-nums text-muted-foreground">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => handleZoom(-0.15)}
          title="Zoom Out"
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <div className="h-4 w-px bg-border" />
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={fitToScreen} title="Fit to Screen">
          <Maximize2 className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleReset} title="Reset View">
          <RotateCcw className="h-4 w-4" />
        </Button>
      </div>

      {/* Security Legend Footer */}
      <div className="absolute bottom-3 left-4 z-20 hidden md:flex items-center gap-3 rounded-xl border border-border/70 bg-surface/85 px-3 py-1.5 shadow-sm backdrop-blur-md text-[11px] text-muted-foreground">
        <span className="font-semibold text-foreground flex items-center gap-1">
          <Shield className="h-3.5 w-3.5 text-primary" /> Security Clearance:
        </span>
        <span className="flex items-center gap-1 text-danger font-medium">● L1 Executive</span>
        <span className="flex items-center gap-1 text-amber-500 font-medium">● L2 Operations</span>
        <span className="flex items-center gap-1 text-primary font-medium">● L3 Manager</span>
        <span className="flex items-center gap-1 text-info font-medium">● L4 Lead</span>
        <span className="flex items-center gap-1 text-muted-foreground font-medium">● L5 Contributor</span>
      </div>

      {/* Instructions pill */}
      <div className="absolute bottom-3 right-4 z-20 flex items-center gap-1.5 rounded-xl border border-border/70 bg-surface/85 px-3 py-1.5 shadow-sm backdrop-blur-md text-[11px] text-muted-foreground">
        <Move className="h-3 w-3" /> Drag canvas to pan · Click card for profile · Click report badge to toggle
      </div>

      {/* Interactive Pan/Zoom Canvas */}
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        className={cn(
          "h-full w-full select-none cursor-grab active:cursor-grabbing overflow-hidden",
          isDragging && "cursor-grabbing"
        )}
      >
        <div
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
            transition: isDragging ? "none" : "transform 0.15s ease-out",
            width: boundingBox.width + 200,
            height: boundingBox.height + 200,
          }}
          className="relative will-change-transform"
        >
          {/* SVG Connector Layer */}
          <svg
            className="pointer-events-none absolute left-0 top-0 overflow-visible"
            style={{
              width: boundingBox.width + 200,
              height: boundingBox.height + 200,
            }}
          >
            <defs>
              <linearGradient id="tree-line-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.45" />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.2" />
              </linearGradient>
            </defs>

            {positionedNodes.map((pNode) => {
              if (!pNode.parent) return null;
              return (
                <path
                  key={`line-${pNode.parent.node.id}-${pNode.node.id}`}
                  d={renderPath(pNode.parent, pNode)}
                  fill="none"
                  stroke="currentColor"
                  className="text-border/90 dark:text-border/70 transition-all duration-300"
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              );
            })}
          </svg>

          {/* Node Cards */}
          {positionedNodes.map((pNode) => {
            const emp = pNode.node;
            const isSelf = currentEmployeeId === emp.id;
            const secInfo = SECURITY_CONFIG[emp.security_tier ?? 5] ?? SECURITY_CONFIG[5];
            const SecIcon = secInfo.icon;
            const hasReports = (emp.children_ids?.length ?? 0) > 0 || emp.report_count > 0;
            const isExpanded = pNode.isExpanded;
            const query = highlightQuery.trim().toLowerCase();
            const isMatch =
              query.length > 0 &&
              (emp.full_name.toLowerCase().includes(query) ||
                (emp.position || "").toLowerCase().includes(query) ||
                (emp.department || "").toLowerCase().includes(query) ||
                (emp.employee_code || "").toLowerCase().includes(query));

            return (
              <div
                key={`node-${emp.id}`}
                style={{
                  position: "absolute",
                  left: pNode.x,
                  top: pNode.y,
                  width: pNode.width,
                  height: pNode.height,
                }}
                className="group select-none"
              >
                <div
                  data-no-drag="true"
                  onClick={() => onSelectEmployee(emp.id)}
                  className={cn(
                    "relative flex h-full w-full flex-col justify-between rounded-2xl border bg-surface p-3.5 shadow-sm transition-all duration-200 cursor-pointer",
                    "hover:-translate-y-1 hover:shadow-xl hover:border-primary/40",
                    isSelf
                      ? "border-primary/80 ring-2 ring-primary/20 bg-gradient-to-br from-primary/5 via-surface to-surface"
                      : "border-border/80",
                    isMatch && "ring-2 ring-amber-400 border-amber-400/90 shadow-amber-400/10 shadow-lg"
                  )}
                >
                  {/* Top row: Avatar, Info, Action menu */}
                  <div className="flex items-start gap-2.5">
                    <Avatar
                      name={emp.full_name}
                      src={emp.has_photo ? `/api/v1/employees/${emp.id}/photo` : null}
                      size={40}
                      className="shrink-0 rounded-xl"
                    />

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                          {emp.full_name}
                        </span>
                        {isSelf && (
                          <span className="shrink-0 rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                            You
                          </span>
                        )}
                      </div>

                      <span className="block truncate text-xs text-muted-foreground mt-0.5">
                        {emp.position || emp.role_name || "Employee"}
                      </span>

                      {emp.department && (
                        <span className="block truncate text-[11px] font-medium text-muted-foreground/80">
                          {emp.department}
                        </span>
                      )}
                    </div>

                    {/* Actions Menu */}
                    <div data-no-drag="true" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu
                        trigger={
                          <button
                            type="button"
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                            aria-label={`Actions for ${emp.full_name}`}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                        }
                      >
                        <MenuItem icon={<UserCog />} onSelect={() => onSelectEmployee(emp.id)}>
                          View Full Profile
                        </MenuItem>
                        {canManage && emp.can_manage !== false && (
                          <>
                            <MenuSeparator />
                            {onAddEmployee && (
                              <MenuItem icon={<UserPlus />} onSelect={() => onAddEmployee(emp)}>
                                Add Direct Report
                              </MenuItem>
                            )}
                            <MenuItem icon={<Users />} onSelect={() => onAssignReports(emp)}>
                              Assign Multiple Employees
                            </MenuItem>
                            {!isSelf && (
                              <>
                                <MenuSeparator />
                                <MenuItem icon={<Network />} onSelect={() => onChangeManager(emp)}>
                                  Change Manager
                                </MenuItem>
                                {emp.manager_id && (
                                  <MenuItem
                                    icon={<Unlink />}
                                    tone="danger"
                                    onSelect={() => onRemoveManager(emp)}
                                  >
                                    Remove Manager
                                  </MenuItem>
                                )}
                              </>
                            )}
                          </>
                        )}
                      </DropdownMenu>
                    </div>
                  </div>

                  {/* Middle row: Security level & teams badge */}
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-1">
                    <Badge tone={secInfo.tone} className="gap-1 py-0 px-2 text-[10px] font-medium">
                      <SecIcon className="h-3 w-3" />
                      {secInfo.label}
                    </Badge>

                    {emp.employee_code && (
                      <span className="text-[10px] font-mono text-muted-foreground bg-muted/50 rounded px-1.5 py-0.5">
                        {emp.employee_code}
                      </span>
                    )}
                  </div>

                  {/* Bottom: Expand/Collapse Branch Control */}
                  {hasReports && (
                    <div
                      data-no-drag="true"
                      className={cn(
                        "absolute z-10 flex items-center justify-center",
                        orientation === "vertical"
                          ? "-bottom-3 left-1/2 -translate-x-1/2"
                          : "-right-3 top-1/2 -translate-y-1/2"
                      )}
                    >
                      <button
                        type="button"
                        onClick={(e) => toggleExpand(emp.id, e)}
                        className={cn(
                          "flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-0.5 text-[11px] font-semibold shadow-sm transition-all hover:scale-105 hover:bg-muted active:scale-95",
                          isExpanded
                            ? "text-primary border-primary/40 bg-primary-soft/30"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                        title={isExpanded ? "Collapse reporting line" : "Expand reporting line"}
                      >
                        {orientation === "vertical" ? (
                          isExpanded ? (
                            <ChevronUp className="h-3 w-3" />
                          ) : (
                            <ChevronDown className="h-3 w-3" />
                          )
                        ) : isExpanded ? (
                          <ChevronRight className="h-3 w-3 rotate-180" />
                        ) : (
                          <ChevronRight className="h-3 w-3" />
                        )}
                        <span>{emp.report_count || emp.children_ids?.length || 0}</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
