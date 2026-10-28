"use client";

/**
 * Import wizard of modal `import-holidays` (LH 04-holiday/02 §9.1; full-page twin `/holidays/calendars/{id}/import`):
 * 1 Upload — kind (Holidays (dates) CSV, Repeating holidays CSV, iCalendar .ics), target year, file, templates;
 * 2 Review — the dry-run report: summary chips, one line per row with its classification, Accept / Skip, row errors
 *   (download "errors.csv"), a reason when the year is published (one amendment);
 * 3 Done — what was created. Nothing is written before "Import n lines".
 */

import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Download, FileUp, ListChecks, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";

import { Notice } from "@/components/payroll/inputs/shared";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Badge } from "@/components/ui/primitives";
import { downloadFile, errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { IMPORT_CLASS_LABEL, importsApi, type HolidayImport, type ImportClass, type ImportKind, type ImportLine } from "@/lib/holiday/api";

const KIND_LABEL: Record<ImportKind, string> = {
  CSV_DATED: "Holidays (dates) — CSV",
  CSV_RULES: "Repeating holidays — CSV",
  ICS: "Calendar file — .ics",
};

const CLASS_TONE: Record<ImportClass, "success" | "warning" | "danger" | "info" | "neutral" | "primary"> = {
  NEW: "success",
  NEW_RULE: "success",
  CHANGED_DATE: "info",
  CHANGED_DETAILS: "info",
  CANCEL: "warning",
  UNCHANGED: "neutral",
  CONFLICT: "warning",
  CONFLICT_EDIT: "warning",
  NOT_IN_SOURCE: "neutral",
  DUPLICATE_RULE: "neutral",
  ERROR: "danger",
};

export interface HolidayImportWizardProps {
  calendarId: number;
  calendarCode: string;
  defaultYear: number;
  /** Local year of the calendar; imports reach this year up to two years ahead. */
  localYear: number;
  onDone: (result: HolidayImport) => void;
  onCancel: () => void;
  onDirty?: (dirty: boolean) => void;
}

export function HolidayImportWizard({ calendarId, calendarCode, defaultYear, localYear, onDone, onCancel, onDirty }: HolidayImportWizardProps) {
  const [kind, setKind] = useState<ImportKind>("CSV_DATED");
  const [year, setYear] = useState(defaultYear);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<HolidayImport | null>(null);
  const [actions, setActions] = useState<Record<number, "ACCEPT" | "SKIP">>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<HolidayImport | null>(null);

  const step = done ? 3 : report ? 2 : 1;
  const lines = useMemo(() => (report?.lines ?? []).filter((l): l is ImportLine & { line: number } => l.line !== null), [report]);
  const extra = (report?.lines ?? []).filter((l) => l.line === null);
  const accepted = lines.filter((l) => (actions[l.line] ?? l.action) === "ACCEPT" && l.errors.length === 0);
  const published = report?.year_status === "PUBLISHED";

  const check = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const result = await importsApi.check(calendarId, kind, year, file);
      setReport(result);
      setActions({});
      onDirty?.(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!report) return;
    setBusy(true);
    setError(null);
    try {
      const decisions = lines.map((l) => ({ line: l.line, action: actions[l.line] ?? l.action }));
      const result = await importsApi.commit(calendarId, report.id, { decisions, reason: reason.trim() || undefined, target_hash: report.target_hash });
      setDone(result);
      onDirty?.(false);
      toast.success(`Imported ${result.result?.rows_created ?? 0} holiday(s) and ${result.result?.rules_created ?? 0} rule(s)`);
      onDone(result);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="import-wizard">
      <ol className="flex items-center gap-2 text-xs font-medium" aria-label="Steps">
        {["Upload", "Review", "Done"].map((label, i) => (
          <li key={label} className={cn("flex items-center gap-1.5 rounded-full px-3 py-1", step === i + 1 ? "bg-primary-soft text-primary" : "text-muted-foreground")} aria-current={step === i + 1 ? "step" : undefined}>
            <span className="tabular-nums">{i + 1}</span> {label}
          </li>
        ))}
      </ol>

      <AnimatePresence mode="wait">
        {step === 1 && (
          <motion.div key="upload" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="What are you importing?" htmlFor="import-kind">
                <Select id="import-kind" value={kind} onChange={(e) => setKind(e.target.value as ImportKind)}>
                  {(Object.keys(KIND_LABEL) as ImportKind[]).map((k) => (
                    <option key={k} value={k}>{KIND_LABEL[k]}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Into year" htmlFor="import-year">
                <Select id="import-year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
                  {[localYear, localYear + 1, localYear + 2].map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="File" htmlFor="import-file" hint="UTF-8, at most 2 MB and 5,000 rows. Nothing is saved until you review the check.">
              <Input id="import-file" type="file" accept={kind === "ICS" ? ".ics,text/calendar" : ".csv,text/csv"} onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="import-file" />
            </Field>
            {kind !== "ICS" && (
              <Button variant="ghost" size="sm" onClick={() => void downloadFile(importsApi.templateUrl(kind, year), `${kind.toLowerCase()}-template.csv`)}>
                <Download className="h-4 w-4" /> Download the template
              </Button>
            )}
            {error && <Notice tone="danger" title={error} />}
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Button variant="secondary" onClick={onCancel}>Cancel</Button>
              <Button onClick={() => void check()} disabled={!file} loading={busy} data-testid="import-check">
                <Upload className="h-4 w-4" /> Check file
              </Button>
            </div>
          </motion.div>
        )}

        {step === 2 && report && (
          <motion.div key="review" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} className="space-y-4">
            <div className="flex flex-wrap gap-1.5" data-testid="import-summary">
              {(Object.keys(IMPORT_CLASS_LABEL) as ImportClass[]).filter((c) => report.summary[c]).map((c) => (
                <Badge key={c} tone={CLASS_TONE[c]}>
                  {IMPORT_CLASS_LABEL[c]} · {report.summary[c]}
                </Badge>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              {calendarCode} {report.target_year} · {report.year_status === "PUBLISHED" ? "published: the accepted lines become one amendment" : "draft: the accepted lines go straight into the draft"}
              {report.source_label ? ` · source "${report.source_label}"` : ""}
            </p>
            {report.ignored_properties.length > 0 && <p className="text-xs text-muted-foreground">Ignored: {report.ignored_properties.join(", ")}</p>}
            <div className="max-h-[22rem] overflow-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface-muted text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Line</th>
                    <th className="px-3 py-2">Holiday</th>
                    <th className="px-3 py-2">Result</th>
                    <th className="px-3 py-2 text-right">Import?</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const action = actions[l.line] ?? l.action;
                    const blocked = l.errors.length > 0 || l.classification === "UNCHANGED" || l.classification === "DUPLICATE_RULE";
                    return (
                      <tr key={l.line} className="border-t border-border align-top" data-testid={`import-line-${l.line}`} data-class={l.classification}>
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">{l.line}</td>
                        <td className="px-3 py-2">
                          <p className="font-medium">{String(l.values.name ?? "—")}</p>
                          <p className="text-xs text-muted-foreground">
                            {l.kind === "RULE" ? `Repeats: ${String(l.values.kind ?? "")}${l.preview?.[0] ? ` · ${l.preview[0].date}` : ""}` : String(l.values.date ?? "")}
                            {l.match && l.match.date !== l.values.date ? ` · now ${l.match.date}` : ""}
                          </p>
                          {l.note && <p className="text-xs text-warning">{l.note}</p>}
                          {l.errors.map((e, i) => (
                            <p key={i} className="text-xs text-danger">{e.field}: {e.message}</p>
                          ))}
                        </td>
                        <td className="px-3 py-2"><Badge tone={CLASS_TONE[l.classification]}>{IMPORT_CLASS_LABEL[l.classification]}</Badge></td>
                        <td className="px-3 py-2 text-right">
                          <label className="inline-flex items-center gap-1.5 text-xs">
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={action === "ACCEPT" && !blocked}
                              disabled={blocked}
                              onChange={(e) => setActions({ ...actions, [l.line]: e.target.checked ? "ACCEPT" : "SKIP" })}
                              aria-label={`Import line ${l.line}`}
                            />
                            {action === "ACCEPT" && !blocked ? "Accept" : "Skip"}
                          </label>
                        </td>
                      </tr>
                    );
                  })}
                  {extra.map((l, i) => (
                    <tr key={`x-${i}`} className="border-t border-border text-muted-foreground">
                      <td className="px-3 py-2">—</td>
                      <td className="px-3 py-2">{String(l.values.name)} · {String(l.values.date)}</td>
                      <td className="px-3 py-2"><Badge>{IMPORT_CLASS_LABEL[l.classification]}</Badge></td>
                      <td className="px-3 py-2 text-right text-xs">Kept</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(report.summary.ERROR ?? 0) > 0 && (
              <Notice tone="warning" title={`${report.summary.ERROR} line(s) have errors and are skipped. Fix them in the file to import them.`}>
                <Button variant="ghost" size="sm" onClick={() => void downloadFile(importsApi.errorsUrl(report.id), "errors.csv")}>
                  <Download className="h-4 w-4" /> errors.csv
                </Button>
              </Notice>
            )}
            {published && (
              <Field label="Reason for changing the published year" required htmlFor="import-reason">
                <Textarea id="import-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
            )}
            {error && <Notice tone="danger" title={error} />}
            <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
              <Button variant="secondary" onClick={() => { setReport(null); onDirty?.(false); }}>
                <FileUp className="h-4 w-4" /> Choose another file
              </Button>
              <Button onClick={() => void commit()} loading={busy} disabled={accepted.length === 0 || (published && !reason.trim())} data-testid="import-commit">
                <ListChecks className="h-4 w-4" /> Import {accepted.length} line{accepted.length === 1 ? "" : "s"}
              </Button>
            </div>
          </motion.div>
        )}

        {step === 3 && done && (
          <motion.div key="done" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="space-y-4 text-center" data-testid="import-done">
            <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
            <p className="font-medium">
              {done.result?.rows_created ?? 0} holiday(s) and {done.result?.rules_created ?? 0} repeating rule(s) imported into {done.target_year}.
            </p>
            {done.result?.amendment_status === "PENDING_SECOND_PERSON" && <Notice tone="info" title="The amendment waits for a second holiday publisher." />}
            <Button onClick={onCancel}>Close</Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
