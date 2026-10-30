"use client";

import { motion } from "framer-motion";
import { CheckCircle2, Download, FileSpreadsheet, Upload, XCircle } from "lucide-react";
import { useRef, useState } from "react";
import toast from "react-hot-toast";

import { Notice } from "@/components/payroll/inputs/shared";
import { Button } from "@/components/ui/button";
import { Card, MotionSafe, Badge } from "@/components/ui/primitives";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/cn";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { leaveAdminApi } from "@/lib/leave/adminApi";
import { IMPORT_COLUMNS, type ImportKind, type ImportRun } from "@/lib/leave/adminTypes";

import { ErrorNotice } from "../shared";

/** The CSV template of both import kinds (`employee_code,leave_type,units,effective_date,expires_on,note`). */
export function importTemplate(kind: ImportKind): string {
  const sample = kind === "OPENING_BALANCES"
    ? ["E001", "earned", "12.5", "2027-01-01", "", "Opening balance from the old system"]
    : ["E001", "casual", "-1", "2027-03-01", "", "Correction"];
  return `${IMPORT_COLUMNS.join(",")}\n${sample.join(",")}\n`;
}

function downloadTemplate(kind: ImportKind) {
  const blob = new Blob([importTemplate(kind)], { type: "text/csv;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = kind === "OPENING_BALANCES" ? "leave-opening-balances.csv" : "leave-balance-adjustments.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

/**
 * Imports (09-ui-ux/02 §14): upload a CSV → dry-run report (valid rows, errors per line) → commit (fresh step-up).
 * Opening balances must be positive; balance adjustments may be negative.
 */
export function ImportsTab() {
  const [kind, setKind] = useState<ImportKind>("OPENING_BALANCES");
  const [file, setFile] = useState<File | null>(null);
  const [run, setRun] = useState<ImportRun | null>(null);
  const [busy, setBusy] = useState<"upload" | "commit" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const input = useRef<HTMLInputElement>(null);

  const upload = async () => {
    if (!file) return;
    setBusy("upload");
    setError(null);
    try {
      setRun(await leaveAdminApi.importUpload(file, kind));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  const commit = async () => {
    if (!run) return;
    setBusy("commit");
    setError(null);
    try {
      const done = await leaveAdminApi.importCommit(run.id);
      setRun(done);
      toast.success(`Import committed: ${done.report.posted ?? done.report.valid} row(s) posted`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  const reset = () => {
    setRun(null);
    setFile(null);
    setError(null);
    if (input.current) input.current.value = "";
  };

  const committed = run?.status === "COMMITTED";
  return (
    <div className="space-y-5" data-testid="imports-tab">
      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-end gap-4">
          <Segmented label="What the file contains" value={kind} onChange={(k) => { setKind(k); reset(); }}
            options={[{ value: "OPENING_BALANCES", label: "Opening balances" }, { value: "BALANCE_ADJUSTMENTS", label: "Balance adjustments" }]} />
          <span className="flex-1" />
          <Button variant="ghost" onClick={() => downloadTemplate(kind)} data-testid="import-template"><Download className="h-4 w-4" /> Template</Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Columns: <span className="font-mono text-xs">{IMPORT_COLUMNS.join(", ")}</span>. Units have at most 2 decimals; dates are YYYY-MM-DD; up to 5,000 rows and 2 MB.
          {kind === "OPENING_BALANCES" ? " Opening balances must be positive." : " Negative units deduct."}
        </p>
        <label className={cn("flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-8 text-center transition-colors",
          file ? "border-primary/50 bg-primary-soft/30" : "border-border hover:border-muted-foreground/40")}>
          <FileSpreadsheet className="h-7 w-7 text-primary" aria-hidden />
          <span className="text-sm font-medium">{file ? file.name : "Choose a CSV file"}</span>
          <span className="text-xs text-muted-foreground">{file ? `${(file.size / 1024).toFixed(1)} KB` : "UTF-8, comma-separated"}</span>
          <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" data-testid="import-file"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setRun(null); setError(null); }} />
        </label>
        <div className="flex justify-end gap-2">
          {run && <Button variant="ghost" onClick={reset}>Start over</Button>}
          <Button onClick={() => void upload()} disabled={!file || committed} loading={busy === "upload"} data-testid="import-upload">
            <Upload className="h-4 w-4" /> Check file
          </Button>
        </div>
        <ErrorNotice error={error} />
      </Card>

      {run && (
        <MotionSafe>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="space-y-4 p-5" data-testid="import-report">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="flex-1 font-semibold">Import #{run.id} · {run.file_name}</h3>
                <Badge tone={committed ? "success" : run.report.error_count ? "danger" : "info"} dot>
                  {committed ? "Committed" : run.report.error_count ? "Has errors" : "Dry run — nothing posted yet"}
                </Badge>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-xl bg-success-soft p-3"><p className="text-xs text-muted-foreground">Valid rows</p><p className="text-xl font-semibold tabular-nums">{run.report.valid}</p></div>
                <div className={cn("rounded-xl p-3", run.report.error_count ? "bg-danger-soft" : "bg-surface-muted/60")}><p className="text-xs text-muted-foreground">Rows with errors</p><p className="text-xl font-semibold tabular-nums">{run.report.error_count}</p></div>
                <div className="rounded-xl bg-surface-muted/60 p-3"><p className="text-xs text-muted-foreground">{committed ? "Posted" : "Expires"}</p><p className="text-sm font-semibold">{committed ? run.report.posted ?? run.report.valid : fmtDateTime(run.expires_at)}</p></div>
              </div>
              {run.report.errors.length > 0 && (
                <div>
                  <p className="mb-1.5 text-sm font-medium text-danger">Fix these lines and upload again</p>
                  <ul className="scrollbar-thin max-h-56 space-y-1 overflow-auto rounded-xl border border-danger/30 p-2 text-sm" data-testid="import-errors">
                    {run.report.errors.map((e) => (
                      <li key={e.line} className="flex gap-2"><XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden /><span><strong>Line {e.line}:</strong> {e.errors.join("; ")}</span></li>
                    ))}
                  </ul>
                </div>
              )}
              {run.rows.length > 0 && (
                <div className="scrollbar-thin max-h-72 overflow-auto rounded-xl border border-border">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Rows to post</caption>
                    <thead className="sticky top-0 bg-surface-muted text-left text-xs text-muted-foreground">
                      <tr><th className="px-3 py-2">Line</th><th className="px-3 py-2">Employee</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Units</th><th className="px-3 py-2">Effective</th><th className="px-3 py-2">Expires</th><th className="px-3 py-2">Note</th></tr>
                    </thead>
                    <tbody>
                      {run.rows.map((r) => (
                        <tr key={r.line} className="border-t border-border/70">
                          <td className="px-3 py-1.5 text-muted-foreground">{r.line}</td>
                          <td className="px-3 py-1.5 font-mono text-xs">{r.employee_code}</td>
                          <td className="px-3 py-1.5 font-mono text-xs">{r.leave_type}</td>
                          <td className={cn("px-3 py-1.5 tabular-nums", r.units.startsWith("-") && "text-danger")}>{r.units}</td>
                          <td className="px-3 py-1.5">{fmtDate(r.effective_date)}</td>
                          <td className="px-3 py-1.5">{r.expires_on ? fmtDate(r.expires_on) : "—"}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{r.note ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {!committed && (
                <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-4">
                  {run.report.error_count > 0 ? (
                    <Notice tone="warning" title="Fix the errors first">An import with errors cannot be committed.</Notice>
                  ) : (
                    <>
                      <span className="text-sm text-muted-foreground">Committing posts {run.report.valid} ledger row(s) and asks you to confirm it&apos;s you.</span>
                      <Button onClick={() => void commit()} loading={busy === "commit"} data-testid="import-commit"><CheckCircle2 className="h-4 w-4" /> Commit import</Button>
                    </>
                  )}
                </div>
              )}
            </Card>
          </motion.div>
        </MotionSafe>
      )}
    </div>
  );
}
