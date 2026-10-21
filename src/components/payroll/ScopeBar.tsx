"use client";

import { useId, type KeyboardEvent, type ReactNode } from "react";

import { Select } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { levelName } from "@/lib/payroll/labels";
import type { ScopeLevel } from "@/lib/settings.generated";

export interface ScopeTarget {
  id: string;
  label: string;
}

export interface ScopeSelection {
  level: ScopeLevel;
  /** The legal entity, branch, pay group or employee; null at TENANT level. */
  targetId: string | null;
}

export interface ScopeBarProps {
  value: ScopeSelection;
  onChange: (value: ScopeSelection) => void;
  /**
   * The targets this person may edit at each level, from the server (scope targets are not in
   * `me`). A level with no targets is disabled.
   */
  targets: Partial<Record<ScopeLevel, ScopeTarget[]>>;
  levels?: ScopeLevel[];
  /** Whether the TENANT level is editable by this person. */
  tenantAllowed?: boolean;
  /** Right-hand actions such as [Inheritance] [History]. */
  actions?: ReactNode;
  className?: string;
}

const DEFAULT_LEVELS: ScopeLevel[] = ["TENANT", "LEGAL_ENTITY", "BRANCH", "PAY_GROUP"];

function title(level: ScopeLevel) {
  const name = levelName(level);
  return name[0].toUpperCase() + name.slice(1);
}

/**
 * Which level a settings page edits (3.8 §5.16): a radio group of levels (arrow keys move, as in
 * Segmented) plus the target picker for the chosen level.
 */
export function ScopeBar({ value, onChange, targets, levels = DEFAULT_LEVELS, tenantAllowed = true, actions, className }: ScopeBarProps) {
  const id = useId();
  const enabled = (level: ScopeLevel) => (level === "TENANT" ? tenantAllowed : (targets[level]?.length ?? 0) > 0);
  const choose = (level: ScopeLevel) => {
    if (!enabled(level) || level === value.level) return;
    onChange({ level, targetId: level === "TENANT" ? null : targets[level]?.[0]?.id ?? null });
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const usable = levels.filter(enabled);
    const rtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";
    const forward = e.key === "ArrowDown" || (e.key === "ArrowRight" && !rtl) || (e.key === "ArrowLeft" && rtl);
    const index = usable.indexOf(value.level);
    const next = usable[(index + (forward ? 1 : -1) + usable.length) % usable.length];
    if (next) {
      choose(next);
      requestAnimationFrame(() => document.getElementById(`${id}-${next}`)?.focus());
    }
  };
  const options = value.level === "TENANT" ? [] : targets[value.level] ?? [];

  return (
    <div className={cn("flex flex-col gap-3 rounded-2xl border border-border bg-surface p-3 shadow-sm sm:flex-row sm:items-center", className)}>
      <span id={`${id}-label`} className="text-sm font-medium text-muted-foreground">
        Scope
      </span>
      <div role="radiogroup" aria-labelledby={`${id}-label`} className="flex flex-wrap gap-1 rounded-xl bg-muted p-1" onKeyDown={onKey}>
        {levels.map((level) => {
          const checked = value.level === level;
          return (
            <button
              key={level}
              id={`${id}-${level}`}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              disabled={!enabled(level)}
              onClick={() => choose(level)}
              className={cn(
                "min-h-[44px] rounded-lg px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-[36px]",
                checked ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {title(level)}
            </button>
          );
        })}
      </div>
      {value.level !== "TENANT" && (
        <Select
          aria-label={`Choose ${levelName(value.level)}`}
          className="sm:w-56"
          value={value.targetId ?? ""}
          onChange={(e) => onChange({ level: value.level, targetId: e.target.value || null })}
        >
          {options.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </Select>
      )}
      {actions && <div className="flex flex-wrap items-center gap-2 sm:ms-auto">{actions}</div>}
    </div>
  );
}
