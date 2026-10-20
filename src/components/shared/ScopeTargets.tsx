"use client";

import { MapPin } from "lucide-react";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Badge, Skeleton } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";

interface TargetRow {
  role_id: number;
  role_name: string | null;
  scopes: ("LEGAL_ENTITY" | "BRANCH")[];
  legal_entity_ids: number[];
  branch_ids: number[];
}
interface Option {
  id: number;
  label: string;
}

/**
 * Which legal entities / branches a user's entity- or branch-scoped roles cover. A role at
 * such a scope with nothing selected grants nothing (deny by default).
 */
export function ScopeTargets({ userId, editable }: { userId: number; editable: boolean }) {
  const [rows, setRows] = useState<TargetRow[] | null>(null);
  const [entities, setEntities] = useState<Option[]>([]);
  const [branches, setBranches] = useState<Option[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<TargetRow[]>(`/users/${userId}/scope-targets`).then(setRows).catch(() => setRows([]));
    api.get<{ id: number; legal_name: string; code: string }[]>("/legal-entities")
      .then((r) => setEntities(r.map((e) => ({ id: e.id, label: `${e.legal_name} (${e.code})` })))).catch(() => undefined);
    api.get<{ id: number; name: string; legal_entity_code: string }[]>("/branches")
      .then((r) => setBranches(r.map((b) => ({ id: b.id, label: `${b.name} · ${b.legal_entity_code}` })))).catch(() => undefined);
  }, [userId]);

  if (!rows) return <Skeleton className="h-16" />;
  if (rows.length === 0) return null;

  const toggle = (index: number, key: "legal_entity_ids" | "branch_ids", id: number) => {
    setRows(rows.map((r, i) => (i !== index ? r : {
      ...r, [key]: r[key].includes(id) ? r[key].filter((x) => x !== id) : [...r[key], id],
    })));
  };
  const save = async () => {
    setBusy(true);
    try {
      setRows(await api.put<TargetRow[]>(`/users/${userId}/scope-targets`, {
        assignments: rows.map((r) => ({ role_id: r.role_id, legal_entity_ids: r.legal_entity_ids, branch_ids: r.branch_ids })),
      }));
      toast.success("Locations saved — effective on their next request");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section data-testid="scope-targets">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Locations covered</p>
        {editable && <Button size="sm" loading={busy} onClick={save} data-testid="save-scope-targets">Save locations</Button>}
      </div>
      <div className="space-y-3">
        {rows.map((row, index) => (
          <div key={row.role_id} className="rounded-2xl border border-border p-4">
            <p className="flex items-center gap-2 text-sm font-semibold"><MapPin className="h-4 w-4" /> {row.role_name}</p>
            {row.legal_entity_ids.length + row.branch_ids.length === 0 && (
              <p className="mt-1 text-xs text-warning">Nothing selected: this role currently grants no access to anyone&apos;s records.</p>
            )}
            {(
              [
                ["LEGAL_ENTITY", "legal_entity_ids", "Legal entities", entities],
                ["BRANCH", "branch_ids", "Branches", branches],
              ] as const
            ).filter(([scope]) => row.scopes.includes(scope)).map(([scope, key, label, options]) => (
              <div key={scope} className="mt-3">
                <p className="mb-1.5 text-xs text-muted-foreground">{label}</p>
                <div className="flex flex-wrap gap-1.5">
                  {options.map((o) => {
                    const on = row[key].includes(o.id);
                    return (
                      <button key={o.id} type="button" disabled={!editable} aria-pressed={on}
                        onClick={() => toggle(index, key, o.id)} data-target={o.label}
                        className={cn("rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                          on ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground hover:text-foreground")}>
                        {o.label}
                      </button>
                    );
                  })}
                  {options.length === 0 && <Badge>None defined</Badge>}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
