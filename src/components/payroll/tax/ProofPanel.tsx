"use client";

import { Download, Paperclip } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

import { FileDropzone } from "@/components/payroll/FileDropzone";
import { saveFile } from "@/components/payroll/me/api";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";

import { taxApi } from "./api";
import { formatBytes } from "./shared";
import type { TaxField, TaxProof, TaxVersion } from "./types";

const ACCEPT = [".pdf", ".png", ".jpg", ".jpeg", "application/pdf", "image/png", "image/jpeg"];
const MAX_BYTES = 10 * 1024 * 1024;

export interface ProofPanelProps {
  version: TaxVersion;
  schema: TaxField[];
  /** Employee view uploads and downloads its own proofs; HR view only downloads. */
  mode: "employee" | "staff";
  onChanged?: () => void;
}

/**
 * Proofs of a submitted version, field by field (3.2 §7.3). A field the pack wants proven shows "Proof required"
 * until one is attached; HR cannot approve it without. Files are PDF, PNG or JPEG, stored privately; every
 * download is logged. Only fields with a declared value take a proof, never an identifier.
 */
export function ProofPanel({ version, schema, mode, onChanged }: ProofPanelProps) {
  const [open, setOpen] = useState<string | null>(null);
  const fields = schema.filter((f) => f.type !== "IDENTIFIER" && version.values[f.code] !== undefined && version.values[f.code] !== "");
  const byField = (code: string): TaxProof[] => version.proofs.filter((p) => p.field_code === code);
  const canUpload = mode === "employee" && version.status === "SUBMITTED";
  if (!fields.length) return null;

  const download = async (proof: TaxProof) => {
    try {
      const path = mode === "employee" ? taxApi.proofPath(version.id, proof.id) : taxApi.staffProofPath(version.id, proof.id);
      await saveFile(path, proof.file_name);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <section aria-label="Proofs" className="space-y-3">
      <h3 className="text-sm font-semibold">Proofs</h3>
      <ul className="divide-y divide-border rounded-2xl border border-border">
        {fields.map((field) => {
          const proofs = byField(field.code);
          const missing = version.proofs_missing.includes(field.code);
          return (
            <li key={field.code} className="space-y-2 p-3" data-field={field.code}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 text-sm font-medium">{field.label}</span>
                <span className="flex items-center gap-2">
                  {missing && (
                    <span className={cn("rounded-full bg-warning-soft px-2.5 py-0.5 text-xs font-medium text-warning")}>Proof required</span>
                  )}
                  {!missing && field.proof_required && proofs.length > 0 && (
                    <span className="rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-medium text-success">Proof attached</span>
                  )}
                  {canUpload && (
                    <Button variant="secondary" size="sm" className="min-h-[44px]" onClick={() => setOpen(open === field.code ? null : field.code)} aria-expanded={open === field.code}>
                      <Paperclip className="h-4 w-4" aria-hidden /> Add proof
                    </Button>
                  )}
                </span>
              </div>
              {proofs.length > 0 && (
                <ul className="space-y-1">
                  {proofs.map((proof) => (
                    <li key={proof.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate">
                        <bdi dir="auto">{proof.file_name}</bdi> <span className="text-muted-foreground">({formatBytes(proof.bytes)})</span>
                      </span>
                      <Button variant="ghost" size="sm" className="min-h-[44px]" onClick={() => void download(proof)} aria-label={`Download ${proof.file_name}`}>
                        <Download className="h-4 w-4" aria-hidden />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {mode === "staff" && proofs.length === 0 && <p className="text-xs text-muted-foreground">No proof attached.</p>}
              {canUpload && open === field.code && (
                <FileDropzone
                  accept={ACCEPT}
                  maxBytes={MAX_BYTES}
                  label={`Upload a proof for ${field.label}`}
                  hint="PDF, PNG or JPEG, up to 10 MB. It is stored privately and only HR can open it."
                  upload={async (file, onProgress) => {
                    await taxApi.addProof(version.id, field.code, file, onProgress);
                    toast.success("Proof added.");
                    onChanged?.();
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
