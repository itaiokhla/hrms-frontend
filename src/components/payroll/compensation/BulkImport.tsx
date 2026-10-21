"use client";

import { CheckCircle2, Download, XCircle } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

import { FileDropzone } from "@/components/payroll/FileDropzone";
import { JobProgress } from "@/components/payroll/JobProgress";
import { useModalRoute } from "@/components/payroll/useModalRoute";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlay";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { newIdempotencyKey } from "@/lib/payroll/api";

import { compensationApi } from "./api";
import type { ImportDryRun, ImportRecord } from "./types";

const STEPS = ["Template", "Upload & check", "Commit"] as const;
const MAX_BYTES = 5_000_000;

function readText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/**
 * Bulk assign salaries from CSV (3.8 §6 "Import CSV", 3 steps): download the template, upload and
 * dry-run (every row checked, per-row errors), then commit as a background job (JobProgress) that
 * proposes each valid row for approval. Cells are treated as text, never formulas (server side).
 */
export function BulkImport({ onDone }: { onDone?: () => void }) {
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [dryRun, setDryRun] = useState<ImportDryRun | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);
  const [record, setRecord] = useState<ImportRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [commitKey] = useState(newIdempotencyKey);

  const check = async (f: File) => {
    setFile(f);
    setBusy(true);
    setError(null);
    setDryRun(null);
    try {
      const text = await readText(f);
      setDryRun(await compensationApi.importDryRun(text, f.name));
      setStep(2);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!dryRun) return;
    setBusy(true);
    setError(null);
    try {
      const result = await compensationApi.importCommit(dryRun.import_id, commitKey);
      setJobId(result.job.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const finished = async () => {
    if (!dryRun) return;
    try {
      const r = await compensationApi.getImport(dryRun.import_id);
      setRecord(r);
      toast.success("Import finished. The salaries are waiting for approval.");
      onDone?.();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const failedRows = record?.result?.rows.filter((r) => !r.ok) ?? [];

  const body = (
    <div className="space-y-5">
      <ol className="flex flex-wrap gap-2" aria-label="Import steps">
        {STEPS.map((label, i) => (
          <li key={label} aria-current={i === step ? "step" : undefined} className={cn("flex items-center gap-2 rounded-full px-3 py-1 text-sm", i === step ? "bg-primary-soft font-semibold text-primary" : i < step ? "text-success" : "text-muted-foreground")}>
            <span className="flex h-6 w-6 items-center justify-center rounded-full border text-xs">{i < step ? "✓" : i + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      {error && (
        <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {step === 0 && (
        <div className="space-y-3 text-sm">
          <p>
            One row per employee: <code className="font-mono">employee_code, structure_code, pay_basis_amount, effective_from</code> and optionally <code className="font-mono">currency, reason, note</code>. Add <code className="font-mono">override:CODE</code> columns for overridable lines.
          </p>
          <p className="text-muted-foreground">Amounts are plain numbers (1200000.00); dates are YYYY-MM-DD. Each row becomes a salary change waiting for approval.</p>
          <div className="flex flex-wrap gap-2">
            <a href={compensationApi.importTemplateUrl} download className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-border px-4 font-medium hover:bg-surface-muted">
              <Download className="h-4 w-4" aria-hidden /> Download template
            </a>
            <Button onClick={() => setStep(1)} className="min-h-[44px]">
              Next: upload
            </Button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-3">
          <FileDropzone accept={[".csv", "text/csv"]} maxBytes={MAX_BYTES} label="Upload the CSV" hint="Up to 5 MB and 5,000 rows. Nothing is saved until you commit." disabled={busy} onFiles={(files) => files[0] && void check(files[0])} />
          {busy && <p className="text-sm text-muted-foreground" aria-live="polite">Checking {file?.name}…</p>}
        </div>
      )}

      {step === 2 && dryRun && !jobId && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3 text-sm" aria-live="polite">
            <span className="inline-flex items-center gap-1 font-medium text-success">
              <CheckCircle2 className="h-4 w-4" aria-hidden /> {dryRun.summary.valid} ready
            </span>
            <span className={cn("inline-flex items-center gap-1 font-medium", dryRun.summary.invalid ? "text-danger" : "text-muted-foreground")}>
              <XCircle className="h-4 w-4" aria-hidden /> {dryRun.summary.invalid} with errors
            </span>
            <span className="text-muted-foreground">of {dryRun.summary.rows} rows in {file?.name}</span>
          </div>
          <div className="max-h-80 overflow-auto rounded-2xl border border-border">
            <table className="w-full text-sm">
              <caption className="sr-only">Dry-run results per row</caption>
              <thead className="sticky top-0 bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 text-start">Row</th>
                  <th scope="col" className="px-3 py-2 text-start">Employee</th>
                  <th scope="col" className="px-3 py-2 text-start">Result</th>
                </tr>
              </thead>
              <tbody>
                {dryRun.rows.map((r) => (
                  <tr key={r.row} className="border-t border-border/60 align-top">
                    <td className="px-3 py-2 tabular-nums">{r.row}</td>
                    <td className="px-3 py-2">
                      <bdi dir="ltr" className="font-mono text-xs">
                        {r.employee_code || "—"}
                      </bdi>
                    </td>
                    <td className="px-3 py-2">
                      {r.ok ? <span className="text-success">Ready</span> : (
                        <ul className="space-y-0.5 text-danger">
                          {r.errors.map((e, i) => (
                            <li key={i}>{e}</li>
                          ))}
                        </ul>
                      )}
                      {r.warnings.map((w, i) => (
                        <p key={i} className="text-xs text-warning">
                          {w}
                        </p>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setStep(1)} className="min-h-[44px]">
              Upload another file
            </Button>
            <Button onClick={commit} loading={busy} disabled={!dryRun.summary.valid} className="min-h-[44px]">
              Commit {dryRun.summary.valid} row{dryRun.summary.valid === 1 ? "" : "s"}
            </Button>
          </div>
          {dryRun.summary.invalid > 0 && dryRun.summary.valid > 0 && <p className="text-xs text-muted-foreground">Rows with errors are skipped; fix them and import them again.</p>}
        </div>
      )}

      {jobId && (
        <div className="space-y-3">
          <JobProgress jobId={jobId} title="Proposing salaries" successMessage="All valid rows were proposed for approval." failureMessage="The import job failed." onFinished={() => void finished()} />
          {record?.result && (
            <div className="text-sm">
              <p>
                {record.result.created_count} proposed for approval · {record.result.failed_count} failed
              </p>
              {failedRows.length > 0 && (
                <ul className="mt-2 space-y-1 text-danger">
                  {failedRows.map((r) => (
                    <li key={r.row}>
                      Row {r.row}: {r.error}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
  return body;
}

/** The import as a modal: ?modal=import&type=compensation. Full page: /payroll/compensation/import. */
export function BulkImportModal({ onDone }: { onDone?: () => void }) {
  const route = useModalRoute("import", { keys: ["type"] });
  return (
    <Modal open={route.open} onOpenChange={route.onOpenChange} title="Bulk assign salaries (CSV)" description="Template → upload and check → commit. Every row goes for approval." size="lg">
      {route.open && <BulkImport onDone={onDone} />}
      <p className="mt-4 text-xs text-muted-foreground">
        Prefer a page? <a className="text-primary hover:underline" href="/payroll/compensation/import">Open the import page ↗</a>
      </p>
    </Modal>
  );
}
