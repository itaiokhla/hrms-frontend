"use client";

import { Download, FileArchive, FileSpreadsheet, FileText, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { Button } from "@/components/ui/button";
import { Column, DataTable, EmptyState, ErrorState } from "@/components/ui/layout";
import { Card } from "@/components/ui/primitives";
import { can, canBeyondSelf } from "@/lib/access";
import { ApiError } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";

import { exportsApi, fetchBlob, openSignedLink, saveBlob } from "./api";
import { LocalStatusChip, Notice, WorkspaceHeader, errorText, formatBytes, formatDateTime, human } from "./shared";
import type { DocumentExport, ReportExport } from "./types";

const POLL_MS = 4000;
const ACTIVE = new Set(["QUEUED", "GENERATING"]);

export interface DownloadRow {
  key: string;
  source: "document" | "report";
  id: number;
  title: string;
  detail: string | null;
  status: string;
  createdAt: string | null;
  expiresAt: string | null;
  fileName: string | null;
  bytes: number | null;
  error: string | null;
  note: string | null;
}

const KIND_TITLE: Record<string, string> = {
  PAYSLIPS_ZIP: "Payslips (ZIP)",
  REGISTER_CSV: "Payroll register (CSV)",
  REGISTER_XLSX: "Payroll register (XLSX)",
};

export function documentRow(e: DocumentExport): DownloadRow {
  return {
    key: `doc-${e.id}`,
    source: "document",
    id: e.id,
    title: KIND_TITLE[e.kind] ?? human(e.kind),
    detail: [e.params?.run_id ? `Run #${e.params.run_id}` : null, e.item_count !== null && e.item_count !== undefined ? `${e.item_count} item${e.item_count === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ") || null,
    status: e.status,
    createdAt: e.created_at,
    expiresAt: e.expires_at,
    fileName: e.file_name,
    bytes: e.bytes,
    error: e.error,
    note: e.watermark,
  };
}

export function reportRow(e: ReportExport): DownloadRow {
  const filters = Object.entries(e.filters ?? {})
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${String(v)}`)
    .join(", ");
  return {
    key: `rep-${e.id}`,
    source: "report",
    id: e.id,
    title: `${e.report_code ? human(e.report_code) : "Report"}${e.format ? ` (${e.format})` : ""}`,
    detail: [e.rows !== null && e.rows !== undefined ? `${e.rows} row${e.rows === 1 ? "" : "s"}` : null, filters || null].filter(Boolean).join(" · ") || null,
    status: e.status,
    createdAt: e.created_at,
    expiresAt: e.expires_at,
    fileName: e.file_name,
    bytes: e.bytes,
    error: e.error,
    note: e.masked ? "Sensitive columns masked" : null,
  };
}

function Icon({ row }: { row: DownloadRow }) {
  const C = row.title.includes("ZIP") ? FileArchive : /CSV|XLSX/.test(row.title) ? FileSpreadsheet : FileText;
  return <C className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />;
}

/** The download center (3.8 §5.14): the person's own export jobs with status and signed links. */
export function DownloadCenter() {
  const { me } = useCan();
  const reportsAllowed = can(me, P.PAYROLL_REPORTS_READ);
  const canDownloadReports = can(me, P.PAYROLL_REPORTS_EXPORT);
  const docs = useApi(() => exportsApi.list(0, 50), []);
  const reports = useApi(() => exportsApi.reportList(50), [], { enabled: reportsAllowed });
  const [busy, setBusy] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");

  const rows = useMemo(() => {
    const list: DownloadRow[] = [...(docs.data?.items ?? []).map(documentRow), ...(reportsAllowed ? (reports.data?.items ?? []).map(reportRow) : [])];
    return list.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  }, [docs.data, reports.data, reportsAllowed]);

  // Poll while anything is queued or generating; announce what became ready (EC-UX-05).
  const active = rows.some((r) => ACTIVE.has(r.status));
  const previous = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const ready: string[] = [];
    rows.forEach((r) => {
      const before = previous.current.get(r.key);
      if (before && ACTIVE.has(before) && r.status === "READY") ready.push(r.title);
      if (before && ACTIVE.has(before) && r.status === "FAILED") ready.push(`${r.title} failed`);
    });
    previous.current = new Map(rows.map((r) => [r.key, r.status]));
    if (ready.length) setAnnounce(ready.map((t) => (t.endsWith("failed") ? t : `${t} is ready to download`)).join(". "));
  }, [rows]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      void docs.reload();
      if (reportsAllowed) void reports.reload();
    }, POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reportsAllowed]);

  const reloadAll = () => {
    void docs.reload();
    if (reportsAllowed) void reports.reload();
  };

  const download = async (row: DownloadRow) => {
    setBusy(row.key);
    try {
      if (row.source === "document") {
        openSignedLink(await exportsApi.link(row.id));
      } else {
        const blob = await fetchBlob(exportsApi.reportFileUrl(row.id));
        saveBlob(blob, row.fileName ?? `report-${row.id}`);
      }
    } catch (e) {
      toast.error(errorText(e));
      if (e instanceof ApiError && e.status === 409) reloadAll();
    } finally {
      setBusy(null);
    }
  };

  const columns: Column<DownloadRow>[] = [
    {
      key: "file",
      header: "Export",
      primary: true,
      cell: (r) => (
        <span className="flex items-start gap-2">
          <Icon row={r} />
          <span className="min-w-0">
            <span className="block font-medium">{r.title}</span>
            {r.detail && <span className="block text-xs text-muted-foreground">{r.detail}</span>}
            {r.note && <span className="block text-xs text-muted-foreground">{r.note}</span>}
          </span>
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => (
        <span className="flex flex-col items-start gap-1">
          <LocalStatusChip vocabulary="export" code={r.status} />
          {r.status === "READY" && r.expiresAt && <span className="text-xs text-muted-foreground">Expires {formatDateTime(r.expiresAt)}</span>}
          {r.status === "FAILED" && r.error && <span className="text-xs text-danger">{r.error}</span>}
        </span>
      ),
    },
    { key: "created", header: "Requested", hideOnMobile: true, cell: (r) => <span className="text-muted-foreground">{formatDateTime(r.createdAt)}</span> },
    { key: "size", header: "Size", hideOnMobile: true, className: "text-end", cell: (r) => <span className="tabular-nums text-muted-foreground">{formatBytes(r.bytes)}</span> },
    {
      key: "action",
      header: <span className="sr-only">Download</span>,
      className: "text-end",
      cell: (r) =>
        r.status === "READY" && (r.source === "document" || canDownloadReports) ? (
          <Button variant="secondary" size="sm" className="min-h-[44px]" loading={busy === r.key} aria-label={`Download ${r.title}`} onClick={(e) => { e.stopPropagation(); void download(r); }}>
            <Download className="h-4 w-4" aria-hidden /> Download
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">{r.status === "EXPIRED" ? "Export again" : ACTIVE.has(r.status) ? "Preparing…" : ""}</span>
        ),
    },
  ];

  const loading = (docs.loading && !docs.data) || (reportsAllowed && reports.loading && !reports.data);
  const bothFailed = docs.error && (!reportsAllowed || reports.error) && !rows.length;

  return (
    <div className="space-y-5">
      <WorkspaceHeader
        eyebrow="Downloads"
        title="Download center"
        description="Files you exported. Only you can download them, for 24 hours. Every file is watermarked with your name and the time."
        showHideAmounts={false}
        actions={
          <Button variant="secondary" className="min-h-[44px]" onClick={reloadAll}>
            <RefreshCw className="h-4 w-4" aria-hidden /> Refresh
          </Button>
        }
      />
      <div className="sr-only" role="status" aria-live="polite">
        {announce}
      </div>
      {docs.error && rows.length > 0 && <Notice tone="warning" title="Payslip and register exports could not be loaded">{errorText(docs.error)}</Notice>}
      {reportsAllowed && reports.error && rows.length > 0 && <Notice tone="warning" title="Report exports could not be loaded">{errorText(reports.error)}</Notice>}
      <Card className="p-0">
        {bothFailed ? (
          <ErrorState message={errorText(docs.error)} onRetry={reloadAll} />
        ) : (
          <DataTable
            caption="Your exports"
            columns={columns}
            rows={loading ? undefined : rows}
            loading={!!loading}
            rowKey={(r) => r.key}
            cardBelowMd
            empty={
              <EmptyState
                icon={<Download />}
                title="No downloads yet"
                description="Exports you start from Reports or Payslips appear here while they are prepared."
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    {reportsAllowed && (
                      <Link href="/payroll/reports" className="inline-flex min-h-[44px] items-center rounded-xl border border-border px-4 text-sm font-medium hover:bg-surface-muted">
                        Open reports
                      </Link>
                    )}
                    {canBeyondSelf(me, P.PAYROLL_PAYSLIP_READ) && (
                      <Link href="/payroll/payslips" className="inline-flex min-h-[44px] items-center rounded-xl border border-border px-4 text-sm font-medium hover:bg-surface-muted">
                        Open payslips
                      </Link>
                    )}
                  </div>
                }
              />
            }
          />
        )}
      </Card>
    </div>
  );
}
