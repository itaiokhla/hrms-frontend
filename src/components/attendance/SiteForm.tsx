"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Circle, Hexagon, MapPinOff } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import toast from "react-hot-toast";

import { useBranches } from "@/components/rosters/RosterPeriods";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { todayISO } from "@/lib/format";
import { newIdempotencyKey } from "@/lib/payroll/api";

import { CaptureApiError, captureApi, type Site, type SiteBody } from "./captureApi";
import { MIN_RADIUS_M, SITE_KINDS, SITE_KIND_LABEL, parsePolygon, parseRanges, polygonText, type Geometry } from "./captureModel";
import { SiteMap } from "./SiteMap";

export interface Draft {
  code: string;
  name: string;
  kind: string;
  branch_id: string;
  geometry_type: Geometry;
  center_lat: string;
  center_lng: string;
  radius_m: string;
  polygon: string;
  ip_ranges: string;
  outdoor: boolean;
  effective_from: string;
  effective_to: string;
}

export function draftOf(site: Site | null): Draft {
  return {
    code: site?.code ?? "", name: site?.name ?? "", kind: site?.kind ?? "OFFICE",
    branch_id: site?.branch_id ? String(site.branch_id) : "", geometry_type: site?.geometry_type ?? "CIRCLE",
    center_lat: site?.center_lat != null ? String(site.center_lat) : "",
    center_lng: site?.center_lng != null ? String(site.center_lng) : "",
    radius_m: site?.radius_m != null ? String(site.radius_m) : "120", polygon: polygonText(site?.polygon),
    ip_ranges: (site?.ip_ranges ?? []).join("\n"), outdoor: site?.outdoor ?? false,
    effective_from: site?.effective_from ?? todayISO(), effective_to: site?.effective_to ?? "",
  };
}

const num = (v: string) => (v.trim() === "" ? null : Number(v));

/** Errors keyed by field (client checks + the server's codes). */
type Errors = Partial<Record<keyof Draft | "form", string>>;

export function validateDraft(d: Draft, creating: boolean): { body: SiteBody | null; errors: Errors } {
  const errors: Errors = {};
  if (creating && !/^[A-Za-z0-9._-]{1,30}$/.test(d.code.trim())) errors.code = "Use letters, digits, dot, dash or underscore (max 30).";
  if (!d.name.trim()) errors.name = "Name the site.";
  let polygon: number[][] | null = null;
  if (d.geometry_type === "CIRCLE") {
    const lat = num(d.center_lat);
    const lng = num(d.center_lng);
    const radius = num(d.radius_m);
    if (lat === null || !Number.isFinite(lat) || Math.abs(lat) > 90) errors.center_lat = "Latitude between -90 and 90.";
    if (lng === null || !Number.isFinite(lng) || Math.abs(lng) > 180) errors.center_lng = "Longitude between -180 and 180.";
    if (radius === null || !Number.isFinite(radius)) errors.radius_m = "Enter a radius in metres.";
    else if (radius < MIN_RADIUS_M) errors.radius_m = `Use at least ${MIN_RADIUS_M} m: phones place people only to about ${MIN_RADIUS_M} m.`;
  }
  if (d.geometry_type === "POLYGON") {
    try {
      polygon = parsePolygon(d.polygon);
      if (polygon.length < 3) errors.polygon = "A polygon needs at least 3 points.";
    } catch (e) {
      errors.polygon = (e as Error).message;
    }
  }
  if (d.effective_to && d.effective_to < d.effective_from) errors.effective_to = "The end date is before the start date.";
  if (Object.keys(errors).length) return { body: null, errors };
  const body: SiteBody = {
    name: d.name.trim(), kind: d.kind, branch_id: d.branch_id ? Number(d.branch_id) : null,
    geometry_type: d.geometry_type, ip_ranges: parseRanges(d.ip_ranges), outdoor: d.outdoor,
    effective_from: d.effective_from || null, effective_to: d.effective_to || null,
  };
  if (d.geometry_type === "CIRCLE") {
    body.center_lat = num(d.center_lat);
    body.center_lng = num(d.center_lng);
    body.radius_m = num(d.radius_m);
  } else if (d.geometry_type === "POLYGON") {
    body.polygon = polygon;
  }
  if (creating) body.code = d.code.trim();
  return { body, errors };
}

const GEOMETRIES: { value: Geometry; label: string; icon: typeof Circle }[] = [
  { value: "CIRCLE", label: "Circle", icon: Circle },
  { value: "POLYGON", label: "Polygon", icon: Hexagon },
  { value: "NONE", label: "No area", icon: MapPinOff },
];

/**
 * `SiteForm` (09-ui-ux/02 §9.2, 03 `site`): code, name, kind, branch, a circle (centre + radius ≥ the minimum) or a
 * polygon, office IP ranges, outdoor and the effective dates, with a live drawing. Create posts; edit PATCHes with
 * `If-Match`. Server codes land on their field (`SITE_RADIUS_TOO_SMALL`, `IP_RANGE_INVALID`, `SITE_POLYGON_INVALID`).
 */
export function SiteForm({ site, onSaved, onCancel }: {
  site: Site | null;
  onSaved: (site: Site) => void;
  onCancel?: () => void;
}) {
  const creating = site === null;
  const branches = useBranches();
  const [draft, setDraft] = useState<Draft>(() => draftOf(site));
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const key = useMemo(() => newIdempotencyKey(), []);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const preview = useMemo(() => {
    let polygon: number[][] | null = null;
    try {
      polygon = draft.geometry_type === "POLYGON" ? parsePolygon(draft.polygon) : null;
    } catch {
      polygon = null;
    }
    return { geometry_type: draft.geometry_type, radius_m: num(draft.radius_m), polygon, name: draft.name };
  }, [draft]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const { body, errors: found } = validateDraft(draft, creating);
    setErrors(found);
    if (!body) return;
    setBusy(true);
    setConflict(false);
    try {
      const saved = site ? await captureApi.updateSite(site.id, body, site.row_version) : await captureApi.createSite(body, key);
      for (const warning of saved.warnings ?? []) toast(warning, { icon: "⚠️" });
      toast.success(creating ? `Site ${saved.code} created` : `Site ${saved.code} saved`);
      onSaved(saved);
    } catch (e) {
      const err = e as CaptureApiError;
      if (err.code === "SITE_RADIUS_TOO_SMALL") setErrors({ radius_m: err.message });
      else if (err.code === "IP_RANGE_INVALID") setErrors({ ip_ranges: err.message });
      else if (err.code === "SITE_POLYGON_INVALID") setErrors({ polygon: err.message });
      else if (err.code === "ROW_VERSION_CONFLICT") setConflict(true);
      else if (err.status === 409) setErrors({ code: err.message });
      else setErrors({ form: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]" data-testid="site-form" noValidate>
      <div className="space-y-4">
        {conflict && (
          <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning-soft p-3 text-sm text-warning" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> This site changed since you opened it. Reload the page; your typed values are kept here until then.
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {creating && (
            <Field label="Code" required error={errors.code} hint="e.g. 2101 — cannot change later.">
              <Input value={draft.code} onChange={(e) => set("code", e.target.value)} className="font-mono" data-testid="site-code" maxLength={30} />
            </Field>
          )}
          <Field label="Name" required error={errors.name}>
            <Input value={draft.name} onChange={(e) => set("name", e.target.value)} data-testid="site-name" maxLength={100} />
          </Field>
          <Field label="Kind">
            <Select value={draft.kind} onChange={(e) => set("kind", e.target.value)} data-testid="site-kind">
              {SITE_KINDS.map((k) => <option key={k} value={k}>{SITE_KIND_LABEL[k]}</option>)}
            </Select>
          </Field>
          <Field label="Branch" hint="Employees of this branch punch here unless their policy names sites.">
            <Select value={draft.branch_id} onChange={(e) => set("branch_id", e.target.value)} data-testid="site-branch">
              <option value="">No branch</option>
              {branches.items.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </Select>
          </Field>
        </div>

        <div className="space-y-1.5">
          <p className="text-[13px] font-medium text-foreground/90">Area</p>
          <div role="radiogroup" aria-label="Area" className="inline-flex gap-1 rounded-2xl border border-border bg-surface-muted p-1">
            {GEOMETRIES.map((g) => (
              <button key={g.value} type="button" role="radio" aria-checked={draft.geometry_type === g.value}
                data-testid={`site-geometry-${g.value}`} onClick={() => set("geometry_type", g.value)}
                className={cn("flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-sm font-medium transition-colors",
                  draft.geometry_type === g.value ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                <g.icon className="h-3.5 w-3.5" aria-hidden /> {g.label}
              </button>
            ))}
          </div>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          {draft.geometry_type === "CIRCLE" && (
            <motion.div key="circle" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }} className="grid gap-4 sm:grid-cols-3">
              <Field label="Centre latitude" required error={errors.center_lat}>
                <Input inputMode="decimal" value={draft.center_lat} onChange={(e) => set("center_lat", e.target.value)} data-testid="site-lat" />
              </Field>
              <Field label="Centre longitude" required error={errors.center_lng}>
                <Input inputMode="decimal" value={draft.center_lng} onChange={(e) => set("center_lng", e.target.value)} data-testid="site-lng" />
              </Field>
              <Field label="Radius (m)" required error={errors.radius_m} hint={`At least ${MIN_RADIUS_M} m.`}>
                <Input inputMode="numeric" value={draft.radius_m} onChange={(e) => set("radius_m", e.target.value)} data-testid="site-radius" />
              </Field>
            </motion.div>
          )}
          {draft.geometry_type === "POLYGON" && (
            <motion.div key="polygon" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
              <Field label="Corner points" required error={errors.polygon} hint="One “latitude, longitude” per line, 3 to 64 points, edges under 5 km.">
                <Textarea value={draft.polygon} onChange={(e) => set("polygon", e.target.value)} className="min-h-[120px] font-mono text-xs" data-testid="site-polygon" />
              </Field>
            </motion.div>
          )}
        </AnimatePresence>

        <Field label="Office network (IP ranges)" error={errors.ip_ranges}
          hint="One range per line, e.g. 203.0.113.0/24. Private ranges (10.x, 192.168.x) match only through a VPN or proxy.">
          <Textarea value={draft.ip_ranges} onChange={(e) => set("ip_ranges", e.target.value)} className="min-h-[72px] font-mono text-xs" data-testid="site-ip-ranges" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Effective from" error={errors.effective_from}>
            <Input type="date" value={draft.effective_from} onChange={(e) => set("effective_from", e.target.value)} data-testid="site-from" />
          </Field>
          <Field label="Effective to" error={errors.effective_to}>
            <Input type="date" value={draft.effective_to} onChange={(e) => set("effective_to", e.target.value)} data-testid="site-to" />
          </Field>
          <div className="flex items-end gap-3 pb-2">
            <Switch checked={draft.outdoor} onChange={(v) => set("outdoor", v)} label="Outdoor site" id="site-outdoor" />
            <label htmlFor="site-outdoor" className="text-sm">Outdoor site</label>
          </div>
        </div>

        {errors.form && <p role="alert" className="text-sm font-medium text-danger" data-testid="site-form-error">{errors.form}</p>}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          {onCancel && <Button variant="secondary" onClick={onCancel}>Cancel</Button>}
          <Button type="submit" loading={busy} data-testid="site-save">{creating ? "Create site" : "Save changes"}</Button>
        </div>
      </div>
      <SiteMap site={preview} className="self-start" />
    </form>
  );
}
