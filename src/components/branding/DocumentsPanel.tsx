"use client";

import { FileText, Lock, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Badge, Card, CardHeader, Skeleton } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api";
import { isSafeAssetUrl } from "@/lib/brand";

import { AssetCard, BrandTextField, type FieldControl } from "./fields";
import type { AssetKind, BrandAsset, ProfileSnapshot } from "./types";

interface EntityRow {
  id: number;
  code: string;
  legal_name: string;
  country_code: string;
  base_currency: string;
}
interface EntityBrand {
  entitled: boolean;
  draft: ProfileSnapshot | null;
  published: ProfileSnapshot | null;
  effective: { display_name: string; accent: string; accent_strip: string; legal_footer: string | null };
}

export function DocumentsPanel({
  control,
  onUpload,
  canManageEntities,
}: {
  control: FieldControl;
  onUpload: (kind: AssetKind, file: File) => Promise<BrandAsset | null>;
  canManageEntities: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <AssetCard control={control} kind="document_logo" onUpload={onUpload} />
        <Card className="space-y-4 p-5">
          <BrandTextField control={control} field="legal_footer" maxLength={300}
            hint="Printed at the bottom of emails and payslips, e.g. registered address." />
          <p className="text-xs text-muted-foreground">
            Payslips show the employer details of each legal entity (name, address and registration lines from Legal entities
            &amp; branches). Documents already issued keep the branding they were issued with.
          </p>
        </Card>
      </div>
      {canManageEntities && <EntityDocumentBrands />}
    </div>
  );
}

function EntityDocumentBrands() {
  const [entities, setEntities] = useState<EntityRow[] | null>(null);
  useEffect(() => {
    api.get<EntityRow[]>("/legal-entities").then(setEntities).catch((e) => toast.error(errorMessage(e)));
  }, []);
  return (
    <Card>
      <CardHeader title="Document branding per legal entity" description="Optional. An entity's payslips can carry its own logo, colour and footer." />
      {!entities ? (
        <Skeleton className="m-5 h-24" />
      ) : (
        <div className="divide-y divide-border/70">
          {entities.map((e) => <EntityBrandRow key={e.id} entity={e} />)}
        </div>
      )}
    </Card>
  );
}

function EntityBrandRow({ entity }: { entity: EntityRow }) {
  const [data, setData] = useState<EntityBrand | null>(null);
  const [accent, setAccent] = useState("");
  const [footer, setFooter] = useState("");
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const next = await api.get<EntityBrand>(`/legal-entities/${entity.id}/document-brand`);
    setData(next);
    const fields = (next.draft ?? next.published)?.fields ?? {};
    setAccent((fields.accent_color as string) ?? "");
    setFooter((fields.legal_footer as string) ?? "");
  }, [entity.id]);
  useEffect(() => {
    void load().catch((e) => toast.error(errorMessage(e)));
  }, [load]);

  const save = async (changes: Record<string, unknown>) => {
    setBusy(true);
    try {
      const next = await api.put<EntityBrand>(`/legal-entities/${entity.id}/document-brand`, {
        changes, row_version: data?.draft?.row_version ?? null,
      });
      setData(next);
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <Skeleton className="m-5 h-16" />;
  const fields = (data.draft ?? data.published)?.fields ?? {};
  const logo = fields.document_logo as BrandAsset | null | undefined;
  return (
    <div className="space-y-3 px-5 py-4" data-entity-brand={entity.code}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-medium">
          <FileText className="h-4 w-4 text-muted-foreground" />
          {entity.legal_name} <Badge>{entity.code} · {entity.country_code} · {entity.base_currency}</Badge>
          {data.published && <Badge tone="success">Live v{data.published.version}</Badge>}
          {data.draft && <Badge tone="warning">Draft</Badge>}
        </p>
        {!data.entitled && (
          <Badge tone="neutral"><Lock className="mr-1 inline h-3 w-3" />Enterprise plan</Badge>
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-[180px_1fr_1fr_auto] md:items-end">
        <div className="flex h-16 items-center justify-center rounded-xl border border-border bg-white">
          {logo && isSafeAssetUrl(logo.url) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo.url} alt={`${entity.legal_name} document logo`} className="max-h-12 max-w-[90%] object-contain" />
          ) : (
            <span className="text-xs text-muted-foreground">Company logo</span>
          )}
        </div>
        <Field label="Accent colour" hint="Section headings and the net-pay band">
          <Input value={accent} maxLength={7} placeholder={data.effective.accent_strip} disabled={!data.entitled}
            onChange={(e) => setAccent(e.target.value)} className="font-mono uppercase" />
        </Field>
        <Field label="Legal footer">
          <Input value={footer} maxLength={300} disabled={!data.entitled} onChange={(e) => setFooter(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <input ref={file} type="file" accept="image/png,image/jpeg" className="hidden" onChange={async (e) => {
            const picked = e.target.files?.[0];
            e.target.value = "";
            if (!picked) return;
            const form = new FormData();
            form.append("file", picked);
            form.append("kind", "document_logo");
            try {
              const asset = await api.post<BrandAsset>(`/legal-entities/${entity.id}/document-brand/assets`, form);
              if (await save({ document_logo: asset.id })) toast.success("Logo added to the draft");
            } catch (err) {
              toast.error(errorMessage(err));
            }
          }} />
          <Button size="sm" variant="secondary" disabled={!data.entitled || busy} onClick={() => file.current?.click()}>
            <Upload className="h-4 w-4" /> Logo
          </Button>
          <Button size="sm" variant="secondary" disabled={!data.entitled} loading={busy}
            onClick={async () => {
              if (await save({ accent_color: accent || null, legal_footer: footer || null })) toast.success("Draft saved");
            }}>
            Save draft
          </Button>
          <Button size="sm" disabled={!data.entitled || !data.draft} loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setData(await api.post<EntityBrand>(`/legal-entities/${entity.id}/document-brand/publish`, {
                  row_version: data.draft?.row_version ?? null,
                }));
                toast.success("Document branding published. Payslips issued from now on use it.");
              } catch (e) {
                toast.error(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}>
            Publish
          </Button>
        </div>
      </div>
    </div>
  );
}
