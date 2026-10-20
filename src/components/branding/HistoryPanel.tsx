"use client";

import { History, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/layout";
import { useConfirm } from "@/components/ui/overlay";
import { Badge, Card, CardHeader } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";

import type { Source, VersionRow } from "./types";

interface Explain {
  version: string;
  plan: string;
  partner: { name: string } | null;
  fields: {
    field: string;
    label: string;
    effective: unknown;
    source: Source;
    levels: Record<"PLATFORM" | "PARTNER" | "TENANT", unknown>;
    locked_by_partner: boolean;
  }[];
}

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

export function HistoryPanel({ onRestore }: { onRestore: (id: number) => Promise<unknown> }) {
  const confirm = useConfirm();
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [explain, setExplain] = useState<Explain | null>(null);

  const load = useCallback(async () => {
    try {
      const [v, e] = await Promise.all([api.get<VersionRow[]>("/branding/versions"), api.get<Explain>("/branding/resolve")]);
      setVersions(v);
      setExplain(e);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><History className="h-4 w-4" /> Published versions</span>}
          description="Restoring publishes a copy of an earlier version as a new version. History is never rewritten." />
        <DataTable
          rows={versions ?? undefined}
          loading={!versions}
          rowKey={(v) => v.id}
          columns={[
            { key: "v", header: "Version", cell: (v) => (
              <span className="flex items-center gap-2 font-medium">
                v{v.version}
                {v.status === "PUBLISHED" ? <Badge tone="success">Live</Badge> : <Badge>Archived</Badge>}
                {v.restored_from_version && <Badge tone="info">Restored from v{v.restored_from_version}</Badge>}
              </span>
            ) },
            { key: "c", header: "Changes", cell: (v) => (
              <span className="text-xs text-muted-foreground">
                {v.changes.length ? v.changes.map((c) => c.label).join(", ") : "Initial version"}
              </span>
            ) },
            { key: "w", header: "Published", hideOnMobile: true, cell: (v) => (
              <span className="text-xs">{fmtDateTime(v.published_at)}<br /><span className="text-muted-foreground">{v.published_by}</span></span>
            ) },
            { key: "a", header: "", cell: (v) => v.status === "ARCHIVED" && (
              <Button size="sm" variant="secondary" data-testid={`restore-v${v.version}`} onClick={async () => {
                const ok = await confirm({
                  title: `Restore version ${v.version}?`,
                  message: "Its branding becomes live as a new version. Documents already issued are not changed.",
                  confirmLabel: "Restore",
                });
                if (!ok) return;
                try {
                  await onRestore(v.id);
                  toast.success(`Version ${v.version} restored`);
                  await load();
                } catch (e) {
                  toast.error(errorMessage(e));
                }
              }}>
                <RotateCcw className="h-4 w-4" /> Restore
              </Button>
            ) },
          ]}
        />
      </Card>
      {explain && (
        <Card>
          <CardHeader title="Why is this value used?" description={`Each field comes from the most specific level that sets it (plan: ${explain.plan}${explain.partner ? `, partner: ${explain.partner.name}` : ""}).`} />
          <div className="scrollbar-thin overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Field</th>
                  <th className="px-4 py-2 font-medium">In use</th>
                  <th className="px-4 py-2 font-medium">From</th>
                  <th className="px-4 py-2 font-medium">Company</th>
                  <th className="px-4 py-2 font-medium">Partner</th>
                  <th className="px-4 py-2 font-medium">Platform</th>
                </tr>
              </thead>
              <tbody>
                {explain.fields.map((f) => (
                  <tr key={f.field} className="border-b border-border/60 last:border-0" data-explain={f.field}>
                    <td className="px-4 py-2 font-medium">{f.label}</td>
                    <td className="max-w-[220px] truncate px-4 py-2">{show(f.effective && typeof f.effective === "object" ? "image" : f.effective)}</td>
                    <td className="px-4 py-2">
                      <Badge tone={f.source.level === "TENANT" ? "primary" : f.source.reason === "LOCKED" ? "warning" : "neutral"}>
                        {f.source.level.toLowerCase()} · {f.source.reason.toLowerCase().replace("_", " ")}
                      </Badge>
                    </td>
                    <td className="max-w-[160px] truncate px-4 py-2 text-muted-foreground">{show(f.levels.TENANT)}</td>
                    <td className="max-w-[160px] truncate px-4 py-2 text-muted-foreground">{show(f.levels.PARTNER)}</td>
                    <td className="max-w-[160px] truncate px-4 py-2 text-muted-foreground">{show(f.levels.PLATFORM)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
