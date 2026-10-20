"use client";

import { Lock, MailCheck, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Badge, Card, CardHeader, Skeleton } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api";

import { LOCALES } from "./types";

interface TemplateSummary {
  key: string;
  label: string;
  customized_locales: string[];
}
interface TemplateView {
  key: string;
  label: string;
  locale: string;
  defaults: { subject: string; intro: string; signature: string };
  override: { subject: string | null; intro: string | null; signature: string | null; version: number } | null;
  placeholders: string[];
  entitled: boolean;
}
interface Preview {
  subject: string;
  html: string;
  text: string;
  from_name: string;
  reply_to: string | null;
  fallback: boolean;
}
interface SenderStatus {
  available: boolean;
  entitled: boolean;
  reason: string;
}

export function EmailPanel({ canManageTemplates, canSeeDomains }: { canManageTemplates: boolean; canSeeDomains: boolean }) {
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [key, setKey] = useState("auth.invite");
  const [locale, setLocale] = useState("en");
  const [view, setView] = useState<TemplateView | null>(null);
  const [form, setForm] = useState({ subject: "", intro: "", signature: "" });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sender, setSender] = useState<SenderStatus | null>(null);

  useEffect(() => {
    if (canManageTemplates) api.get<TemplateSummary[]>("/email-templates").then(setTemplates).catch((e) => toast.error(errorMessage(e)));
    if (canSeeDomains) api.get<SenderStatus>("/email-domains").then(setSender).catch(() => undefined);
  }, [canManageTemplates, canSeeDomains]);

  const loadTemplate = useCallback(async () => {
    if (!canManageTemplates) return;
    const data = await api.get<TemplateView>(`/email-templates/${key}`, { params: { locale } });
    setView(data);
    setForm({
      subject: data.override?.subject ?? "",
      intro: data.override?.intro ?? "",
      signature: data.override?.signature ?? "",
    });
  }, [key, locale, canManageTemplates]);
  useEffect(() => {
    void loadTemplate();
  }, [loadTemplate]);

  const body = () => ({ subject: form.subject || null, intro: form.intro || null, signature: form.signature || null });

  const refreshPreview = useCallback(async () => {
    if (!canManageTemplates) return;
    try {
      setPreview(await api.post<Preview>(`/email-templates/${key}/preview`, body()));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, form, canManageTemplates]);
  useEffect(() => {
    const t = setTimeout(() => void refreshPreview(), 500);
    return () => clearTimeout(t);
  }, [refreshPreview]);

  const save = async () => {
    setSaving(true);
    try {
      setView(await api.put<TemplateView>(`/email-templates/${key}`, body(), { params: { locale } }));
      toast.success("Email wording saved");
      setTemplates(await api.get<TemplateSummary[]>("/email-templates"));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {canSeeDomains && (
        <Card>
          <CardHeader title="Sender" description="Who your emails come from." />
          <div className="space-y-2 p-5 text-sm">
            {!sender ? (
              <Skeleton className="h-10" />
            ) : (
              <>
                <p className="flex items-center gap-2">
                  <Badge tone="warning">Custom sending domain unavailable</Badge>
                  {!sender.entitled && <Badge tone="neutral"><Lock className="mr-1 inline h-3 w-3" />Professional plan</Badge>}
                </p>
                <p className="text-muted-foreground">{sender.reason}</p>
              </>
            )}
          </div>
        </Card>
      )}
      {canManageTemplates && (
        <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
          <Card>
            <CardHeader title="Email wording" description="Change the subject, intro and signature. The layout and security texts are fixed." />
            <div className="space-y-4 p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Template">
                  <Select value={key} onChange={(e) => setKey(e.target.value)} data-testid="email-template">
                    {(templates ?? []).map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.label}{t.customized_locales.length ? " · customised" : ""}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Language">
                  <Select value={locale} onChange={(e) => setLocale(e.target.value)}>
                    {LOCALES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                  </Select>
                </Field>
              </div>
              {view && !view.entitled && (
                <p className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
                  <Lock className="mr-1 inline h-3 w-3" /> Editing email wording is available on the Standard plan.
                </p>
              )}
              <Field label="Subject" hint={view ? `Default: ${view.defaults.subject}` : undefined}>
                <Input value={form.subject} disabled={!view?.entitled} onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  placeholder={view?.defaults.subject} data-testid="email-subject" />
              </Field>
              <Field label="Intro">
                <Textarea value={form.intro} disabled={!view?.entitled} onChange={(e) => setForm({ ...form, intro: e.target.value })}
                  placeholder={view?.defaults.intro} rows={4} />
              </Field>
              <Field label="Signature">
                <Input value={form.signature} disabled={!view?.entitled} onChange={(e) => setForm({ ...form, signature: e.target.value })}
                  placeholder={view?.defaults.signature} />
              </Field>
              {view && (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Placeholders you can use</p>
                  <div className="flex flex-wrap gap-1">
                    {view.placeholders.map((p) => (
                      <button key={p} type="button" className="rounded-lg bg-muted px-2 py-0.5 font-mono text-[11px] hover:bg-primary-soft"
                        disabled={!view.entitled}
                        onClick={() => setForm({ ...form, intro: `${form.intro}{{ ${p} }}` })}>
                        {`{{ ${p} }}`}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {error && <p role="alert" className="text-sm text-danger">{error}</p>}
              <div className="flex flex-wrap gap-2">
                <Button onClick={save} loading={saving} disabled={!view?.entitled} data-testid="email-save">Save wording</Button>
                <Button variant="secondary" onClick={async () => {
                  try {
                    const r = await api.post<{ sent: boolean; to: string; delivery: string }>(`/email-templates/${key}/test-send`);
                    toast.success(`Test email ${r.sent ? "sent" : "written to the " + r.delivery} for ${r.to}`);
                  } catch (e) {
                    toast.error(errorMessage(e));
                  }
                }}>
                  <Send className="h-4 w-4" /> Send test to me
                </Button>
              </div>
            </div>
          </Card>
          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><MailCheck className="h-4 w-4" /> Preview</span>}
              description="Rendered by the server with your published brand and sample data." />
            <div className="space-y-2 p-5">
              {preview ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    From <span className="font-medium text-foreground">{preview.from_name}</span>
                    {preview.reply_to && <> · Reply-To {preview.reply_to}</>}
                  </p>
                  <p className="text-sm font-semibold" data-testid="email-preview-subject">{preview.subject}</p>
                  <iframe
                    title="Email preview"
                    sandbox=""
                    srcDoc={preview.html}
                    className="h-[440px] w-full rounded-xl border border-border bg-white"
                    data-testid="email-preview"
                  />
                </>
              ) : (
                <Skeleton className="h-[440px] rounded-xl" />
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
