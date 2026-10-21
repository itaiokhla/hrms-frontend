"use client";

import { motion } from "framer-motion";
import { CheckCircle2, Circle, Hourglass, Lock, Scale } from "lucide-react";

import { Field, Select } from "@/components/ui/field";
import { ErrorState } from "@/components/ui/layout";
import { Sheet } from "@/components/ui/overlay";
import { Skeleton } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { useApi } from "@/lib/hooks";
import type { SettingDefinition } from "@/lib/settings.generated";

import { LEVEL_LABELS, definitionOf, fmtDay, formatValue, grainNotice } from "./model";
import { settingsApi } from "./settingsApi";
import type { ExplainLevel, ScopeRef } from "./types";

const STATUS_TEXT: Record<string, string> = {
  EFFECTIVE: "Used",
  NOT_REACHED: "Not used: a more specific level wins",
  NOT_ALLOWED: "Can't be set at this level",
  EMPTY: "Not set",
  LOCKED: "Ignored: locked by a broader level",
  LEGAL_LIMIT: "Ignored: outside the legal limit",
  INVALID: "Ignored: not a valid value",
};

function personName(setBy: ExplainLevel["set_by"]): string | null {
  if (!setBy) return null;
  return typeof setBy === "string" ? setBy : setBy.name;
}

/**
 * "Why is this value used?" (3.8 §5.16 Inheritance): every level from the most specific to the
 * platform default, which one wins, and who set it. GET /payroll/settings/resolve.
 */
export function InheritanceSheet({
  open,
  onOpenChange,
  settingKey,
  onKeyChange,
  keys,
  scope,
  asOf,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settingKey: string | null;
  onKeyChange: (key: string) => void;
  keys: SettingDefinition[];
  scope: ScopeRef;
  asOf: string;
}) {
  const key = settingKey ?? keys[0]?.key ?? null;
  const def = key ? definitionOf(key) : undefined;
  const { data, error, loading, reload } = useApi(
    () => settingsApi.resolve(key as string, scope, asOf),
    [key, scope.scope_type, scope.scope_id, asOf],
    { enabled: open && !!key },
  );
  const fresh = data && data.key === key ? data : undefined;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Inheritance"
      description={`Where each value comes from at ${scope.name ?? "this scope"} on ${fmtDay(asOf)}.`}
    >
      <div className="space-y-5">
        <Field label="Setting">
          <Select value={key ?? ""} onChange={(e) => onKeyChange(e.target.value)}>
            {keys.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </Select>
        </Field>
        <div aria-live="polite" aria-busy={loading || undefined}>
          {error ? (
            <ErrorState message={error.message} onRetry={reload} />
          ) : !fresh ? (
            <div className="space-y-3">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 rounded-2xl" />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-2xl border border-border bg-surface-muted p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Value in force</p>
                <p className="mt-1 text-lg font-semibold">{formatValue(def, fresh.value)}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  From {fresh.level ? LEVEL_LABELS[fresh.level] ?? fresh.level : "nowhere"}
                  {fresh.locked_by ? ` · locked by ${LEVEL_LABELS[fresh.locked_by]?.toLowerCase() ?? fresh.locked_by}` : ""}
                  {" · "}
                  {fresh.resolution_grain === "PERIOD" ? "resolved once per pay period" : "resolved day by day"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{grainNotice(fresh.resolution_grain, asOf)}.</p>
                {!fresh.valid && (
                  <p role="alert" className="mt-2 text-sm font-medium text-danger">
                    {fresh.issues.map((i) => i.message).join(" ") || "This value is not valid; payroll stops with a configuration error."}
                  </p>
                )}
              </div>
              <ol className="relative space-y-3 border-s border-border ps-5" aria-label="Levels, most specific first">
                {fresh.levels.map((level, index) => (
                  <motion.li
                    key={level.level}
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2, delay: Math.min(index, 8) * 0.03 }}
                    className="relative"
                  >
                    <span className="absolute -start-[27px] top-3 flex h-4 w-4 items-center justify-center rounded-full bg-surface">
                      {level.status === "EFFECTIVE" ? (
                        <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
                      ) : (
                        <Circle className="h-3 w-3 text-muted-foreground" aria-hidden />
                      )}
                    </span>
                    <div
                      className={cn(
                        "rounded-2xl border p-3",
                        level.status === "EFFECTIVE" ? "border-success/40 bg-success-soft/40" : "border-border",
                        !level.allowed && "opacity-70",
                      )}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold">{LEVEL_LABELS[level.level] ?? level.level}</p>
                        <span className="text-xs font-medium text-foreground">{STATUS_TEXT[level.status] ?? level.status}</span>
                      </div>
                      {(level.row_id || level.level === "PLATFORM") && (
                        <p className="mt-1 text-sm">
                          {formatValue(def, level.value)}
                          {level.locked && (
                            <span className="ms-2 inline-flex items-center gap-1 text-xs text-foreground">
                              <Lock className="h-3 w-3" aria-hidden /> locked
                            </span>
                          )}
                        </p>
                      )}
                      {level.derived && <p className="mt-1 text-xs text-muted-foreground">{level.derived.description}</p>}
                      {(level.effective_from || personName(level.set_by) || level.source) && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {[
                            level.effective_from && `from ${fmtDay(level.effective_from)}`,
                            level.effective_to && `until ${fmtDay(level.effective_to)}`,
                            personName(level.set_by) && `by ${personName(level.set_by)}`,
                            level.source && level.source !== "ADMIN" && level.source.replace(/_/g, " ").toLowerCase(),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      )}
                      {level.reason && <p className="mt-1 text-xs text-muted-foreground">Reason: {level.reason}</p>}
                      {level.constraints?.length ? (
                        <p className="mt-2 flex items-start gap-1.5 text-xs text-foreground">
                          <Scale className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                          {level.constraints.map((c) => String(c.source ?? "")).filter(Boolean).join("; ") || "Legal limits apply"}
                        </p>
                      ) : null}
                      {level.pending && (
                        <p className="mt-2 flex items-start gap-1.5 text-xs text-foreground">
                          <Hourglass className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                          Waiting for approval: {formatValue(def, level.pending.value)} from {fmtDay(level.pending.effective_from)}
                        </p>
                      )}
                    </div>
                  </motion.li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
}
