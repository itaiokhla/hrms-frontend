"use client";

import { BadgeCheck, Download, FileCheck2, FileX2, RefreshCw } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

import { ReasonModal } from "@/components/payroll/inputs/shared";
import { Button } from "@/components/ui/button";
import { DataTable, EmptyState, ErrorState, type Column } from "@/components/ui/layout";
import { Badge, Card } from "@/components/ui/primitives";
import { downloadFile } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fmtDateTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { leaveAdminApi } from "@/lib/leave/adminApi";
import type { QueueDocument } from "@/lib/leave/adminTypes";

import { humanize } from "../shared";

/** Documents queue (09-ui-ux/02 §10): submitted documents waiting for verification; view, verify or reject. */
export function DocumentsTab() {
  const queue = useApi(() => leaveAdminApi.documentsQueue(), []);
  const [busy, setBusy] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState<QueueDocument | null>(null);

  const verify = async (doc: QueueDocument) => {
    setBusy(doc.id);
    try {
      await leaveAdminApi.verifyDocument(doc.id, true);
      toast.success(`${doc.original_name} verified`);
      void queue.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't verify the document.");
    } finally {
      setBusy(null);
    }
  };
  const view = async (doc: QueueDocument) => {
    try {
      await downloadFile(leaveAdminApi.documentUrl(doc.id), doc.original_name);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't open the document.");
    }
  };

  const columns: Column<QueueDocument>[] = [
    { key: "employee", header: "Employee", primary: true, cell: (d) => <span className="font-medium">{d.employee_name}</span> },
    { key: "category", header: "Document", cell: (d) => <span className="min-w-0"><span className="block">{humanize(d.category)}</span><span className="block truncate text-xs text-muted-foreground">{d.original_name}</span></span> },
    { key: "leave", header: "Request", hideOnMobile: true, cell: (d) => (d.leave_id ? `#${d.leave_id}` : "—") },
    { key: "scan", header: "Scan", hideOnMobile: true, cell: (d) => <Badge tone={d.scan_status === "CLEAN" ? "success" : d.scan_status === "INFECTED" ? "danger" : "neutral"}>{humanize(d.scan_status)}</Badge> },
    { key: "uploaded", header: "Uploaded", hideOnMobile: true, cell: (d) => fmtDateTime(d.created_at) },
    {
      key: "actions",
      header: "",
      hideInCard: false,
      cell: (d) => (
        <span className="flex flex-wrap justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
          {d.can_view && <Button size="sm" variant="ghost" onClick={() => void view(d)} aria-label={`Open ${d.original_name}`}><Download className="h-4 w-4" /></Button>}
          {d.can_verify && (
            <>
              <Button size="sm" variant="success" loading={busy === d.id} onClick={() => void verify(d)} data-testid={`verify-${d.id}`}><FileCheck2 className="h-4 w-4" /> Verify</Button>
              <Button size="sm" variant="danger-ghost" onClick={() => setRejecting(d)} data-testid={`reject-${d.id}`}><FileX2 className="h-4 w-4" /> Reject</Button>
            </>
          )}
        </span>
      ),
    },
  ];

  return (
    <Card className="p-4 sm:p-5" data-testid="documents-tab">
      <div className="mb-4 flex items-center gap-3">
        <p className="flex-1 text-sm text-muted-foreground">Medical certificates and other evidence waiting for HR. Sensitive documents open only with the matching permission; every view is logged.</p>
        <Button variant="ghost" size="icon" aria-label="Refresh" onClick={() => void queue.reload()}><RefreshCw className={cn("h-4 w-4", queue.loading && "animate-spin")} /></Button>
      </div>
      {queue.error && !queue.data ? <ErrorState message={queue.error.message} onRetry={() => void queue.reload()} /> : (
        <DataTable caption="Documents waiting for verification" columns={columns} rows={queue.data} loading={queue.loading && !queue.data} rowKey={(d) => d.id} cardBelowMd
          empty={<EmptyState icon={<BadgeCheck />} title="Nothing to verify" description="New documents appear here when employees upload them." />} />
      )}
      <ReasonModal
        open={!!rejecting}
        onOpenChange={(o) => !o && setRejecting(null)}
        title="Reject document"
        consequence={`The employee is told ${rejecting?.original_name ?? "the document"} was rejected and why, and can upload another.`}
        confirmLabel="Reject document"
        danger
        onSubmit={async (reason) => {
          if (!rejecting) return;
          await leaveAdminApi.verifyDocument(rejecting.id, false, reason);
          toast.success("Document rejected");
          setRejecting(null);
          void queue.reload();
        }}
      />
    </Card>
  );
}
