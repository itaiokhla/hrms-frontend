"use client";

import { AlertTriangle, CheckCircle2, Eye, Loader2, Lock, Rocket, Undo2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { RequireAccess, useCan } from "@/components/access/Can";
import { BrandPreview } from "@/components/branding/BrandPreview";
import { DocumentsPanel } from "@/components/branding/DocumentsPanel";
import { DomainsPanel } from "@/components/branding/DomainsPanel";
import { EmailPanel } from "@/components/branding/EmailPanel";
import { AssetCard, BrandTextField, ColorField, Segmented, ToggleRow, fieldState, InheritanceBadge, type FieldControl } from "@/components/branding/fields";
import { HistoryPanel } from "@/components/branding/HistoryPanel";
import { LOCALES, PLAN_LABELS, type ValidationResult } from "@/components/branding/types";
import { useBranding } from "@/components/branding/useBranding";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { ErrorState, PageHeader, TabPanel, Tabs } from "@/components/ui/layout";
import { Modal, Sheet, useConfirm } from "@/components/ui/overlay";
import { Badge, Card, CardHeader, Skeleton } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api";
import { canAny, can } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

export default function BrandingPage() {
  return (
    <RequireAccess check={(me) => canAny(me, [P.BRANDING_MANAGE, P.DOMAIN_MANAGE, P.EMAIL_TEMPLATE_MANAGE])}>
      <Suspense>
        <Branding />
      </Suspense>
    </RequireAccess>
  );
}

function Branding() {
  const { me } = useCan();
  const params = useSearchParams();
  const router = useRouter();
  const canBrand = can(me, P.BRANDING_MANAGE);
  const canDomains = can(me, P.DOMAIN_MANAGE);
  const canTemplates = can(me, P.EMAIL_TEMPLATE_MANAGE);
  const tabs = [
    ...(canBrand
      ? [
          { value: "identity", label: "Identity" },
          { value: "logos", label: "Logos" },
          { value: "colours", label: "Colours" },
          { value: "login", label: "Login & links" },
        ]
      : []),
    ...(canBrand || canTemplates || canDomains ? [{ value: "email", label: "Email" }] : []),
    ...(canBrand ? [{ value: "documents", label: "Documents" }] : []),
    ...(canDomains ? [{ value: "domains", label: "Domains" }] : []),
    ...(canBrand ? [{ value: "advanced", label: "Advanced" }, { value: "history", label: "History" }] : []),
  ];
  const requested = params.get("tab") ?? (params.get("modal") === "add-domain" ? "domains" : null);
  const [tab, setTab] = useState(tabs.find((t) => t.value === requested)?.value ?? tabs[0]?.value ?? "identity");
  const changeTab = (value: string) => {
    setTab(value);
    router.replace(`/settings/branding?tab=${value}`, { scroll: false });
  };

  return (
    <div>
      <PageHeader
        eyebrow="Settings"
        title="Branding & domains"
        description="How your workspace looks to your people: sign-in page, app, emails and payslips. Changes stay in a draft until you publish."
      />
      {canBrand ? <BrandEditor tab={tab} tabs={tabs} onTab={changeTab} canDomains={canDomains} canTemplates={canTemplates} /> : (
        <Tabs tabs={tabs} value={tab} onValueChange={changeTab}>
          <TabPanel value="email"><EmailPanel canManageTemplates={canTemplates} canSeeDomains={canDomains} /></TabPanel>
          {canDomains && <TabPanel value="domains"><DomainsPanel openWizard={params.get("modal") === "add-domain"} /></TabPanel>}
        </Tabs>
      )}
    </div>
  );
}

function BrandEditor({ tab, tabs, onTab, canDomains, canTemplates }: {
  tab: string; tabs: { value: string; label: string }[]; onTab: (v: string) => void; canDomains: boolean; canTemplates: boolean;
}) {
  const { me } = useCan();
  const params = useSearchParams();
  const confirm = useConfirm();
  const branding = useBranding();
  const { data, error, saving, setField, valueOf, upload, validate, publish, discard, restore, reload } = branding;
  const [review, setReview] = useState<ValidationResult | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [mobilePreview, setMobilePreview] = useState(false);
  const control = useMemo<FieldControl | null>(() => (data ? { data, valueOf, setField } : null), [data, valueOf, setField]);

  if (error) return <ErrorState message={error} onRetry={() => void reload()} />;
  if (!data || !control) return <Skeleton className="h-96 rounded-3xl" />;

  const live = data.published;
  const changes = data.unpublished_changes;
  const openPublish = async () => {
    try {
      setReview(await validate());
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const doPublish = async () => {
    setPublishing(true);
    try {
      const result = await publish(review?.row_version);
      toast.success(`Version ${result.version} is live`);
      setReview(null);
    } catch (e) {
      toast.error(errorMessage(e));
      setReview(await validate().catch(() => null));
    } finally {
      setPublishing(false);
    }
  };
  const previewInNewTab = async () => {
    try {
      await branding.flush();
      const { token } = await api.post<{ token: string }>("/branding/preview-token");
      window.open(`/dashboard?brand_preview=${encodeURIComponent(token)}`, "_blank", "noopener");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const status = (
    <Card className="mb-6 flex flex-wrap items-center justify-between gap-3 px-5 py-3" data-testid="brand-status">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {saving ? (
          <Badge tone="info"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> Saving draft…</Badge>
        ) : changes > 0 ? (
          <Badge tone="warning" dot data-testid="draft-badge">Draft · {changes} unpublished change{changes === 1 ? "" : "s"}</Badge>
        ) : (
          <Badge tone="success" dot>Up to date</Badge>
        )}
        {live && <span className="text-muted-foreground">Live: version {live.version}</span>}
        <Badge tone="neutral">Plan: {PLAN_LABELS[data.plan] ?? data.plan}</Badge>
        {data.partner && <Badge tone="info">Managed with {data.partner.name}</Badge>}
        {data.brand_disabled && <Badge tone="danger">Disabled by the platform</Badge>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" disabled={!data.draft} onClick={async () => {
          if (await confirm({ title: "Discard unpublished changes?", message: "The draft is deleted. The live brand is not affected.", confirmLabel: "Discard", tone: "danger" })) {
            await discard().catch((e) => toast.error(errorMessage(e)));
          }
        }}>
          <Undo2 className="h-4 w-4" /> Discard
        </Button>
        <Button size="sm" variant="secondary" onClick={previewInNewTab} disabled={!data.draft} data-testid="preview-new-tab">
          <Eye className="h-4 w-4" /> Preview in new tab
        </Button>
        <Button size="sm" variant="secondary" className="xl:hidden" onClick={() => setMobilePreview(true)}>Preview</Button>
        <Button size="sm" onClick={openPublish} disabled={!data.draft || changes === 0 || saving} data-testid="publish-brand">
          <Rocket className="h-4 w-4" /> Publish
        </Button>
      </div>
    </Card>
  );

  const preview = <BrandPreview brand={data.preview} />;
  const powered = fieldState(data, "show_powered_by");
  const poweredValue = valueOf("show_powered_by");

  return (
    <>
      {status}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          <Tabs tabs={tabs} value={tab} onValueChange={onTab}>
            <TabPanel value="identity">
              <Card>
                <CardHeader title="Identity" description="Names shown in the browser tab, sidebar, sign-in page, emails and the authenticator app." />
                <div className="grid gap-5 p-5 md:grid-cols-2">
                  <BrandTextField control={control} field="display_name" maxLength={150} hint="Defaults to your company name." />
                  <BrandTextField control={control} field="product_name" maxLength={40} hint="Replaces the platform's product name." />
                  <BrandTextField control={control} field="short_name" maxLength={12} hint="Label under the installed app icon." />
                  <BrandTextField control={control} field="tagline" maxLength={80} hint="Shown on the sign-in page." />
                </div>
              </Card>
            </TabPanel>
            <TabPanel value="logos">
              <div className="grid gap-4 md:grid-cols-2">
                <AssetCard control={control} kind="logo_light" onUpload={upload} />
                <AssetCard control={control} kind="logo_dark" onUpload={upload} />
                <AssetCard control={control} kind="mark" onUpload={upload} />
                <Card className="p-4 text-sm">
                  <p className="font-semibold">How images are handled</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                    <li>Every upload is decoded and re-encoded on our servers; metadata such as GPS location is removed.</li>
                    <li>Animated images, SVG files and images above 40 megapixels are refused.</li>
                    <li>The square mark becomes your favicon and app icon. Without one, your initials on your brand colour are used.</li>
                  </ul>
                </Card>
              </div>
            </TabPanel>
            <TabPanel value="colours">
              <Card>
                <CardHeader title="Colours & style" description="We adjust shades automatically so text keeps WCAG AA contrast. Error, warning and success colours never change." />
                <div className="space-y-6 p-5">
                  <div className="grid gap-5 md:grid-cols-2">
                    <ColorField control={control} field="primary_color" hint="Buttons, links, active navigation and focus ring." />
                    <ColorField control={control} field="accent_color" hint="Highlights and gradients. Optional." />
                  </div>
                  <div className="flex flex-wrap gap-6">
                    <Segmented label="Sidebar" value={(valueOf("sidebar_style") as "DARK" | "LIGHT" | "BRAND") ?? "DARK"}
                      disabled={fieldState(data, "sidebar_style").locked}
                      options={[{ value: "DARK", label: "Dark" }, { value: "LIGHT", label: "Light" }, { value: "BRAND", label: "Brand colour" }]}
                      onChange={(v) => setField("sidebar_style", v)} />
                    <Segmented label="Corners" value={(valueOf("radius") as "SHARP" | "ROUNDED" | "PILL") ?? "ROUNDED"}
                      disabled={fieldState(data, "radius").locked}
                      options={[{ value: "SHARP", label: "Sharp" }, { value: "ROUNDED", label: "Rounded" }, { value: "PILL", label: "Pill" }]}
                      onChange={(v) => setField("radius", v)} />
                  </div>
                  <Field label="Font" hint="Self-hosted fonts only. Right-to-left languages always use Noto for their script.">
                    <Select value={(valueOf("font") as string) ?? ""} disabled={fieldState(data, "font").locked}
                      onChange={(e) => setField("font", e.target.value || null)} data-field="font">
                      <option value="">Platform default (Inter)</option>
                      <option value="INTER">Inter</option>
                      <option value="POPPINS">Poppins (Latin, Devanagari)</option>
                      <option value="ROBOTO">Roboto</option>
                      <option value="NOTO">Noto Sans (broad script coverage)</option>
                      <option value="SYSTEM">System font</option>
                    </Select>
                  </Field>
                  <div>
                    <p className="mb-2 text-[13px] font-medium">Contrast checks (draft)</p>
                    <div className="flex flex-wrap gap-2" data-testid="contrast-report">
                      {data.preview.contrast_report.length === 0 && <span className="text-xs text-muted-foreground">Using the platform colours.</span>}
                      {data.preview.contrast_report.map((c) => (
                        <Badge key={c.check} tone={c.pass ? "success" : "danger"}>
                          {c.pass ? <CheckCircle2 className="mr-1 inline h-3 w-3" /> : <AlertTriangle className="mr-1 inline h-3 w-3" />}
                          {c.check} {c.ratio.toFixed(1)}:1{c.adjusted ? " · adjusted" : ""}
                        </Badge>
                      ))}
                    </div>
                    {data.preview.warnings.map((w) => (
                      <p key={w} className="mt-2 flex items-start gap-1.5 text-xs text-warning" data-testid="colour-warning">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {w}
                      </p>
                    ))}
                    {data.preview.exact?.primary && (
                      <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                        Exact colour <span className="inline-block h-4 w-4 rounded" style={{ background: data.preview.exact.primary }} />
                        {data.preview.exact.primary} · used as-is for logo areas, emails and documents
                      </p>
                    )}
                  </div>
                </div>
              </Card>
            </TabPanel>
            <TabPanel value="login">
              <div className="space-y-6">
                <AssetCard control={control} kind="login_image" onUpload={upload} />
                <Card>
                  <CardHeader title="Help and policy links" description="Shown on the sign-in page and in emails. https:// addresses only." />
                  <div className="grid gap-5 p-5 md:grid-cols-2">
                    <BrandTextField control={control} field="support_email" type="email" />
                    <BrandTextField control={control} field="support_phone" hint="International format, e.g. +919876543210" />
                    <BrandTextField control={control} field="support_url" type="url" />
                    <BrandTextField control={control} field="help_center_url" type="url" />
                    <BrandTextField control={control} field="terms_url" type="url" />
                    <BrandTextField control={control} field="privacy_url" type="url" />
                    <BrandTextField control={control} field="status_page_url" type="url" />
                  </div>
                </Card>
              </div>
            </TabPanel>
            <TabPanel value="email">
              <div className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <AssetCard control={control} kind="email_logo" onUpload={upload} />
                  <Card className="space-y-4 p-5">
                    <BrandTextField control={control} field="email_sender_name" maxLength={100} hint="Shown as the sender. Defaults to your company name." />
                    <BrandTextField control={control} field="legal_footer" maxLength={300} />
                  </Card>
                </div>
                <EmailPanel canManageTemplates={canTemplates} canSeeDomains={canDomains} />
              </div>
            </TabPanel>
            <TabPanel value="documents">
              <DocumentsPanel control={control} onUpload={upload} canManageEntities={can(me, P.ORG_MANAGE_ENTITIES)} />
            </TabPanel>
            {canDomains && (
              <TabPanel value="domains">
                <DomainsPanel openWizard={params.get("modal") === "add-domain"} />
              </TabPanel>
            )}
            <TabPanel value="advanced">
              <Card>
                <CardHeader title="Advanced" />
                <div className="space-y-4 p-5">
                  <ToggleRow
                    label="Show “Powered by” credit"
                    hint="On the sign-in page, emails and documents."
                    checked={poweredValue === null ? true : !!poweredValue}
                    disabled={powered.locked || (!powered.entitled && poweredValue !== false)}
                    badge={<InheritanceBadge data={data} field="show_powered_by" />}
                    onChange={(v) => setField("show_powered_by", v)}
                  />
                  <Field label="Default language" hint="Right-to-left languages switch the whole app to right-to-left.">
                    <Select value={(valueOf("default_locale") as string) ?? ""} onChange={(e) => setField("default_locale", e.target.value || null)} data-field="default_locale">
                      <option value="">Platform default (English)</option>
                      {LOCALES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                    </Select>
                  </Field>
                  <div>
                    <p className="mb-2 text-[13px] font-medium">Your plan includes</p>
                    <div className="flex flex-wrap gap-2">
                      {data.entitlements.map((e) => (
                        <Badge key={e.key} tone={e.enabled ? "success" : "neutral"}>
                          {!e.enabled && <Lock className="mr-1 inline h-3 w-3" />}{e.label}
                          {!e.enabled && e.available_on && ` · ${PLAN_LABELS[e.available_on] ?? e.available_on}`}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            </TabPanel>
            <TabPanel value="history">
              <HistoryPanel onRestore={restore} />
            </TabPanel>
          </Tabs>
        </div>
        <aside className="hidden xl:block">
          <div className="sticky top-24 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Live preview (draft)</p>
            {preview}
          </div>
        </aside>
      </div>

      <Sheet open={mobilePreview} onOpenChange={setMobilePreview} title="Preview (draft)">{preview}</Sheet>

      <Modal
        open={!!review}
        onOpenChange={(o) => !o && setReview(null)}
        title="Publish brand"
        description="Everyone sees the new brand after publishing. Documents already issued keep their original branding."
        footer={
          <>
            <Button variant="secondary" onClick={() => setReview(null)}>Cancel</Button>
            <Button onClick={doPublish} loading={publishing} disabled={!review?.valid} data-testid="confirm-publish">Publish now</Button>
          </>
        }
      >
        {review && (
          <div className="space-y-4 text-sm">
            {review.errors.length > 0 && (
              <div className="rounded-xl border border-danger/20 bg-danger-soft p-3 text-danger" role="alert">
                {review.errors.map((e) => <p key={e}>{e}</p>)}
              </div>
            )}
            {review.changes.length > 0 && (
              <ul className="space-y-1.5" data-testid="publish-diff">
                {review.changes.map((c) => (
                  <li key={c.field} className="flex flex-wrap gap-1">
                    <span className="font-medium">{c.label}:</span>
                    <span className="text-muted-foreground line-through">{String(c.from ?? "—")}</span>
                    <span>→ {String(c.to ?? "—")}</span>
                  </li>
                ))}
              </ul>
            )}
            {review.warnings.map((w) => (
              <p key={w} className="flex items-start gap-1.5 text-xs text-warning"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {w}</p>
            ))}
            <p className="text-xs text-muted-foreground">Affects: sign-in pages, the app, browser tab and app icon, new emails and newly issued payslips.</p>
          </div>
        )}
      </Modal>
    </>
  );
}
