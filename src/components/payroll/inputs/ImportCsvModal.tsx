"use client";

import { ArrowUpRight, Check, Download } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { FileDropzone } from "@/components/payroll/FileDropzone";
import { JobProgress } from "@/components/payroll/JobProgress";
import { Button } from "@/components/ui/button";
import { Column, DataTable } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { cn } from "@/lib/cn";

import { fetchBlob, saveBlob, wageInputsApi } from "./api";
import { ConflictBanner, ErrorSummary, LocalStatusChip, errorText } from "./shared";
import type { ImportRow, WageInputImport } from "./types";

/** wage_inputs.MAX_IMPORT_BYTES (2 MB) and MAX_IMPORT_ROWS (5000). */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5000;
const RECENT_KEY = "payroll.wageInputImports";

/** Imports opened in this browser (a per-viewer convenience: there is no imports list API yet). */
export function recentImports(): number[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const ids = raw ? (JSON.parse(raw) as unknown[]) : [];
    return ids.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n > 0).slice(0, 20);
  } catch {
    return [];
  }
}

export function rememberImport(id: number) {
  try {
    const ids = [id, ...recentImports().filter((n) => n !== id)].slice(0, 20);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(ids));
  } catch {
    /* storage blocked: the history just stays empty */
  }
}

const STEPS = ["Template", "Upload", "Check results", "Import"];

function Steps({ current }: { current: number }) {
  return (
    <ol className="mb-5 grid grid-cols-4 gap-2" aria-label="Import steps">
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} aria-current={active ? "step" : undefined} className="min-w-0">
            <div className={cn("h-1 rounded-full transition-colors duration-300", done || active ? "bg-primary" : "bg-muted")} />
            <p className={cn("mt-1.5 flex items-center gap-1 truncate text-xs", active ? "font-medium text-foreground" : "text-muted-foreground")}>
              {done && <Check className="h-3 w-3" aria-hidden />}
              {label}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

export function ImportRowsTable({ rows }: { rows: ImportRow[] }) {
  const columns: Column<ImportRow>[] = [
    { key: "row", header: "Row", primary: true, cell: (r) => <span className="tabular-nums">Row {r.row}</span> },
    { key: "employee", header: "Employee code", cell: (r) => r.employee_code ?? "—" },
    {
      key: "result",
      header: "Result",
      cell: (r) =>
        r.ok ? (
          <span className="text-success">OK</span>
        ) : (
          <ul className="list-disc ps-4 text-danger">
            {r.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        ),
    },
  ];
  return <DataTable columns={columns} rows={rows} rowKey={(r) => r.row} cardBelowMd caption="Rows checked in the dry run" />;
}

export interface ImportCsvModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Reopen an existing import (`?modal=import&id=`). */
  importId?: string | null;
  canImport: boolean;
  onImported?: () => void;
}

/**
 * Import CSV (3.8 §6, `lg`, 3 steps + commit): download the template → upload (a dry run; nothing is
 * created) → per-row results → commit as a background job with progress. Files over 2 MB or 5,000
 * rows are refused by the API; formula-looking cells are refused too (CSV injection).
 */
export function ImportCsvModal({ open, onOpenChange, importId, canImport, onImported }: ImportCsvModalProps) {
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<WageInputImport | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setJobId(null);
    if (importId) {
      setBusy(true);
      wageInputsApi
        .getImport(importId)
        .then((row) => {
          setResult(row);
          setStep(row.status === "COMMITTING" || row.status === "COMMITTED" || row.status === "FAILED" ? 3 : 2);
          if (row.status === "COMMITTING") setJobId(row.job_id);
        })
        .catch(setError)
        .finally(() => setBusy(false));
    } else {
      setResult(null);
      setStep(0);
    }
  }, [open, importId]);

  const downloadTemplate = async () => {
    try {
      saveBlob(await fetchBlob(wageInputsApi.templateUrl), "wage-inputs-template.csv");
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const downloadResult = async (id: number) => {
    try {
      saveBlob(await fetchBlob(wageInputsApi.resultUrl(id)), `import-${id}-result.csv`);
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const upload = async (file: File, onProgress: (p: number) => void) => {
    setError(null);
    try {
      const row = await wageInputsApi.dryRun(file, onProgress);
      rememberImport(row.id);
      setResult(row);
      setStep(2);
    } catch (e) {
      setError(e);
      throw e;
    }
  };

  const commit = async () => {
    if (!result) return;
    setBusy(true);
    setError(null);
    try {
      const queued = await wageInputsApi.commitImport(result.id);
      setResult({ ...result, status: queued.status, job_id: queued.job_id });
      setJobId(queued.job_id);
      setStep(3);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const errorRows = (result?.rows ?? []).filter((r) => !r.ok);
  const okCount = (result?.row_count ?? 0) - (result?.error_count ?? 0);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Import wage inputs from CSV"
      description="Checked row by row first; nothing is created until you import."
      footer={
        <>
          {result && (
            <Link href={`/payroll/inputs/imports/${result.id}`} className="me-auto inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-primary hover:underline">
              Open full page <ArrowUpRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
            </Link>
          )}
          <Button variant="ghost" className="min-h-[44px]" onClick={() => onOpenChange(false)}>
            {step === 3 ? "Close" : "Cancel"}
          </Button>
          {step === 0 && (
            <Button className="min-h-[44px]" onClick={() => setStep(1)} disabled={!canImport}>
              Next: upload
            </Button>
          )}
          {step === 2 && result && (
            <>
              <Button variant="secondary" className="min-h-[44px]" onClick={() => setStep(1)}>
                Upload another file
              </Button>
              <Button className="min-h-[44px]" loading={busy} disabled={result.status !== "VALIDATED" || !canImport} onClick={commit}>
                Import {okCount} row{okCount === 1 ? "" : "s"}
              </Button>
            </>
          )}
        </>
      }
    >
      <Steps current={step} />
      <div className="space-y-4">
        <ConflictBanner error={error} />
        <ErrorSummary error={error} />
        {!canImport && <p className="text-sm text-muted-foreground">Your role can view imports but not import files.</p>}
        {step === 0 && (
          <div className="space-y-3 text-sm">
            <p>
              Use the template&apos;s columns: <code className="rounded bg-muted px-1">employee_code</code>, <code className="rounded bg-muted px-1">component_code</code>,{" "}
              <code className="rounded bg-muted px-1">amount</code> or <code className="rounded bg-muted px-1">units</code>/<code className="rounded bg-muted px-1">rate</code>,{" "}
              <code className="rounded bg-muted px-1">currency</code>, <code className="rounded bg-muted px-1">period_start</code>, <code className="rounded bg-muted px-1">period_end</code>,{" "}
              <code className="rounded bg-muted px-1">external_ref</code>, <code className="rounded bg-muted px-1">reason</code>.
            </p>
            <p className="text-muted-foreground">Dates as YYYY-MM-DD. Amounts with a dot for decimals. Up to {MAX_IMPORT_ROWS.toLocaleString()} rows and 2 MB.</p>
            <Button variant="secondary" className="min-h-[44px]" onClick={downloadTemplate}>
              <Download className="h-4 w-4" aria-hidden /> Download template
            </Button>
          </div>
        )}
        {step === 1 && canImport && (
          <FileDropzone accept={[".csv", "text/csv"]} maxBytes={MAX_IMPORT_BYTES} label="Upload your CSV" hint="We check every row; nothing is saved yet." upload={upload} />
        )}
        {step >= 2 && result && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-medium">{result.file_name}</span>
              <LocalStatusChip vocabulary="import" code={result.status} />
              <span className="text-muted-foreground">
                {result.row_count} row{result.row_count === 1 ? "" : "s"} · {result.error_count} with errors
              </span>
            </div>
            {step === 2 && result.status === "INVALID" && (
              <p role="alert" className="text-sm text-danger">
                Fix the rows below in your file and upload it again. Nothing was imported.
              </p>
            )}
            {step === 2 && errorRows.length > 0 && <ImportRowsTable rows={errorRows} />}
            {step === 2 && result.status === "VALIDATED" && (
              <p className="text-sm text-muted-foreground">All rows passed. Importing creates the inputs; those above your approval threshold wait for approval.</p>
            )}
          </div>
        )}
        {step === 3 && result && (
          <div className="space-y-3">
            {jobId ? (
              <JobProgress
                jobId={jobId}
                title="Importing wage inputs"
                successMessage="Import finished."
                failureMessage="The import failed. Download the result file to see why."
                onFinished={() => {
                  onImported?.();
                  void wageInputsApi.getImport(result.id).then(setResult).catch(() => undefined);
                }}
              />
            ) : (
              <p className="text-sm text-muted-foreground">This import has already been processed.</p>
            )}
            {(result.status === "COMMITTED" || result.status === "FAILED") && (
              <Button variant="secondary" className="min-h-[44px]" onClick={() => downloadResult(result.id)}>
                <Download className="h-4 w-4" aria-hidden /> Download result file
              </Button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
