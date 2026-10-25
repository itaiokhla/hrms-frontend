"use client";

import { BadgeCheck, FileWarning, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { api, ApiError } from "@/lib/api";
import { fmtDate } from "@/lib/format";

/** What `GET /api/v1/documents/verify/{public_id}` may disclose (EC-DOC-18): never amounts. */
export interface VerifiedDocument {
  valid: boolean;
  issuer: string;
  document_type: string;
  issue_date: string;
  number: string;
  name: string | null;
  status: "ISSUED" | "SUPERSEDED" | "REVERSED";
}

type State =
  | { kind: "loading" }
  | { kind: "found"; doc: VerifiedDocument }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

const PUBLIC_ID = /^[A-Za-z0-9_-]{8,64}$/;

const STATUS_TEXT: Record<VerifiedDocument["status"], string> = {
  ISSUED: "This document was issued as shown and is current.",
  SUPERSEDED: "This document was issued but has since been replaced by a newer version.",
  REVERSED: "This document was issued but has since been reversed.",
};

/**
 * The page printed on payslips and other payroll documents ("Verify this document at …/verify/{id}",
 * 3.6 verification QR). Public: no session, the host's brand. Shows only the issuer, document type,
 * issue date, number and the masked name; unknown ids, drafts and other tenants' documents on a tenant
 * host are all "not found" (the API answers 404 for each, so nothing tells them apart).
 */
export function DocumentVerification({ publicId }: { publicId: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    if (!PUBLIC_ID.test(publicId)) {
      setState({ kind: "not-found" });
      return;
    }
    setState({ kind: "loading" });
    api
      .get<VerifiedDocument>(`/documents/verify/${encodeURIComponent(publicId)}`)
      .then((doc) => live && setState({ kind: "found", doc }))
      .catch((e: unknown) => {
        if (!live) return;
        if (e instanceof ApiError && e.status === 404) setState({ kind: "not-found" });
        else if (e instanceof ApiError && e.status === 429) setState({ kind: "error", message: "Too many checks from this network. Try again in a minute." });
        else setState({ kind: "error", message: "The document could not be checked right now. Try again later." });
      });
    return () => {
      live = false;
    };
  }, [publicId]);

  if (state.kind === "loading") {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Checking the document…
      </p>
    );
  }
  if (state.kind === "not-found") {
    return (
      <div role="alert" className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4" data-testid="verify-not-found">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden />
        <div>
          <p className="font-semibold">No document matches this link</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Check that the address is complete. A document that was never issued, or was issued by another organisation, cannot be verified here.
          </p>
        </div>
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div role="alert" className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/5 p-4">
        <FileWarning className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
        <p className="text-sm">{state.message}</p>
      </div>
    );
  }
  const { doc } = state;
  const current = doc.status === "ISSUED";
  return (
    <div data-testid="verify-result">
      <div className={`flex items-start gap-3 rounded-xl border p-4 ${current ? "border-success/30 bg-success/5" : "border-warning/30 bg-warning/5"}`}>
        {current ? <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden /> : <FileWarning className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />}
        <div>
          <p className="font-semibold">{current ? "Genuine document" : "Genuine, but no longer current"}</p>
          <p className="mt-1 text-sm text-muted-foreground">{STATUS_TEXT[doc.status]}</p>
        </div>
      </div>
      <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
        <dt className="text-muted-foreground">Issued by</dt>
        <dd className="font-medium">{doc.issuer}</dd>
        <dt className="text-muted-foreground">Document</dt>
        <dd className="font-medium">{doc.document_type}</dd>
        <dt className="text-muted-foreground">Number</dt>
        <dd className="font-medium tabular-nums">{doc.number}</dd>
        <dt className="text-muted-foreground">Issue date</dt>
        <dd className="font-medium">{fmtDate(doc.issue_date)}</dd>
        {doc.name && (
          <>
            <dt className="text-muted-foreground">Issued to</dt>
            <dd className="font-medium">{doc.name}</dd>
          </>
        )}
      </dl>
      <p className="mt-6 text-xs text-muted-foreground">Amounts are never shown on this page. Ask the issuer if you need to confirm figures.</p>
    </div>
  );
}
