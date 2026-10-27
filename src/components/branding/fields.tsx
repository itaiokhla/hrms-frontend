"use client";

import { Lock, Upload, X } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input, Switch } from "@/components/ui/field";
import { Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

import { FIELD_LABELS, PLAN_LABELS, type AssetKind, type BrandAsset, type BrandingAdmin, type FieldValue } from "./types";

export interface FieldControl {
  data: BrandingAdmin;
  valueOf: (field: string) => FieldValue;
  setField: (field: string, value: FieldValue) => void;
}

/** Why a field is (or is not) editable, and where its effective value comes from. */
export function fieldState(data: BrandingAdmin, field: string) {
  const locked = data.locked_fields.includes(field);
  const entitlement = data.field_entitlements[field];
  const ent = data.entitlements.find((e) => e.key === entitlement);
  const entitled = !ent || ent.enabled;
  const source = data.preview_sources[field] ?? data.sources[field];
  return { locked, entitled, entitlement: ent, source };
}

export function InheritanceBadge({ data, field }: { data: BrandingAdmin; field: string }) {
  const { locked, entitled, entitlement, source } = fieldState(data, field);
  if (locked) {
    return (
      <Badge tone="warning">
        <Lock className="mr-1 inline h-3 w-3" />
        Locked by {data.partner?.name}
      </Badge>
    );
  }
  if (!entitled && entitlement) {
    return (
      <Badge tone="neutral">
        <Lock className="mr-1 inline h-3 w-3" />
        {entitlement.decided_by_partner
          ? `Not enabled by ${data.partner?.name ?? "your partner"}`
          : `Available on ${PLAN_LABELS[entitlement.available_on ?? ""] ?? entitlement.available_on}`}
      </Badge>
    );
  }
  if (!source || source.level === "TENANT") return null;
  return <Badge tone="neutral">{source.level === "PARTNER" ? `From ${source.by ?? "partner"}` : "Platform default"}</Badge>;
}

export function BrandTextField({
  control,
  field,
  hint,
  type = "text",
  maxLength,
  placeholder,
  dir,
}: {
  control: FieldControl;
  field: string;
  hint?: ReactNode;
  type?: string;
  maxLength?: number;
  placeholder?: string;
  dir?: "ltr" | "rtl" | "auto";
}) {
  const { data, valueOf, setField } = control;
  const { locked, entitled } = fieldState(data, field);
  const value = valueOf(field);
  const inherited = data.inherited[field];
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <InheritanceBadge data={data} field={field} />
      </div>
      <Field label={FIELD_LABELS[field] ?? field} hint={hint}>
        <Input
          type={type}
          dir={dir}
          value={typeof value === "string" ? value : ""}
          maxLength={maxLength}
          disabled={locked || !entitled}
          placeholder={placeholder ?? (typeof inherited === "string" ? inherited : undefined)}
          onChange={(e) => setField(field, e.target.value)}
          data-field={field}
        />
      </Field>
    </div>
  );
}

// Promoted to src/components/ui/segmented (LH-M0 WI-0.7); re-exported for existing imports.
export { Segmented } from "@/components/ui/segmented";

export function ColorField({ control, field, hint }: { control: FieldControl; field: string; hint?: ReactNode }) {
  const { data, valueOf, setField } = control;
  const { locked, entitled } = fieldState(data, field);
  const raw = valueOf(field);
  const value = typeof raw === "string" ? raw : "";
  const fallback = typeof data.inherited[field] === "string" ? (data.inherited[field] as string) : "#4F46E5";
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? value;
  const disabled = locked || !entitled;
  return (
    <div className="space-y-1.5">
      <InheritanceBadge data={data} field={field} />
      <Field label={FIELD_LABELS[field]} hint={hint}>
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label={`${FIELD_LABELS[field]} picker`}
            value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback}
            disabled={disabled}
            onChange={(e) => {
              setText(null);
              setField(field, e.target.value.toUpperCase());
            }}
            className="h-10 w-14 cursor-pointer rounded-xl border border-input bg-surface p-1 disabled:cursor-not-allowed"
          />
          <Input
            value={shown}
            placeholder={fallback}
            maxLength={7}
            disabled={disabled}
            data-field={field}
            onChange={(e) => {
              const next = e.target.value.trim();
              setText(next);
              if (next === "") setField(field, null);
              else if (/^#[0-9a-fA-F]{6}$/.test(next)) setField(field, next.toUpperCase());
            }}
            onBlur={() => setText(null)}
            className="w-32 font-mono uppercase"
          />
          {value && !disabled && (
            <Button variant="ghost" size="sm" onClick={() => setField(field, null)}>
              Use default
            </Button>
          )}
        </div>
      </Field>
    </div>
  );
}

const KIND_HINTS: Record<AssetKind, string> = {
  logo_light: "PNG, JPG or WebP · at least 48 px tall · up to 2 MB. Shown on light backgrounds, emails and documents.",
  logo_dark: "PNG, JPG or WebP · up to 2 MB. Shown on dark sidebars and in dark mode.",
  mark: "PNG or WebP · at least 192 × 192 · up to 2 MB. Becomes the favicon and app icon.",
  email_logo: "PNG or JPG · up to 1 MB. Defaults to your light logo.",
  document_logo: "PNG or JPG · up to 2 MB. Printed on payslips. Defaults to your light logo.",
  login_image: "JPG, WebP or PNG · at least 800 × 600 · up to 3 MB. Side panel of the sign-in page.",
};
const ACCEPT: Record<AssetKind, string> = {
  logo_light: "image/png,image/jpeg,image/webp",
  logo_dark: "image/png,image/jpeg,image/webp",
  mark: "image/png,image/webp",
  email_logo: "image/png,image/jpeg",
  document_logo: "image/png,image/jpeg",
  login_image: "image/jpeg,image/webp,image/png",
};

export function AssetCard({
  control,
  kind,
  onUpload,
}: {
  control: FieldControl;
  kind: AssetKind;
  onUpload: (kind: AssetKind, file: File) => Promise<BrandAsset | null>;
}) {
  const { data, valueOf, setField } = control;
  const { locked, entitled } = fieldState(data, kind);
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const value = valueOf(kind);
  const asset = value && typeof value === "object" ? (value as BrandAsset) : null;
  const disabled = locked || !entitled;
  const backgrounds = kind === "logo_dark" ? ["bg-slate-900"] : kind === "login_image" ? ["bg-surface-muted"] : ["bg-white", "bg-slate-900"];
  return (
    <div className="rounded-2xl border border-border p-4" data-asset={kind}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{FIELD_LABELS[kind]}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{KIND_HINTS[kind]}</p>
        </div>
        <InheritanceBadge data={data} field={kind} />
      </div>
      <div className={cn("mt-3 grid gap-2", backgrounds.length > 1 && "grid-cols-2")}>
        {backgrounds.map((bg) => (
          <div key={bg} className={cn("flex h-24 items-center justify-center overflow-hidden rounded-xl border border-border", bg)}>
            {asset?.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={asset.url} alt={`${FIELD_LABELS[kind]} preview`} className="max-h-20 max-w-[90%] object-contain" />
            ) : (
              <span className={cn("text-xs", bg === "bg-slate-900" ? "text-slate-400" : "text-muted-foreground")}>
                {kind === "logo_dark" ? "Uses the light logo on a white chip" : "No image"}
              </span>
            )}
          </div>
        ))}
      </div>
      {asset && (
        <p className="mt-2 text-xs text-muted-foreground">
          {asset.width} × {asset.height} px · re-encoded, metadata removed
        </p>
      )}
      <input
        ref={file}
        type="file"
        accept={ACCEPT[kind]}
        className="hidden"
        data-upload={kind}
        onChange={async (e) => {
          const picked = e.target.files?.[0];
          e.target.value = "";
          if (!picked) return;
          setBusy(true);
          await onUpload(kind, picked);
          setBusy(false);
        }}
      />
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="secondary" disabled={disabled} loading={busy} onClick={() => file.current?.click()}>
          <Upload className="h-4 w-4" /> {asset ? "Replace" : "Upload"}
        </Button>
        {asset && !disabled && (
          <Button size="sm" variant="ghost" onClick={() => setField(kind, null)}>
            <X className="h-4 w-4" /> Remove
          </Button>
        )}
      </div>
    </div>
  );
}

export function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
  badge,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  badge?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-border px-4 py-3">
      <span>
        <span className="flex items-center gap-2 text-sm font-medium">
          {label} {badge}
        </span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <Switch checked={checked} onChange={onChange} label={label} disabled={disabled} />
    </div>
  );
}
