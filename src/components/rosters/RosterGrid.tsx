"use client";

import { Eraser, Moon } from "lucide-react";
import { useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";

import { ShiftChip } from "@/components/shifts/ShiftChip";
import { colorOf } from "@/components/shifts/shiftModel";
import { cn } from "@/lib/cn";

import type { RosterEmployee, RosterShift, RuleResult } from "./api";
import {
  DRAG_TYPE, applyPending, cellKey, cellLabel, cellText, dayHeader, isWeekend, paletteKey, parsePaletteKey, ruleLabel,
  withPending, type Cell, type PaletteValue, EMPTY_CELL,
} from "./rosterModel";

/* ------------------------------------------------------------------ palette */

/**
 * The palette value being dragged. `dataTransfer.getData` is empty in some browsers during `dragover` and in
 * synthetic test events, so the drop falls back to this module-level note of the chip that started the drag.
 */
const dragging: { current: string | null } = { current: null };

/**
 * The shift palette (§13): one chip per active shift, then Off and Clear. Each chip is draggable onto a cell
 * (HTML5 drag-and-drop) and also a toggle button: select it, then click or press Enter on cells (keyboard, touch).
 */
export function ShiftPalette({ shifts, selected, onSelect, disabled }: {
  shifts: RosterShift[];
  selected: string | null;
  onSelect: (key: string | null) => void;
  disabled?: boolean;
}) {
  const items: { key: string; label: string; testId: string; body: ReactNode }[] = [
    ...shifts.filter((s) => s.status === "ACTIVE").map((s) => ({
      key: paletteKey({ kind: "WORK", shiftId: s.id }), label: `${s.code} – ${s.name}`, testId: `palette-shift-${s.code}`,
      body: <ShiftChip code={s.code} color={s.color_token} />,
    })),
    { key: "off", label: "Off", testId: "palette-off",
      body: <span className="inline-flex items-center gap-1.5 text-sm font-semibold"><Moon className="h-3.5 w-3.5" aria-hidden />Off</span> },
    { key: "clear", label: "Clear", testId: "palette-clear",
      body: <span className="inline-flex items-center gap-1.5 text-sm font-semibold"><Eraser className="h-3.5 w-3.5" aria-hidden />Clear</span> },
  ];
  return (
    <div role="toolbar" aria-label="Shift palette" data-testid="shift-palette" className="flex flex-wrap items-center gap-2">
      {items.map((item) => (
        <button key={item.key} type="button" draggable={!disabled} disabled={disabled}
          aria-pressed={selected === item.key} aria-label={item.label} title={item.label} data-testid={item.testId}
          onClick={() => onSelect(selected === item.key ? null : item.key)}
          onDragStart={(e) => {
            e.dataTransfer?.setData(DRAG_TYPE, item.key);
            if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
            dragging.current = item.key;
          }}
          onDragEnd={() => { dragging.current = null; }}
          className={cn("inline-flex min-h-[36px] cursor-grab items-center rounded-xl border px-3 py-1 transition-colors active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50",
            selected === item.key ? "border-primary bg-primary-soft ring-2 ring-primary/30" : "border-border bg-surface hover:bg-surface-muted")}>
          {item.body}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ one cell */

const SEVERITY_ORDER = ["BLOCK", "REQUIRE_REASON", "WARN"];
const SEVERITY_TONE: Record<string, string> = {
  BLOCK: "bg-danger text-white", REQUIRE_REASON: "bg-warning text-white", WARN: "bg-info text-white",
};

function worst(results: RuleResult[]): string {
  return SEVERITY_ORDER.find((s) => results.some((r) => r.severity === s)) ?? "WARN";
}

function CellBody({ cell, shift }: { cell: Cell; shift: RosterShift | undefined }) {
  const color = colorOf(shift?.color_token);
  const solid = cell.status === "PUBLISHED";
  const text = cellText(cell, () => shift?.code);
  const marker = cell.status === "DRAFT" ? "Draft" : cell.status === "PENDING" ? "Unsaved" : null;
  return (
    <>
      {cell.kind === "WORK" ? (
        <span className={cn("inline-flex min-w-[2.75rem] justify-center rounded-lg px-1.5 py-0.5 font-mono text-xs font-semibold",
          solid ? "text-white" : "border-2 border-dashed bg-surface")}
          style={solid ? { backgroundColor: color } : { borderColor: color, color }}>
          {text}
        </span>
      ) : cell.kind === "OFF" ? (
        <span className={cn("inline-flex min-w-[2.75rem] justify-center rounded-lg px-1.5 py-0.5 text-xs font-semibold text-muted-foreground",
          solid ? "bg-muted" : "border-2 border-dashed border-muted-foreground/40")}>Off</span>
      ) : cell.status === "EMPTY" ? (
        <span className="text-xs text-muted-foreground/50" aria-hidden>·</span>
      ) : (
        <span className="inline-flex min-w-[2.75rem] justify-center rounded-lg border-2 border-dashed border-muted-foreground/40 px-1.5 py-0.5 text-xs text-muted-foreground line-through">—</span>
      )}
      {cell.extra > 0 && <span className="text-[10px] text-muted-foreground">+{cell.extra}</span>}
      {marker && (
        <span className={cn("text-[10px] font-medium uppercase tracking-wide", marker === "Unsaved" ? "text-primary" : "text-muted-foreground")}>
          {marker}
        </span>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ grid */

export interface RosterGridProps {
  employees: RosterEmployee[];
  dates: string[];
  /** Cells of the published entries and saved drafts (`buildCells`). */
  cells: Map<string, Cell>;
  shifts: RosterShift[];
  /** Unsaved edits of this screen, keyed by `cellKey`. */
  pending: Map<string, PaletteValue>;
  onPendingChange: (pending: Map<string, PaletteValue>) => void;
  /** Validation results per cell (`resultsByCell`), shown as badges. */
  results?: Map<string, RuleResult[]>;
  readOnly?: boolean;
}

/**
 * The Roster Grid (03-shifts/02 §13; 09-ui-ux): employees down, the period's dates across (sticky name column,
 * horizontal scroll, weekends shaded). Published cells are solid chips, saved drafts dashed and marked "Draft",
 * this screen's edits marked "Unsaved". Every cell is a button named "Employee, date: CODE".
 */
export function RosterGrid({ employees, dates, cells, shifts, pending, onPendingChange, results, readOnly }: RosterGridProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  const shown = useMemo(() => applyPending(cells, pending), [cells, pending]);
  const byId = useMemo(() => new Map(shifts.map((s) => [s.id, s])), [shifts]);
  const codeOf = (id: number) => byId.get(id)?.code;
  const latest = useRef(pending);
  latest.current = pending;

  const assign = (employee: RosterEmployee, date: string, raw: string | null) => {
    const value = parsePaletteKey(raw);
    if (!value) return;
    const next = withPending(latest.current, employee.id, date, value);
    latest.current = next;
    onPendingChange(next);
    const cell = applyPending(cells, next).get(cellKey(employee.id, date)) ?? EMPTY_CELL;
    setHint(`${employee.name}, ${date}: ${cellText(cell, codeOf)} (unsaved)`);
  };

  const onCellClick = (employee: RosterEmployee, date: string) => {
    if (readOnly) return;
    if (!selected) {
      setHint("Pick a shift, Off or Clear in the palette first, then choose cells.");
      return;
    }
    assign(employee, date, selected);
  };

  const onDrop = (e: DragEvent, employee: RosterEmployee, date: string) => {
    e.preventDefault();
    setOver(null);
    if (readOnly) return;
    assign(employee, date, e.dataTransfer?.getData(DRAG_TYPE) || dragging.current);
    dragging.current = null;
  };

  return (
    <div className="space-y-3" onKeyDown={(e) => { if (e.key === "Escape" && selected) setSelected(null); }}>
      {!readOnly && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <ShiftPalette shifts={shifts} selected={selected} onSelect={setSelected} />
          <p className="text-xs text-muted-foreground">Drag a chip onto a cell, or select a chip and then click cells.</p>
        </div>
      )}
      <p className="min-h-[1rem] text-xs text-muted-foreground" aria-live="polite" data-testid="grid-announcer">{hint}</p>
      <div className="scrollbar-thin overflow-x-auto rounded-2xl border border-border" role="region" aria-label="Roster grid" tabIndex={0}>
        <table className="border-separate border-spacing-0 text-sm" data-testid="roster-grid">
          <caption className="sr-only">Roster grid: employees by date</caption>
          <thead>
            <tr>
              <th scope="col" className="sticky start-0 top-0 z-20 min-w-[11rem] border-b border-e border-border bg-surface px-3 py-2 text-start text-xs font-semibold text-muted-foreground">
                Employee
              </th>
              {dates.map((date) => {
                const head = dayHeader(date);
                return (
                  <th key={date} scope="col" data-weekend={isWeekend(date) || undefined}
                    className={cn("min-w-[4rem] border-b border-border px-1 py-2 text-center text-xs font-medium",
                      isWeekend(date) ? "bg-muted/60 text-muted-foreground" : "bg-surface")}>
                    <span className="block">{head.weekday}</span>
                    <span className="block font-semibold text-foreground">{head.day}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {employees.map((employee) => (
              <tr key={employee.id} data-testid={`grid-row-${employee.id}`}>
                <th scope="row" className="sticky start-0 z-10 border-b border-e border-border bg-surface px-3 py-1.5 text-start font-medium">
                  <span className="block truncate">{employee.name}</span>
                  <span className="block text-xs font-normal text-muted-foreground">{employee.employee_code}</span>
                </th>
                {dates.map((date) => {
                  const key = cellKey(employee.id, date);
                  const cell = shown.get(key) ?? EMPTY_CELL;
                  const issues = results?.get(key) ?? [];
                  const shift = cell.shiftId ? byId.get(cell.shiftId) : undefined;
                  return (
                    <td key={date} className={cn("border-b border-border p-0.5 text-center", isWeekend(date) && "bg-muted/40")}>
                      <button type="button" data-testid={`cell-${employee.id}-${date}`}
                        data-state={cell.status.toLowerCase()} aria-disabled={readOnly || undefined}
                        aria-label={cellLabel(employee.name, date, cell, codeOf, issues.length)}
                        onClick={() => onCellClick(employee, date)}
                        onDragOver={(e) => { if (!readOnly) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; setOver(key); } }}
                        onDragLeave={() => setOver((k) => (k === key ? null : k))}
                        onDrop={(e) => onDrop(e, employee, date)}
                        className={cn("relative flex h-12 w-full min-w-[3.75rem] flex-col items-center justify-center gap-0.5 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                          !readOnly && "hover:bg-surface-muted", readOnly && "cursor-default",
                          over === key && "bg-primary-soft ring-2 ring-primary",
                          cell.status === "PENDING" && "bg-primary-soft/50")}>
                        <CellBody cell={cell} shift={shift} />
                        {issues.length > 0 && (
                          <span aria-hidden data-testid={`cell-issue-${employee.id}-${date}`} data-severity={worst(issues)}
                            title={issues.map((r) => ruleLabel(r.rule_key)).join(", ")}
                            className={cn("absolute -end-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-bold",
                              SEVERITY_TONE[worst(issues)])}>
                            {issues.length}
                          </span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
