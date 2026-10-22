"use client";

import { CheckCircle2, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";

import { FileDropzone } from "@/components/payroll/FileDropzone";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { newIdempotencyKey } from "@/lib/payroll/api";

import { MatchesTable } from "./Reconciliation";
import { reconApi } from "./api";
import { ConflictBanner, ErrorSummary, Notice, fieldErrors, humanize } from "./shared";
import type { CsvMapping, FundingAccount, ImportStatementResult } from "./types";

export const MAX_STATEMENT_BYTES = 10 * 1024 * 1024;

/* ------------------------------------------------------------------ pure helpers (tested) */

export type StatementFormat = "CSV" | "CAMT053";

/** CAMT.053 is XML with the camt.053 namespace (or a BkToCstmrStmt root); everything else is read as CSV. */
export function detectFormat(fileName: string, head: string): StatementFormat {
  const text = head.trimStart().slice(0, 4000);
  if (/camt\.053/i.test(text) || /<BkToCstmrStmt/i.test(text)) return "CAMT053";
  if (/\.xml$/i.test(fileName) || text.startsWith("<?xml") || text.startsWith("<Document")) return "CAMT053";
  return "CSV";
}

export function guessDelimiter(headerLine: string): string {
  const counts = [",", ";", "\t", "|"].map((d) => [d, headerLine.split(d).length - 1] as const);
  const best = counts.sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : ",";
}

/** Split one CSV line, honouring double quotes. */
export function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export interface CsvPreview {
  delimiter: string;
  headers: string[];
  rows: string[][];
}

export function previewCsv(text: string, skipRows = 0, maxRows = 5): CsvPreview {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "").slice(skipRows);
  const delimiter = guessDelimiter(lines[0] ?? "");
  return { delimiter, headers: splitCsvLine(lines[0] ?? "", delimiter), rows: lines.slice(1, 1 + maxRows).map((l) => splitCsvLine(l, delimiter)) };
}

const GUESSES: [keyof CsvMapping, RegExp][] = [
  ["booking_date", /^(booking|book(ed)?)\s*date|posting date/i],
  ["date", /^(value\s*date|date|txn date|transaction date)$/i],
  ["debit", /^(debit|withdrawal|dr)( amount)?$/i],
  ["credit", /^(credit|deposit|cr)( amount)?$/i],
  ["amount", /^amount|^value$/i],
  ["direction", /^(dr\/cr|cr\/dr|direction|type|d\/c)$/i],
  ["currency", /^(currency|ccy|cur)$/i],
  ["reference", /reference|^ref$|end.?to.?end|payment id/i],
  ["counterparty_account", /(beneficiary|counterparty|payee).*(account|iban)|^account( number)?$/i],
  ["counterparty", /beneficiary|counterparty|payee|name/i],
  ["remittance", /remittance|narration|description|details|memo/i],
];

/** Best-effort mapping from header names; the person confirms or changes every column. */
export function guessMapping(headers: string[]): Partial<CsvMapping> {
  const used = new Set<string>();
  const out: Partial<CsvMapping> = {};
  GUESSES.forEach(([field, re]) => {
    const hit = headers.find((h) => !used.has(h) && re.test(h.trim()));
    if (hit && !out[field]) {
      (out as Record<string, string>)[field] = hit;
      used.add(hit);
    }
  });
  if (out.amount && (out.debit || out.credit)) {
    delete out.debit;
    delete out.credit;
  }
  return out;
}

/** Client-side checks that mirror `CsvColumnMapping.validate` so the person sees them before uploading. */
export function mappingProblems(m: Partial<CsvMapping>): Record<string, string> {
  const p: Record<string, string> = {};
  if (!m.date) p.date = "Choose the date column.";
  const split = !!(m.debit || m.credit);
  if (!m.amount && !split) p.amount = "Choose an amount column, or separate debit and credit columns.";
  if (m.amount && split) p.amount = "Use either one amount column or debit and credit columns, not both.";
  if (split && (!m.debit || !m.credit)) p.debit = "Debit and credit columns go together.";
  if (m.direction && !m.amount) p.direction = "A direction column needs an amount column.";
  if (!m.currency && !m.default_currency) p.currency = "Choose a currency column or give the statement's currency.";
  if (m.default_currency && !/^[A-Z]{3}$/.test(m.default_currency)) p.currency = "The currency is a three-letter code, such as INR.";
  return p;
}

async function readText(file: File, bytes = 64 * 1024): Promise<string> {
  const part = file.slice(0, bytes);
  if (typeof (part as Blob).text === "function") return (part as Blob).text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(part);
  });
}

/* ------------------------------------------------------------------ modal */

const FIELD_LABELS: [keyof CsvMapping, string, boolean][] = [
  ["date", "Value date", true],
  ["amount", "Amount (signed)", false],
  ["debit", "Debit", false],
  ["credit", "Credit", false],
  ["direction", "Debit/credit indicator", false],
  ["currency", "Currency", false],
  ["reference", "Payment reference", false],
  ["counterparty", "Beneficiary name", false],
  ["counterparty_account", "Beneficiary account", false],
  ["remittance", "Description", false],
  ["booking_date", "Booking date", false],
];

/**
 * Import bank statement (3.8 §6, `?modal=import-statement`): funding account → file (format
 * detected: CSV or CAMT.053) → CSV column mapping with a preview → import and see the match results.
 * The server ignores a file or line it already has (by hash), so a retry never double-counts.
 */
export function ImportStatementModal({
  open,
  onOpenChange,
  fundingAccounts,
  fundingAllowed,
  knownFundingIds,
  onImported,
  onDirtyChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  fundingAccounts: FundingAccount[];
  fundingAllowed: boolean;
  knownFundingIds: number[];
  onImported: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [fundingId, setFundingId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<StatementFormat>("CSV");
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [mapping, setMapping] = useState<Partial<CsvMapping>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportStatementResult | null>(null);
  const key = useRef(newIdempotencyKey());

  useEffect(() => {
    if (!open) return;
    setFundingId(fundingAccounts.length === 1 ? String(fundingAccounts[0].id) : "");
    setFile(null);
    setPreview(null);
    setMapping({});
    setErrors({});
    setError(null);
    setResult(null);
    key.current = newIdempotencyKey();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => onDirtyChange?.(!!file && !result), [file, result, onDirtyChange]);

  const account = fundingAccounts.find((a) => String(a.id) === fundingId);

  const choose = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setResult(null);
    setError(null);
    key.current = newIdempotencyKey();
    const head = await readText(f).catch(() => "");
    const fmt = detectFormat(f.name, head);
    setFormat(fmt);
    if (fmt === "CSV") {
      const p = previewCsv(head);
      setPreview(p);
      setMapping({ ...guessMapping(p.headers), delimiter: p.delimiter, default_currency: account?.currency });
    } else {
      setPreview(null);
      setMapping({});
    }
  };

  const setField = (field: keyof CsvMapping, value: string) => {
    setMapping((m) => {
      const next = { ...m } as Record<string, unknown>;
      if (value) next[field] = value;
      else delete next[field];
      return next as Partial<CsvMapping>;
    });
    setErrors({});
  };

  const submit = async () => {
    const next: Record<string, string> = {};
    if (!fundingId) next.funding = "Choose the funding account this statement belongs to.";
    if (!file) next.file = "Attach the statement file.";
    if (format === "CSV") Object.assign(next, mappingProblems(mapping));
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    setError(null);
    try {
      const clean = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v !== "" && v !== undefined)) as unknown as CsvMapping;
      // The parser refuses equal separators: a decimal comma implies a thousands point unless chosen.
      if (clean.decimal_separator === "," && clean.thousands_separator === undefined) clean.thousands_separator = ".";
      const res = await reconApi.importStatement({ funding_account_id: Number(fundingId), format, mapping: format === "CSV" ? clean : null, file: file as File }, key.current);
      setResult(res);
      toast.success(res.duplicate ? "This statement was already imported — nothing new was added" : `Statement imported: ${res.import.new_line_count} new line(s) reconciled`);
      onImported();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const fundingOptions = useMemo(() => {
    if (fundingAllowed) return fundingAccounts.filter((a) => a.status === "ACTIVE").map((a) => ({ id: a.id, label: `${a.name} · ${a.currency} · ${a.account_masked}` }));
    return knownFundingIds.map((id) => ({ id, label: `Funding account #${id}` }));
  }, [fundingAllowed, fundingAccounts, knownFundingIds]);

  const columnSelect = (field: keyof CsvMapping, label: string, required: boolean) => (
    <Field key={field} label={label} required={required} error={errors[field]}>
      <Select value={(mapping[field] as string | undefined) ?? ""} onChange={(e) => setField(field, e.target.value)} className="min-h-[44px]">
        <option value="">{required ? "Choose…" : "Not in this file"}</option>
        {(preview?.headers ?? []).map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </Select>
    </Field>
  );

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Import bank statement"
      description="CSV (with a column mapping) or CAMT.053. Matching runs on import; the same file or line is never imported twice."
      footer={
        result ? (
          <Button className="min-h-[44px]" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" className="min-h-[44px]" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button className="min-h-[44px]" loading={busy} onClick={submit}>
              Import and match
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-4">
          <Notice tone={result.duplicate ? "warning" : "info"} title={result.duplicate ? "Already imported" : `${result.import.new_line_count} new line(s) of ${result.import.line_count}`}>
            {result.duplicate ? "This exact file was imported before, so nothing changed." : "Lines already imported from an earlier statement were skipped."}
          </Notice>
          {Object.keys(result.import.counts).length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Match results">
              {Object.entries(result.import.counts).map(([status, n]) => (
                <li key={status} className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> {humanize(status)}: <span className="tabular-nums">{n}</span>
                </li>
              ))}
            </ul>
          )}
          {result.import.rejected.length > 0 && (
            <Notice tone="warning" title={`${result.import.rejected.length} row(s) could not be read`}>
              <ul className="list-disc ps-5">
                {result.import.rejected.slice(0, 10).map((r, i) => (
                  <li key={i}>
                    {r.source_row ? `Row ${r.source_row}: ` : ""}
                    {r.message}
                  </li>
                ))}
              </ul>
            </Notice>
          )}
          {result.matches.length > 0 && (
            <div className="rounded-2xl border border-border">
              <MatchesTable matches={result.matches} />
            </div>
          )}
          <Link href={`/payroll/payments/reconciliation/statements/${result.import.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
            Open the statement <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          <ConflictBanner error={error} />
          <ErrorSummary error={error} fields={{ ...fieldErrors(error), ...errors }} />
          <Field label="Funding account" required error={errors.funding} hint={fundingAllowed ? undefined : "Your role can't list funding accounts; accounts already used by statements are offered, or enter the number."}>
            {fundingOptions.length ? (
              <Select value={fundingId} onChange={(e) => setFundingId(e.target.value)} className="min-h-[44px]">
                <option value="">Choose…</option>
                {fundingOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </Select>
            ) : (
              <Input inputMode="numeric" value={fundingId} onChange={(e) => setFundingId(e.target.value.replace(/\D/g, ""))} className="min-h-[44px]" />
            )}
          </Field>
          <div>
            <FileDropzone accept={[".csv", ".txt", ".xml"]} maxBytes={MAX_STATEMENT_BYTES} label="Statement file" hint="CSV or CAMT.053 XML, up to 10 MB" onFiles={choose} />
            {errors.file && <p role="alert" className="mt-1 text-sm text-danger">{errors.file}</p>}
          </div>
          {file && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <p className="text-sm">
                  <span className="font-medium">{file.name}</span> — detected as <strong>{format === "CAMT053" ? "CAMT.053" : "CSV"}</strong>
                </p>
                <Field label="Format">
                  <Select value={format} onChange={(e) => setFormat(e.target.value as StatementFormat)} className="min-h-[44px]">
                    <option value="CSV">CSV</option>
                    <option value="CAMT053">CAMT.053</option>
                  </Select>
                </Field>
              </div>
              {format === "CSV" && preview && (
                <>
                  <div className="overflow-x-auto rounded-xl border border-border">
                    <table className="w-full text-xs">
                      <caption className="sr-only">First rows of the statement</caption>
                      <thead>
                        <tr>
                          {preview.headers.map((h) => (
                            <th key={h} scope="col" className="whitespace-nowrap px-2 py-1.5 text-start font-medium">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.rows.map((r, i) => (
                          <tr key={i} className="border-t border-border">
                            {r.map((c, j) => (
                              <td key={j} className="whitespace-nowrap px-2 py-1.5">
                                <bdi dir="ltr">{c}</bdi>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <fieldset className="grid gap-3 sm:grid-cols-2">
                    <legend className="mb-1 text-sm font-semibold">Which column is which?</legend>
                    {FIELD_LABELS.map(([f, label, required]) => columnSelect(f, label, required))}
                    <Field label="Statement currency (if no currency column)" error={errors.currency}>
                      <Input value={mapping.default_currency ?? ""} maxLength={3} onChange={(e) => setField("default_currency", e.target.value.toUpperCase())} className="min-h-[44px]" />
                    </Field>
                    <Field label="Date format" hint="For example %d/%m/%Y">
                      <Input value={mapping.date_format ?? "%Y-%m-%d"} onChange={(e) => setField("date_format", e.target.value)} className="min-h-[44px]" />
                    </Field>
                    <Field label="Decimal separator">
                      <Select value={mapping.decimal_separator ?? "."} onChange={(e) => setField("decimal_separator", e.target.value)} className="min-h-[44px]">
                        <option value=".">Point (1,234.56)</option>
                        <option value=",">Comma (1.234,56)</option>
                      </Select>
                    </Field>
                  </fieldset>
                </>
              )}
              {format === "CAMT053" && <p className="text-sm text-muted-foreground">CAMT.053 files name their account; it must be this funding account&apos;s.</p>}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
