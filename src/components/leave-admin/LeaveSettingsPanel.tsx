"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Lock, RotateCcw, Save } from "lucide-react";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { Notice } from "@/components/payroll/inputs/shared";
import { Button } from "@/components/ui/button";
import { Input, Select, Switch } from "@/components/ui/field";
import { ErrorState } from "@/components/ui/layout";
import { Badge, Card, MotionSafe, Skeleton } from "@/components/ui/primitives";
import { useApi } from "@/lib/hooks";
import { leaveAdminApi } from "@/lib/leave/adminApi";
import type { LeaveSetting } from "@/lib/leave/adminTypes";

import { ErrorNotice } from "./shared";

/** The text form of a value for an input (decimals stay strings; null → ""). */
export function settingText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

/** The JSON value to send for an input's text, by the registry type (decimals as strings, ints as numbers). */
export function settingValue(setting: Pick<LeaveSetting, "type" | "constraints">, text: string | boolean): unknown {
  if (setting.type === "bool") return Boolean(text);
  const raw = String(text).trim();
  if (raw === "") return setting.constraints?.nullable ? null : raw;
  if (setting.type === "int") return /^-?\d+$/.test(raw) ? Number(raw) : raw;
  return raw;
}

/** A client check of the registry constraints (the server validates again). */
export function settingProblem(setting: Pick<LeaveSetting, "type" | "constraints">, value: unknown): string | undefined {
  const c = setting.constraints ?? {};
  if (value === null) return c.nullable ? undefined : "A value is required.";
  if (setting.type === "int" || setting.type === "decimal") {
    const ok = setting.type === "int" ? typeof value === "number" && Number.isInteger(value) : typeof value === "string" && /^\d+(\.\d+)?$/.test(value);
    if (!ok) return setting.type === "int" ? "Enter a whole number." : "Enter a number such as 1.5.";
    const n = Number(value);
    if (c.min !== undefined && n < Number(c.min)) return `At least ${c.min}.`;
    if (c.max !== undefined && n > Number(c.max)) return `At most ${c.max}.`;
  }
  if (setting.type === "string" && typeof value === "string") {
    if (c.max_length && value.length > c.max_length) return `At most ${c.max_length} characters.`;
    if (c.regex && !new RegExp(`^(?:${c.regex})$`).test(value)) return "This value has the wrong format.";
  }
  if (setting.type === "enum" && c.choices && !c.choices.includes(String(value))) return "Choose one of the options.";
  return undefined;
}

function helpLines(help: string): string[] {
  const match = /^ON: (.*) OFF: (.*)$/.exec(help);
  return match ? [`On: ${match[1]}`, `Off: ${match[2]}`] : [help];
}

function SettingRow({ setting, canWrite, onSaved }: { setting: LeaveSetting; canWrite: boolean; onSaved: () => void }) {
  const [text, setText] = useState<string | boolean>(setting.type === "bool" ? !!setting.value : settingText(setting.value));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    setText(setting.type === "bool" ? !!setting.value : settingText(setting.value));
    setReason("");
  }, [setting.value, setting.type]);
  const value = settingValue(setting, text);
  // Compare text forms: the API returns decimals as JSON numbers but takes them back as strings.
  const changed = setting.type === "bool" ? !!text !== !!setting.value : String(text).trim() !== settingText(setting.value);
  const problem = changed ? settingProblem(setting, value) : undefined;
  const locked = setting.system_written || !canWrite;
  const unit = setting.ui?.unit;

  const save = async () => {
    if (problem) return;
    setBusy(true);
    setError(null);
    try {
      await leaveAdminApi.saveSetting(setting.key, value, reason.trim() || null);
      toast.success(`${setting.label} saved`);
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const id = `setting-${setting.key.replace(/\W+/g, "-")}`;
  let control;
  if (setting.type === "bool") {
    control = <Switch id={id} checked={!!text} disabled={locked} onChange={(v) => setText(v)} label={setting.label} />;
  } else if (setting.type === "enum" || setting.ui?.control === "select") {
    control = (
      <Select id={id} value={String(text)} disabled={locked} onChange={(e) => setText(e.target.value)} className="sm:w-64">
        {setting.constraints?.nullable && <option value="">Not set</option>}
        {(setting.constraints?.choices ?? []).map((c) => <option key={c} value={c}>{c.replace(/_/g, " ").toLowerCase().replace(/^\w/, (x) => x.toUpperCase())}</option>)}
      </Select>
    );
  } else {
    control = (
      <div className="flex items-center gap-2">
        <Input id={id} type={setting.type === "date" ? "date" : "text"} inputMode={setting.type === "int" ? "numeric" : setting.type === "decimal" ? "decimal" : undefined}
          value={String(text)} disabled={locked} onChange={(e) => setText(e.target.value)} className="sm:w-48" aria-invalid={problem ? true : undefined} />
        {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
      </div>
    );
  }

  return (
    <div className="space-y-2 px-5 py-4" data-testid={`setting-${setting.key}`}>
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            {setting.label}
            {setting.system_written && <Badge tone="neutral"><Lock className="h-3 w-3" aria-hidden /> Set by the system</Badge>}
            {setting.requiresApproval && <Badge tone="info">Needs approval</Badge>}
          </label>
          {helpLines(setting.help).map((line) => <p key={line} className="text-xs text-muted-foreground">{line}</p>)}
          <p className="mt-0.5 font-mono text-[11px] text-muted-foreground/80">{setting.key}</p>
        </div>
        <div className="shrink-0">{control}</div>
      </div>
      {problem && <p className="text-xs font-medium text-danger" role="alert">{problem}</p>}
      <MotionSafe>
        <AnimatePresence>
          {changed && !locked && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Input placeholder="Reason (optional, kept in the audit trail)" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} className="min-w-[14rem] flex-1" />
                <Button variant="ghost" size="sm" onClick={() => setText(setting.type === "bool" ? !!setting.value : settingText(setting.value))}><RotateCcw className="h-4 w-4" /> Undo</Button>
                <Button size="sm" onClick={() => void save()} loading={busy} disabled={!!problem} data-testid={`setting-save-${setting.key}`}><Save className="h-4 w-4" /> Save</Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </MotionSafe>
      <ErrorNotice error={error} />
    </div>
  );
}

/** Leave settings (`GET /leaves/settings`, `PUT /leaves/settings/{key}`): one control per registry key. */
export function LeaveSettingsPanel() {
  const data = useApi(() => leaveAdminApi.settings(), []);
  if (data.error && !data.data) return <Card><ErrorState message={data.error.message} onRetry={() => void data.reload()} /></Card>;
  if (!data.data) return <Skeleton className="h-96 rounded-2xl" />;
  return (
    <div className="space-y-4">
      {!data.data.can_write && (
        <Notice tone="info" title="Read-only">Leave settings are company-wide: changing them needs company-wide leave configuration access.</Notice>
      )}
      <Card className="divide-y divide-border/70" data-testid="leave-settings">
        {data.data.settings.map((s) => (
          <SettingRow key={s.key} setting={s} canWrite={data.data!.can_write} onSaved={() => void data.reload()} />
        ))}
      </Card>
    </div>
  );
}
