"use client";

import { Download, FileArchive, FileSpreadsheet, FileText, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { Column, DataTable, EmptyState, ErrorState, Pagination } from "@/components/ui/layout";
import { Card } from "@/components/ui/primitives";
import { can, canBeyondSelf } from "@/lib/access";
import { ApiError } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";

import { exportsApi, openSignedLink } from "./api";
import { LocalStatusChip, WorkspaceHeader, errorText, formatBytes, formatDateTime } from "./shared";
import type { DownloadItem, SignedLink } from "./types";

const POLL_MS = 4000;
const LIMIT = 50;
const ACTIVE = new Set(["QUEUED", "GENERATING"]);
/** A signed link this close to expiry is replaced by a fresh one before it is followed. */
const LINK_MARGIN_MS = 15000;

type Source = "" | "EXPORT" | "REPORT_EXPORT";

export const itemKey = (item: Pick<DownloadItem, "source" | "id">) => `${item.source}-${item.id}`;

/** One line under the title: the run, how many payslips / rows, the format. */
export function itemDetail(item: DownloadItem): string | null {
  const parts: string[] = [];
  if (item.run_id) parts.push(`Run #${item.run_id}`);
  if (item.items !== null && item.items !== undefined) {
    const noun = item.kind === "PAYSLIPS_ZIP" ? "payslip" : item.source === "REPORT_EXPORT" ? "row" : "item";
    parts.push(`${item.items} ${noun}${item.items === 1 ? "" : "s"}`);
  }
  return parts.join(" · ") || null;
}

/** The embedded signed link while it is still comfortably valid, else null (ask for a fresh one). */
export function usableLink(item: Pick<DownloadItem, "download">, now: number = Date.now()): SignedLink | null {
  const link = item.download;
  if (!link) return null;
  const expires = Date.parse(link.expires_at);
  return Number.isFinite(expires) && expires - now > LINK_MARGIN_MS ? link : null;
}

function Icon({ item }: { item: DownloadItem }) {
  const C = item.format === "ZIP" ? FileArchive : item.format === "CSV" || item.format === "XLSX" ? FileSpreadsheet : FileText;
  return <C className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />;
}

/**
 * The download center (3.8 §5.14): the person's own payslip ZIPs, registers and report exports in one
 * list (GET /payroll/downloads/mine, newest first), each ready file behind a signed five-minute link
 * bound to this user. Nobody else's exports are ever listed.
 */
export function DownloadCenter() {
  const { me } = useCan();
  const reportsAllowed = can(me, P.PAYROLL_REPORTS_READ);
  const [source, setSource] = useState<Source>("");
  const [skip, setSkip] = useState(0);
  const { data, error, loading, reload } = useApi(() => exportsApi.mine({ source: source || null, skip, limit: LIMIT }), [source, skip]);
  const [busy, setBusy] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const items = data?.items;

  // Poll while anything is queued or generating; announce what became ready (EC-UX-05).
  const active = (items ?? []).some((i) => ACTIVE.has(i.status));
  const previous = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    if (!items) return;
    const changed: string[] = [];
    items.forEach((i) => {
      const before = previous.current.get(itemKey(i));
      if (before && ACTIVE.has(before) && i.status === "READY") changed.push(`${i.title} is ready to download`);
      if (before && ACTIVE.has(before) && i.status === "FAILED") changed.push(`${i.title} failed`);
    });
    previous.current = new Map(items.map((i) => [itemKey(i), i.status]));
    if (changed.length) setAnnounce(changed.join(". "));
  }, [items]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(timer);
  }, [active, reload]);

  const download = async (item: DownloadItem) => {
    const key = itemKey(item);
    setBusy(key);
    try {
      const link = usableLink(item) ?? (item.source === "EXPORT" ? await exportsApi.link(item.id) : await exportsApi.reportLink(item.id));
      openSignedLink(link);
    } catch (e) {
      toast.error(errorText(e));
      if (e instanceof ApiError && e.status === 409) void reload();
    } finally {
      setBusy(null);
    }
  };

  const columns: Column<DownloadItem>[] = [
    {
      key: "file",
      header: "Export",
      primary: true,
      cell: (i) => {
        const detail = itemDetail(i);
        return (
          <span className="flex items-start gap-2">
            <Icon item={i} />
            <span className="min-w-0">
              <span className="block font-medium">{i.title}</span>
              {detail && <span className="block text-xs text-muted-foreground">{detail}</span>}
              {i.file_name && i.status === "READY" && (
                <span className="block text-xs text-muted-foreground">
                  <bdi dir="ltr">{i.file_name}</bdi>
                </span>
              )}
            </span>
          </span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      cell: (i) => (
        <span className="flex flex-col items-start gap-1">
          <LocalStatusChip vocabulary="export" code={i.status} />
          {i.status === "READY" && i.expires_at && <span className="text-xs text-muted-foreground">Expires {formatDateTime(i.expires_at)}</span>}
          {i.status === "FAILED" && i.error && <span className="text-xs text-danger">{i.error}</span>}
        </span>
      ),
    },
    { key: "created", header: "Requested", hideOnMobile: true, cell: (i) => <span className="text-muted-foreground">{formatDateTime(i.created_at)}</span> },
    { key: "size", header: "Size", hideOnMobile: true, className: "text-end", cell: (i) => <span className="tabular-nums text-muted-foreground">{formatBytes(i.bytes)}</span> },
    {
      key: "action",
      header: <span className="sr-only">Download</span>,
      className: "text-end",
      cell: (i) =>
        // The server sends a link only for files the caller may still download (payroll:reports:export,
        // the report's own permissions and the scope the file was built from; for payslip ZIPs and
        // registers, the run still in scope); a READY file without one says why instead of offering a
        // button the server would refuse.
        i.status === "READY" && i.download ? (
          <Button
            variant="secondary"
            size="sm"
            className="min-h-[44px]"
            loading={busy === itemKey(i)}
            aria-label={`Download ${i.title}`}
            onClick={(e) => {
              e.stopPropagation();
              void download(i);
            }}
          >
            <Download className="h-4 w-4" aria-hidden /> Download
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">
            {i.status === "READY"
              ? i.source === "REPORT_EXPORT"
                ? "Your report access no longer covers this file"
                : "Needs export access to this run"
              : i.status === "EXPIRED"
                ? "Export again"
                : ACTIVE.has(i.status)
                  ? "Preparing…"
                  : ""}
          </span>
        ),
    },
  ];

  return (
    <div className="space-y-5">
      <WorkspaceHeader
        eyebrow="Downloads"
        title="Download center"
        description="Files you exported. Only you can download them, for 24 hours, through links that expire after five minutes."
        showHideAmounts={false}
        actions={
          <Button variant="secondary" className="min-h-[44px]" onClick={() => void reload()}>
            <RefreshCw className="h-4 w-4" aria-hidden /> Refresh
          </Button>
        }
      />
      <div className="sr-only" role="status" aria-live="polite">
        {announce}
      </div>
      <Card className="p-0">
        <div className="flex flex-wrap items-end gap-3 border-b border-border p-4">
          <Field label="Show" className="w-64">
            <Select
              className="min-h-[44px]"
              value={source}
              onChange={(e) => {
                setSource(e.target.value as Source);
                setSkip(0);
              }}
            >
              <option value="">All downloads</option>
              <option value="EXPORT">Payslip ZIPs and registers</option>
              <option value="REPORT_EXPORT">Report exports</option>
            </Select>
          </Field>
        </div>
        {error && !items ? (
          <ErrorState message={errorText(error)} onRetry={() => void reload()} />
        ) : (
          <DataTable
            caption="Your exports"
            columns={columns}
            rows={items}
            loading={loading && !items}
            rowKey={itemKey}
            cardBelowMd
            empty={
              <EmptyState
                icon={<Download />}
                title={source ? "No downloads of this kind" : "No downloads yet"}
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
        {data && <Pagination total={data.total} skip={skip} limit={LIMIT} onChange={setSkip} />}
      </Card>
    </div>
  );
}
