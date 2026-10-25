"use client";

import { useParams } from "next/navigation";

import { AuthShell } from "@/components/layout/AuthShell";
import { DocumentVerification } from "@/components/payroll/documents/DocumentVerification";

/**
 * Public verification page printed on payroll documents ("Verify this document at {host}/verify/{id}",
 * 3.6 verification QR, EC-DOC-18). No session needed; rendered in the brand of the host it is opened on.
 */
export default function VerifyDocumentPage() {
  const params = useParams<{ publicId: string }>();
  return (
    <AuthShell title="Verify a document" subtitle="Confirms that a payroll document was issued, by whom and when.">
      <DocumentVerification publicId={String(params?.publicId ?? "")} />
    </AuthShell>
  );
}
