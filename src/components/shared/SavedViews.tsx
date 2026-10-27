"use client";

import { useState, type FormEvent } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { savedViewsApi, type SavedViewList, type SavedViewRow } from "@/lib/savedViews";

/**
 * Saved-view tabs of a list (X 04 §2.8): All · system views of the viewer's personas · own views · views shared by
 * others ("Shared"). Selecting writes `view` (the parent applies the stored query); a modified view shows "•" and the
 * parent renders Reset / Save / Save as new view… from `ViewActions`. Six tabs visible, the rest in "More views".
 */
export function SavedViews({ data, active, onSelect, modified }: {
  data: SavedViewList | undefined;
  active: string | undefined;
  onSelect: (viewId: string | null, query?: Record<string, unknown>) => void;
  modified?: boolean;
}) {
  if (!data) return null;
  const tabs: { id: string | null; name: string; query?: Record<string, unknown>; shared?: string | null }[] = [
    { id: null, name: "All" },
    ...data.system_views.filter((v) => !v.is_hidden).sort((a, b) => a.position - b.position)
      .map((v) => ({ id: v.id, name: v.name, query: v.query })),
    ...data.views.filter((v) => v.own).sort((a, b) => a.position - b.position)
      .map((v) => ({ id: String(v.id), name: v.name, query: v.query })),
    ...data.views.filter((v) => !v.own).map((v) => ({ id: String(v.id), name: v.name, query: v.query, shared: v.owner_name })),
  ];
  const visible = tabs.slice(0, 6);
  const more = tabs.slice(6);
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Views">
      {visible.map((t) => {
        const selected = (active ?? null) === t.id;
        return (
          <button key={t.id ?? "all"} type="button" role="tab" aria-selected={selected}
            onClick={() => onSelect(t.id, t.query)}
            title={t.shared ? `Shared by ${t.shared}` : undefined}
            className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
              selected ? "border-primary bg-primary-soft text-primary" : "border-border hover:bg-surface-muted")}>
            {t.name}
            {t.shared !== undefined && <span className="rounded bg-muted px-1 text-[10px] uppercase">Shared</span>}
            {selected && modified && <span aria-label="modified">•</span>}
          </button>
        );
      })}
      {more.length > 0 && (
        <select aria-label="More views" className="h-8 rounded-full border border-border bg-surface px-3 text-sm"
          value={more.some((t) => t.id === active) ? active : ""}
          onChange={(e) => {
            const t = more.find((x) => x.id === e.target.value);
            if (t) onSelect(t.id, t.query);
          }}>
          <option value="">More views…</option>
          {more.map((t) => <option key={t.id ?? ""} value={t.id ?? ""}>{t.name}</option>)}
        </select>
      )}
    </div>
  );
}

/** Reset · Save · Save as new view… for the selected view (own views can be saved; others only copied). */
export function ViewActions({ listKey, data, active, query, onReset, onSaved }: {
  listKey: string;
  data: SavedViewList | undefined;
  active: string | undefined;
  query: Record<string, unknown>;
  onReset: () => void;
  onSaved: (view: SavedViewRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const own = data?.views.find((v) => String(v.id) === active && v.own);
  const save = async () => {
    if (!own) return;
    try {
      const saved = await savedViewsApi.update(own, { query });
      toast.success("View saved.");
      onSaved(saved);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <span className="inline-flex items-center gap-2 text-xs">
      {active && <button type="button" className="font-medium text-primary hover:underline" onClick={onReset}>Reset</button>}
      {own && <button type="button" className="font-medium text-primary hover:underline" onClick={save}>Save</button>}
      <button type="button" className="font-medium text-primary hover:underline" onClick={() => setOpen(true)}>Save as new view…</button>
      <SavedViewModal listKey={listKey} open={open} onOpenChange={setOpen} data={data} query={query} onSaved={onSaved} />
    </span>
  );
}

/** The `saved-view` modal (X 04 §2.8): name, share, default; refuses at the 20-view limit. */
export function SavedViewModal({ listKey, open, onOpenChange, data, query, onSaved }: {
  listKey: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: SavedViewList | undefined;
  query: Record<string, unknown>;
  onSaved: (view: SavedViewRow) => void;
}) {
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [isDefault, setDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const own = data?.views.filter((v) => v.own) ?? [];
  const atLimit = own.length >= (data?.limit ?? 20);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError("Give the view a name.");
    if (own.some((v) => v.name.toLowerCase() === trimmed.toLowerCase())) return setError("You already have a view with this name.");
    setBusy(true);
    setError(null);
    try {
      const view = await savedViewsApi.create(listKey, { name: trimmed, query, is_shared: shared, is_default: isDefault });
      toast.success("View saved.");
      onOpenChange(false);
      setName("");
      onSaved(view);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onOpenChange={onOpenChange} size="sm" title="Save view"
      footer={<>
        <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button type="submit" form="saved-view-form" loading={busy} disabled={atLimit}>Save view</Button>
      </>}>
      <form id="saved-view-form" onSubmit={submit} className="space-y-4" noValidate>
        {atLimit && <p role="status" className="rounded-xl bg-warning/10 p-3 text-sm">You have {data?.limit ?? 20} views for this list. Delete one to save another.</p>}
        <Field label="Name" required error={error ?? undefined} hint="Only you see this name unless you share the view.">
          <Input value={name} maxLength={80} autoComplete="off" onChange={(e) => setName(e.target.value)} />
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
          <span>Share with everyone who can open this list
            <span className="block text-xs text-muted-foreground">They see the same filters. Each person still sees only the people they have access to.</span></span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={isDefault} onChange={(e) => setDefault(e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
          <span>Make this my default view<span className="block text-xs text-muted-foreground">Opens when you come to this list.</span></span>
        </label>
      </form>
    </Modal>
  );
}
