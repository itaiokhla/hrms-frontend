"use client";

import { Reorder, useDragControls, useReducedMotion, type DragControls } from "framer-motion";
import { ArrowDown, ArrowUp, GripVertical, Lock, Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch } from "@/components/ui/field";
import { cn } from "@/lib/cn";

import { FormulaEditor } from "./FormulaEditor";
import { METHOD_LABEL, kindLabel, methodLabel } from "./format";
import { CALC_METHODS, type PayComponent, type StructureIssue, type StructureLine } from "./types";

export interface EditableLine extends StructureLine {
  /** Local key for reordering (stable across edits). */
  key: string;
}

let seq = 0;
export const toEditable = (lines: StructureLine[] = []): EditableLine[] =>
  [...lines].sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0)).map((l) => ({ ...l, key: `l${++seq}` }));

const VALUE_LABEL: Record<string, string> = { FIXED: "Amount", PERCENT_OF: "Percent", RATE_X_UNITS: "Rate" };

/**
 * Structure lines (3.8 §5.8): drag to reorder (display order only; calculation order comes from the
 * dependencies), method / value / formula per line, overridable bounds, and the validation messages of
 * that line (cycle path, stage violation, negative balancing with the minimum pay basis) shown inline.
 */
export function LinesEditor({
  lines,
  onChange,
  components,
  issues,
  readOnly,
  currency,
}: {
  lines: EditableLine[];
  onChange: (lines: EditableLine[]) => void;
  components: PayComponent[];
  issues: StructureIssue[];
  readOnly: boolean;
  currency?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [adding, setAdding] = useState("");
  const byCode = new Map(components.map((c) => [c.code, c]));
  const used = new Set(lines.map((l) => l.component));
  const available = components.filter((c) => !used.has(c.code) && c.status === "ACTIVE");
  const options = components.map((c) => ({ code: c.code, name: c.name }));

  const update = (key: string, patch: Partial<StructureLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const move = (index: number, delta: number) => {
    const next = [...lines];
    const [item] = next.splice(index, 1);
    next.splice(Math.max(0, Math.min(next.length, index + delta)), 0, item);
    onChange(next);
  };
  const add = () => {
    const c = byCode.get(adding);
    if (!c) return;
    onChange([...lines, { key: `l${++seq}`, component: c.code, kind: c.kind, category: c.category, method: null, value: null, formula: null, params: {}, overridable: false, override_min: null, override_max: null, display_order: lines.length }]);
    setAdding("");
  };

  return (
    <div className="space-y-3">
      {!lines.length && <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">No lines yet. Add the components this structure pays.</p>}
      <Reorder.Group axis="y" values={lines} onReorder={readOnly ? () => undefined : onChange} className="space-y-2" as="ol" aria-label="Structure lines">
        {lines.map((line, index) => {
          const comp = byCode.get(line.component);
          const method = line.method || (comp?.current_version?.calc_method ?? null);
          const own = issues.filter((i) => i.component === line.component);
          const system = method === "SYSTEM" || comp?.read_only;
          return (
            <DraggableLine
              key={line.key}
              line={line}
              reduceMotion={!!reduceMotion}
              className={cn("rounded-2xl border bg-surface p-3", own.some((i) => i.severity !== "WARNING") ? "border-danger/60" : "border-border")}
            >
              {(controls) => (
              <>
              <div className="flex flex-wrap items-start gap-2">
                {!readOnly && (
                  <span className="flex flex-col items-center">
                    <span className="cursor-grab touch-none p-2 text-muted-foreground" aria-hidden title="Drag to reorder" onPointerDown={(e) => controls.start(e)}>
                      <GripVertical className="h-4 w-4" />
                    </span>
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <bdi dir="ltr" className="font-mono text-sm">
                      {line.component}
                    </bdi>
                    <span className="text-sm text-muted-foreground">{comp?.name ?? "Unknown component"}</span>
                    {system && <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-label="Country pack" />}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {kindLabel(line.kind ?? comp?.kind)} · {methodLabel(method)}
                  </p>
                </div>
                {!readOnly && (
                  <div className="flex items-center gap-1">
                    <Button size="icon" variant="ghost" aria-label={`Move ${line.component} up`} disabled={index === 0} onClick={() => move(index, -1)} className="h-11 w-11 sm:h-9 sm:w-9">
                      <ArrowUp className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button size="icon" variant="ghost" aria-label={`Move ${line.component} down`} disabled={index === lines.length - 1} onClick={() => move(index, 1)} className="h-11 w-11 sm:h-9 sm:w-9">
                      <ArrowDown className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button size="icon" variant="danger-ghost" aria-label={`Remove ${line.component}`} onClick={() => onChange(lines.filter((l) => l.key !== line.key))} className="h-11 w-11 sm:h-9 sm:w-9">
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                )}
              </div>
              {!system && (
                <fieldset disabled={readOnly} className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label="Method">
                    <Select value={line.method ?? ""} onChange={(e) => update(line.key, { method: e.target.value || null, value: null, formula: null })}>
                      <option value="">Component default ({methodLabel(comp?.current_version?.calc_method)})</option>
                      {CALC_METHODS.filter((m) => m !== "SYSTEM").map((m) => (
                        <option key={m} value={m}>
                          {METHOD_LABEL[m]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {method && VALUE_LABEL[method] && (
                    <Field label={`${VALUE_LABEL[method]}${method === "FIXED" && currency ? ` (${currency}, monthly)` : method === "PERCENT_OF" ? " (%)" : ""}`} hint={!line.method ? "Empty: the component's default." : undefined}>
                      <Input dir="ltr" inputMode="decimal" value={line.value ?? ""} onChange={(e) => update(line.key, { value: e.target.value || null })} />
                    </Field>
                  )}
                  {method === "FORMULA" && (
                    <div className="sm:col-span-2">
                      <FormulaEditor
                        label="Formula"
                        rows={2}
                        value={line.formula ?? ""}
                        onChange={(v) => update(line.key, { formula: v || null })}
                        components={options}
                        componentCode={line.component}
                        kind={line.kind ?? comp?.kind}
                        currency={currency}
                        disabled={readOnly}
                        hint={!line.formula ? "Empty: the component's formula." : undefined}
                      />
                    </div>
                  )}
                  <div className="flex items-center gap-3 sm:col-span-2">
                    <Switch checked={line.overridable} onChange={(v) => update(line.key, { overridable: v })} label={`${line.component} can be overridden per employee`} />
                    <span className="text-sm">Can be overridden per employee</span>
                  </div>
                  {line.overridable && (
                    <>
                      <Field label="Override minimum" hint="Empty: no minimum.">
                        <Input dir="ltr" inputMode="decimal" value={line.override_min ?? ""} onChange={(e) => update(line.key, { override_min: e.target.value || null })} />
                      </Field>
                      <Field label="Override maximum" hint="Empty: no maximum.">
                        <Input dir="ltr" inputMode="decimal" value={line.override_max ?? ""} onChange={(e) => update(line.key, { override_max: e.target.value || null })} />
                      </Field>
                    </>
                  )}
                </fieldset>
              )}
              {own.length > 0 && (
                <ul className="mt-2 space-y-1" aria-label={`Problems with ${line.component}`}>
                  {own.map((i, n) => (
                    <li key={n} role={i.severity === "WARNING" ? undefined : "alert"} className={cn("rounded-xl px-3 py-1.5 text-xs", i.severity === "WARNING" ? "bg-warning-soft text-warning" : "bg-danger-soft text-danger")}>
                      {i.message}
                      {i.path?.length ? <span className="block font-mono">Cycle: {i.path.join(" → ")}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
              </>
              )}
            </DraggableLine>
          );
        })}
      </Reorder.Group>
      {!readOnly && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field label="Add a component" className="flex-1">
            <Select value={adding} onChange={(e) => setAdding(e.target.value)}>
              <option value="">Choose…</option>
              {available.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button variant="secondary" onClick={add} disabled={!adding} className="min-h-[44px]">
            <Plus className="h-4 w-4" aria-hidden /> Add line
          </Button>
        </div>
      )}
    </div>
  );
}

function DraggableLine({ line, reduceMotion, className, children }: { line: EditableLine; reduceMotion: boolean; className: string; children: (controls: DragControls) => ReactNode }) {
  const controls = useDragControls();
  return (
    <Reorder.Item value={line} dragListener={false} dragControls={controls} transition={reduceMotion ? { duration: 0 } : undefined} className={className}>
      {children(controls)}
    </Reorder.Item>
  );
}
