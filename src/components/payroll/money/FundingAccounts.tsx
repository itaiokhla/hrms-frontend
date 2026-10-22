"use client";

import { ArrowLeft, Building2, ExternalLink, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { MaskedValue } from "@/components/payroll/MaskedValue";
import { useModalRoute } from "@/components/payroll/useModalRoute";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Column, DataTable, EmptyState, ErrorState } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Card } from "@/components/ui/primitives";
import { can } from "@/lib/access";
import { ApiError } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { newIdempotencyKey } from "@/lib/payroll/api";
import { P } from "@/lib/permissions.generated";

import { REVEAL_REASON_MIN, routingText } from "./BankAccountPanel";
import { fundingApi } from "./api";
import { ConflictBanner, DetailGate, ErrorSummary, FilterBar, Meta, Notice, PaymentsNav, ReasonModal, SandboxBadge, WorkspaceHeader, fieldErrors, humanize, useEntities, useUserNames, useUsers } from "./shared";
import { FUNDING_PURPOSES, type FundingAccount, type FundingAccountInput } from "./types";

const ROUTING_KEYS = [
  { value: "ifsc", label: "IFSC" },
  { value: "sort_code", label: "Sort code" },
  { value: "aba", label: "ABA routing number" },
  { value: "bsb", label: "BSB" },
  { value: "bic", label: "BIC / SWIFT" },
  { value: "bank_code", label: "Bank code" },
];
const FILE_FORMATS = ["GENERIC_CSV"];

function useRevealFunding(id: number): ((reason: string) => Promise<string>) | undefined {
  const { me } = useCan();
  if (!can(me, P.PAYROLL_BANK_DETAILS_READ_FULL)) return undefined;
  return async (reason) => {
    if (reason.trim().length < REVEAL_REASON_MIN) throw new ApiError(400, `Say why you need the full number (at least ${REVEAL_REASON_MIN} characters).`, "REASON_REQUIRED");
    const full = await fundingApi.reveal(id, reason);
    return full.iban || full.account_number || full.account_masked;
  };
}

function FundingNumber({ account }: { account: FundingAccount }) {
  const onReveal = useRevealFunding(account.id);
  return <MaskedValue masked={account.account_masked} label={account.has_iban ? "IBAN" : "account number"} onReveal={onReveal} />;
}

/* ------------------------------------------------------------------ signatories */

function SignatoryPicker({ value, onChange, error }: { value: number[]; onChange: (ids: number[]) => void; error?: string }) {
  const { users, allowed } = useUsers();
  const [text, setText] = useState(value.join(", "));
  if (!allowed) {
    return (
      <Field label="Signatories (user IDs)" required error={error} hint="Your role can't list users; enter user IDs separated by commas. Only signatories can release payment batches.">
        <Input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            onChange(e.target.value.split(/[,\s]+/).map((s) => Number.parseInt(s, 10)).filter((n) => Number.isFinite(n) && n > 0));
          }}
          className="min-h-[44px]"
        />
      </Field>
    );
  }
  const active = users.filter((u) => u.status === "active" || value.includes(u.id));
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium">
        Signatories <span className="text-danger">*</span>
      </legend>
      <p className="text-xs text-muted-foreground">Only signatories can release payment batches from this account. Choose at least one person.</p>
      <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
        {active.map((u) => (
          <label key={u.id} className="flex min-h-[44px] items-center gap-2 rounded-lg px-2 hover:bg-surface-muted">
            <input type="checkbox" className="h-4 w-4" checked={value.includes(u.id)} onChange={(e) => onChange(e.target.checked ? [...value, u.id] : value.filter((v) => v !== u.id))} />
            <span className="text-sm">{u.full_name}</span>
            <span className="text-xs text-muted-foreground">{u.email}</span>
          </label>
        ))}
        {!active.length && <p className="p-2 text-sm text-muted-foreground">No active users.</p>}
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </fieldset>
  );
}

/* ------------------------------------------------------------------ create */

interface Draft {
  entity: string;
  name: string;
  purpose: string;
  holder: string;
  country: string;
  currency: string;
  numberKind: "account" | "iban";
  number: string;
  routingKey: string;
  routingCode: string;
  bankName: string;
  signatories: number[];
  sandbox: boolean;
}

const EMPTY: Draft = { entity: "", name: "", purpose: "PAYROLL", holder: "", country: "", currency: "", numberKind: "account", number: "", routingKey: "ifsc", routingCode: "", bankName: "", signatories: [], sandbox: false };

export function validateFundingDraft(d: Draft): Record<string, string> {
  const e: Record<string, string> = {};
  if (!d.entity) e.entity = "Choose the legal entity that owns this account.";
  if (!d.name.trim()) e.name = "Give the account a name, such as “Payroll — HDFC”.";
  if (!d.holder.trim()) e.holder = "Enter the account holder's name.";
  if (!/^[A-Za-z]{2}$/.test(d.country)) e.country = "Two-letter country code, such as IN.";
  if (!/^[A-Za-z]{3}$/.test(d.currency)) e.currency = "Three-letter currency code, such as INR.";
  if (!d.number.trim()) e.number = d.numberKind === "iban" ? "Enter the IBAN." : "Enter the account number.";
  if (!d.signatories.length) e.signatories = "Choose at least one signatory.";
  return e;
}

export function CreateFundingAccountModal({ open, onOpenChange, onCreated, onDirtyChange }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (row: FundingAccount) => void; onDirtyChange?: (d: boolean) => void }) {
  const entities = useEntities();
  const [d, setD] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(newIdempotencyKey());
  useEffect(() => {
    if (!open) return;
    setD(EMPTY);
    setErrors({});
    setError(null);
    key.current = newIdempotencyKey();
  }, [open]);
  useEffect(() => onDirtyChange?.(JSON.stringify(d) !== JSON.stringify(EMPTY)), [d, onDirtyChange]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setD((x) => ({ ...x, [k]: v }));
    setErrors((x) => ({ ...x, [k]: "" }));
  };
  const chooseEntity = (id: string) => {
    const e = entities.entities.find((x) => String(x.id) === id);
    setD((x) => ({ ...x, entity: id, country: x.country || e?.country_code || "", currency: x.currency || e?.base_currency || "" }));
  };
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const next = validateFundingDraft(d);
    setErrors(next);
    if (Object.keys(next).length) return;
    const body: FundingAccountInput = {
      name: d.name.trim(),
      purpose: d.purpose,
      signatory_user_ids: d.signatories,
      formats: FILE_FORMATS,
      provider_profile: d.sandbox ? "SANDBOX" : null,
      details: {
        holder_name: d.holder.trim(),
        country: d.country.toUpperCase(),
        currency: d.currency.toUpperCase(),
        account_number: d.numberKind === "account" ? d.number.replace(/\s+/g, "") : null,
        iban: d.numberKind === "iban" ? d.number.replace(/\s+/g, "").toUpperCase() : null,
        routing: d.routingCode.trim() ? { [d.routingKey]: d.routingCode.trim() } : {},
        bank_name: d.bankName.trim() || null,
      },
    };
    setBusy(true);
    setError(null);
    try {
      const row = await fundingApi.create(Number(d.entity), body, key.current);
      toast.success("Funding account added");
      onCreated(row);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const all = { ...fieldErrors(error), ...Object.fromEntries(Object.entries(errors).filter(([, v]) => v)) };
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Add funding account"
      description="A company bank account that pays salaries for one legal entity. You will be asked to confirm it's you."
      footer={
        <>
          <Button variant="ghost" className="min-h-[44px]" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="funding-create" className="min-h-[44px]" loading={busy}>
            Add account
          </Button>
        </>
      }
    >
      <form id="funding-create" onSubmit={submit} className="space-y-4" noValidate>
        <ConflictBanner error={error} />
        <ErrorSummary error={error} fields={all} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Legal entity" required error={errors.entity}>
            {entities.allowed && entities.entities.length ? (
              <Select value={d.entity} onChange={(e) => chooseEntity(e.target.value)} className="min-h-[44px]">
                <option value="">Choose…</option>
                {entities.entities.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.trade_name || e.legal_name} ({e.country_code})
                  </option>
                ))}
              </Select>
            ) : (
              <Input inputMode="numeric" placeholder="Entity ID" value={d.entity} onChange={(e) => set("entity", e.target.value.replace(/\D/g, ""))} className="min-h-[44px]" />
            )}
          </Field>
          <Field label="Name" required error={errors.name}>
            <Input value={d.name} maxLength={100} onChange={(e) => set("name", e.target.value)} className="min-h-[44px]" />
          </Field>
          <Field label="Purpose">
            <Select value={d.purpose} onChange={(e) => set("purpose", e.target.value)} className="min-h-[44px]">
              {FUNDING_PURPOSES.map((p) => (
                <option key={p} value={p}>
                  {humanize(p)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Account holder" required error={errors.holder}>
            <Input value={d.holder} maxLength={140} onChange={(e) => set("holder", e.target.value)} className="min-h-[44px]" />
          </Field>
          <Field label="Country" required error={errors.country}>
            <Input value={d.country} maxLength={2} onChange={(e) => set("country", e.target.value.toUpperCase())} className="min-h-[44px]" />
          </Field>
          <Field label="Currency" required error={errors.currency}>
            <Input value={d.currency} maxLength={3} onChange={(e) => set("currency", e.target.value.toUpperCase())} className="min-h-[44px]" />
          </Field>
          <Field label="Number type">
            <Select value={d.numberKind} onChange={(e) => set("numberKind", e.target.value as Draft["numberKind"])} className="min-h-[44px]">
              <option value="account">Account number</option>
              <option value="iban">IBAN</option>
            </Select>
          </Field>
          <Field label={d.numberKind === "iban" ? "IBAN" : "Account number"} required error={errors.number ?? all.account_number ?? all.iban}>
            <Input value={d.number} autoComplete="off" spellCheck={false} maxLength={64} onChange={(e) => set("number", e.target.value)} className="min-h-[44px] font-mono" dir="ltr" />
          </Field>
          <Field label="Routing code type">
            <Select value={d.routingKey} onChange={(e) => set("routingKey", e.target.value)} className="min-h-[44px]">
              {ROUTING_KEYS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Routing code" error={all.routing}>
            <Input value={d.routingCode} maxLength={40} onChange={(e) => set("routingCode", e.target.value.toUpperCase())} className="min-h-[44px] font-mono" dir="ltr" />
          </Field>
          <Field label="Bank name">
            <Input value={d.bankName} maxLength={140} onChange={(e) => set("bankName", e.target.value)} className="min-h-[44px]" />
          </Field>
        </div>
        <SignatoryPicker value={d.signatories} onChange={(ids) => set("signatories", ids)} error={errors.signatories} />
        <label className="flex min-h-[44px] items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4" checked={d.sandbox} onChange={(e) => set("sandbox", e.target.checked)} />
          Allow payouts through the SANDBOX provider (simulated; no money moves)
        </label>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ list */

/** Payroll › Payout Files › Funding accounts (3.7 §6; payroll:funding_accounts:manage). */
export function FundingAccountsWorkspace() {
  const router = useRouter();
  const entities = useEntities();
  const userName = useUserNames();
  const [dirty, setDirty] = useState(false);
  const create = useModalRoute("funding-account", { keys: [], dirty });
  const [status, setStatus] = useState("ACTIVE");
  const { data, error, loading, reload } = useApi(() => fundingApi.list({ status }), [status]);
  const columns: Column<FundingAccount>[] = [
    { key: "name", header: "Account", primary: true, cell: (a) => <span className="flex flex-col"><span className="font-medium">{a.name}</span><span className="text-xs text-muted-foreground">{humanize(a.purpose)}</span></span> },
    { key: "entity", header: "Legal entity", cell: (a) => entities.name(a.legal_entity_id) },
    { key: "number", header: "Number", cell: (a) => <FundingNumber account={a} /> },
    { key: "currency", header: "Currency", cell: (a) => a.currency },
    { key: "signatories", header: "Signatories", hideOnMobile: true, cell: (a) => a.signatory_user_ids.map(userName).join(", ") || "—" },
    { key: "provider", header: "Payout", hideOnMobile: true, cell: (a) => (a.sandbox ? <SandboxBadge /> : a.formats.join(", ")) },
  ];
  return (
    <div>
      <WorkspaceHeader
        title="Funding accounts"
        description="Company bank accounts that pay salaries, one or more per legal entity and currency. Signatories release payment batches."
        actions={
          <Button className="min-h-[44px]" onClick={() => create.openModal()}>
            <Plus className="h-4 w-4" aria-hidden /> Add funding account
          </Button>
        }
      />
      <PaymentsNav />
      <Card>
        <FilterBar>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              <option value="">All</option>
            </Select>
          </Field>
        </FilterBar>
        {error && !data ? (
          <ErrorState message={error.message} onRetry={() => void reload()} />
        ) : (
          <DataTable
            caption="Funding accounts"
            columns={columns}
            rows={data?.items}
            loading={loading}
            rowKey={(a) => a.id}
            onRowClick={(a) => router.push(`/payroll/payments/funding-accounts/${a.id}`)}
            cardBelowMd
            empty={
              <EmptyState
                icon={<Building2 />}
                title={status === "ACTIVE" ? "No funding account yet" : "No funding accounts"}
                description="Add the company account salaries are paid from. Batches are created per funding account and currency."
                action={
                  <Button className="min-h-[44px]" onClick={() => create.openModal()}>
                    Add funding account
                  </Button>
                }
              />
            }
          />
        )}
      </Card>
      <CreateFundingAccountModal
        open={create.open}
        onOpenChange={create.onOpenChange}
        onDirtyChange={setDirty}
        onCreated={(row) => {
          setDirty(false);
          void reload();
          router.push(`/payroll/payments/funding-accounts/${row.id}`);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ detail */

function EditFundingForm({ account, onSaved }: { account: FundingAccount; onSaved: () => void }) {
  const [name, setName] = useState(account.name);
  const [purpose, setPurpose] = useState(account.purpose);
  const [signatories, setSignatories] = useState<number[]>(account.signatory_user_ids);
  const [sandbox, setSandbox] = useState(account.sandbox);
  const [error, setError] = useState<unknown>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = "Give the account a name.";
    if (!signatories.length) next.signatories = "Keep at least one signatory.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    setError(null);
    try {
      await fundingApi.update(account.id, { name: name.trim(), purpose, signatory_user_ids: signatories, provider_profile: sandbox ? "SANDBOX" : null }, account.row_version);
      toast.success("Funding account saved");
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-4" noValidate aria-label="Edit funding account">
      <ConflictBanner error={error} onReload={onSaved} />
      <ErrorSummary error={error} fields={{ ...fieldErrors(error), ...errors }} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required error={errors.name}>
          <Input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} className="min-h-[44px]" />
        </Field>
        <Field label="Purpose">
          <Select value={purpose} onChange={(e) => setPurpose(e.target.value)} className="min-h-[44px]">
            {FUNDING_PURPOSES.map((p) => (
              <option key={p} value={p}>
                {humanize(p)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <SignatoryPicker value={signatories} onChange={setSignatories} error={errors.signatories} />
      <label className="flex min-h-[44px] items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4" checked={sandbox} onChange={(e) => setSandbox(e.target.checked)} />
        Allow payouts through the SANDBOX provider (simulated; no money moves)
      </label>
      <div className="flex justify-end">
        <Button type="submit" className="min-h-[44px]" loading={busy}>
          Save changes
        </Button>
      </div>
    </form>
  );
}

export function FundingAccountPage({ id }: { id: string }) {
  const entities = useEntities();
  const userName = useUserNames();
  const { data, error, loading, reload } = useApi(() => fundingApi.get(id), [id]);
  const [deactivate, setDeactivate] = useState(false);
  return (
    <div>
      <Link href="/payroll/payments/funding-accounts" className="mb-3 inline-flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Funding accounts
      </Link>
      <DetailGate loading={loading} error={error} hasData={!!data} onRetry={() => void reload()} what="Funding account" backHref="/payroll/payments/funding-accounts" backLabel="Back to funding accounts">
        {data && (
          <div className="space-y-5">
            <WorkspaceHeader
              title={data.name}
              description={`${entities.name(data.legal_entity_id)} · ${data.currency}`}
              actions={
                data.status === "ACTIVE" ? (
                  <Button variant="secondary" className="min-h-[44px] text-danger" onClick={() => setDeactivate(true)}>
                    Deactivate…
                  </Button>
                ) : undefined
              }
            />
            <PaymentsNav />
            {data.status !== "ACTIVE" && <Notice tone="warning" title="Inactive">{data.status_reason ?? "This account no longer funds new batches."}</Notice>}
            <Card className="p-5">
              <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Meta label="Account holder">{data.holder_name}</Meta>
                <Meta label={data.has_iban ? "IBAN" : "Account number"}>
                  <FundingNumber account={data} />
                </Meta>
                <Meta label="Bank">{data.bank_name ?? "—"}</Meta>
                <Meta label="Routing">
                  <bdi dir="ltr">{routingText(data.routing)}</bdi>
                </Meta>
                <Meta label="Country · currency">
                  {data.country} · {data.currency}
                </Meta>
                <Meta label="File formats">{data.formats.join(", ") || "—"}</Meta>
                <Meta label="Payout provider">{data.sandbox ? <SandboxBadge /> : data.provider_profile ?? "None (bank files only)"}</Meta>
                <Meta label="Signatories">{data.signatory_user_ids.map(userName).join(", ")}</Meta>
                <Meta label="Updated">{fmtDateTime(data.updated_at ?? data.created_at)}</Meta>
              </dl>
            </Card>
            {data.status === "ACTIVE" && (
              <Card className="p-5">
                <h2 className="mb-3 text-base font-semibold">Settings</h2>
                <EditFundingForm key={data.row_version} account={data} onSaved={() => void reload()} />
              </Card>
            )}
            <p className="text-sm text-muted-foreground">
              Statements of this account are imported in{" "}
              <Link href="/payroll/payments/reconciliation" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                Reconciliation <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </p>
            <ReasonModal
              open={deactivate}
              onOpenChange={setDeactivate}
              title="Deactivate funding account"
              consequence="New payment batches can no longer use this account. Batches already created keep it. Accounts are never deleted."
              confirmLabel="Deactivate"
              danger
              onReload={() => void reload()}
              onSubmit={async (reason) => {
                await fundingApi.deactivate(data.id, reason, data.row_version);
                toast.success("Funding account deactivated");
                void reload();
              }}
            />
          </div>
        )}
      </DetailGate>
    </div>
  );
}
