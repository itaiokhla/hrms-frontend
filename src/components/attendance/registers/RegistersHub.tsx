"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Download, FileSpreadsheet, FileText, Fingerprint, ScrollText } from "lucide-react";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";

import { useBranches } from "@/components/rosters/RosterPeriods";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, PageHeader } from "@/components/ui/layout";
import { Badge, Card, Skeleton } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useApi } from "@/lib/hooks";
import { insightsApi, type Register, type RegisterForm } from "@/lib/attendanceInsights";

const FORM_INFO: Record<RegisterForm, { title: string; description: string; icon: typeof ScrollText }> = {
  FORM_25: { title: "Form 25 · Muster roll", description: "Employee × date mark codes with totals (Factories Act / OSH FORM XIV layout).", icon: ScrollText },
  FORM_D: { title: "Form D · Register of attendance", description: "Hours worked per date, days worked and overtime hours (wages stay in the payroll register).", icon: FileText },
};

const MARK_TONE: Record<string, string> = {
  P: "bg-success/15 text-success", LT: "bg-warning/20 text-warning", A: "bg-danger/15 text-danger", NM: "bg-danger/10 text-danger",
  MP: "bg-warning/15 text-warning", OD: "bg-primary/15 text-primary", RW: "bg-primary/15 text-primary", L: "bg-info/15 text-info",
  H: "bg-muted text-muted-foreground", W: "bg-muted text-muted-foreground", "…": "bg-muted/60 text-muted-foreground",
};

function monthRange(offset = 0) {
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

/** `/reports/attendance`: statutory registers with a live preview and sealed CSV / XLSX / PDF exports (G-20). */
export function RegistersHub() {
  const catalogue = useApi(() => insightsApi.registers(), []);
  const entities = useApi(() => api.get<{ id: number; legal_name: string; code: string }[]>("/legal-entities").catch(() => []), []);
  const branches = useBranches();
  const [form, setForm] = useState<RegisterForm>("FORM_25");
  const [range, setRange] = useState(monthRange(0));
  const [kind, setKind] = useState<"LE" | "BR">("LE");
  const [establishment, setEstablishment] = useState("");
  const [register, setRegister] = useState<Register | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const options = kind === "LE" ? (entities.data ?? []).map((e) => ({ id: e.id, label: `${e.legal_name} (${e.code})` })) : branches.items;
  const chosen = establishment || (options[0] ? String(options[0].id) : "");
  const params = useMemo(() => ({ from: range.from, to: range.to,
    legal_entity_id: kind === "LE" && chosen ? Number(chosen) : null, branch_id: kind === "BR" && chosen ? Number(chosen) : null }),
  [range, kind, chosen]);

  if (catalogue.data && catalogue.data.items.length === 0) {
    return <EmptyState icon={<ScrollText />} title="Registers are not available to you" description="Generating statutory registers needs the Export attendance registers permission." />;
  }

  const generate = async () => {
    setBusy("preview");
    setError(null);
    try {
      setRegister(await insightsApi.register(form, params));
    } catch (e) {
      setError((e as Error).message);
      setRegister(null);
    } finally {
      setBusy(null);
    }
  };
  const download = async (format: "CSV" | "XLSX" | "PDF") => {
    setBusy(format);
    try {
      await insightsApi.download(form, params, format);
      toast.success(`${format} downloaded and recorded in the audit log`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div data-testid="registers-hub">
      <PageHeader eyebrow="Reports" title="Attendance registers"
        description="Statutory muster rolls and attendance registers rendered from the evaluated attendance. Every export is sealed with a SHA-256 fingerprint and audited." />
      <div className="grid gap-3 sm:grid-cols-2">
        {(Object.keys(FORM_INFO) as RegisterForm[]).map((key) => {
          const info = FORM_INFO[key];
          const Icon = info.icon;
          return (
            <motion.button key={key} type="button" whileHover={{ y: -2 }} onClick={() => { setForm(key); setRegister(null); }}
              aria-pressed={form === key} data-testid={`register-${key}`}
              className={cn("flex items-start gap-3 rounded-2xl border p-4 text-left transition-colors",
                form === key ? "border-primary bg-primary-soft/60" : "border-border bg-surface hover:border-primary/50")}>
              <Icon className="mt-0.5 h-5 w-5 text-primary" aria-hidden />
              <span><span className="block font-semibold">{info.title}</span><span className="text-sm text-muted-foreground">{info.description}</span></span>
            </motion.button>
          );
        })}
      </div>
      <Card className="mt-4 grid gap-3 p-4 md:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
        <Field label="From"><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} data-testid="register-from" /></Field>
        <Field label="To"><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} data-testid="register-to" /></Field>
        <Field label="Establishment">
          <Select value={kind} onChange={(e) => { setKind(e.target.value as "LE" | "BR"); setEstablishment(""); }} data-testid="register-kind">
            <option value="LE">Legal entity</option><option value="BR">Branch</option>
          </Select>
        </Field>
        <Field label={kind === "LE" ? "Legal entity" : "Branch"}>
          <Select value={chosen} onChange={(e) => setEstablishment(e.target.value)} data-testid="register-establishment">
            {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </Select>
        </Field>
        <div className="flex items-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setRange(monthRange(-1))}>Last month</Button>
          <Button onClick={generate} loading={busy === "preview"} disabled={!chosen} data-testid="register-generate">Generate</Button>
        </div>
      </Card>
      {error && <div className="mt-4"><ErrorState message={error} /></div>}
      {busy === "preview" && !register && <Skeleton className="mt-4 h-64" />}
      <AnimatePresence>
        {register && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4 space-y-3" data-testid="register-preview">
            <Card className="flex flex-wrap items-center gap-3 p-4">
              <div className="me-auto">
                <p className="font-semibold">{register.title} · {register.establishment.name}</p>
                <p className="text-xs text-muted-foreground">{register.from} to {register.to} · {register.total} people
                  {register.pending_days ? ` · ${register.pending_days} days pending` : ""}</p>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="register-seal">
                  <Fingerprint className="h-3.5 w-3.5" aria-hidden /> Seal {register.seal.sha256.slice(0, 16)}… · {register.seal.generated_by}
                </p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => download("CSV")} loading={busy === "CSV"} data-testid="register-download-csv"><Download className="h-3.5 w-3.5" aria-hidden /> CSV</Button>
              <Button variant="secondary" size="sm" onClick={() => download("XLSX")} loading={busy === "XLSX"} data-testid="register-download-xlsx"><FileSpreadsheet className="h-3.5 w-3.5" aria-hidden /> Excel</Button>
              <Button size="sm" onClick={() => download("PDF")} loading={busy === "PDF"} data-testid="register-download-pdf"><FileText className="h-3.5 w-3.5" aria-hidden /> PDF</Button>
            </Card>
            {register.rows.length === 0 ? (
              <EmptyState icon={<ScrollText />} title="No one placed in this establishment for the period" description="Pick another establishment or period." />
            ) : (
              <Card className="overflow-x-auto">
                <table className="w-full text-xs" data-testid="register-grid">
                  <thead className="sticky top-0 bg-surface">
                    <tr className="border-b border-border">
                      <th className="sticky start-0 bg-surface px-3 py-2 text-start">Employee</th>
                      {register.dates.map((d) => (
                        <th key={d} className="px-1 py-2 text-center font-medium tabular-nums">{d.slice(8)}<span className="block text-[10px] text-muted-foreground">
                          {new Date(`${d}T00:00:00Z`).toLocaleDateString("en", { weekday: "narrow", timeZone: "UTC" })}</span></th>
                      ))}
                      <th className="px-2 py-2">{register.form === "FORM_25" ? "Present" : "Days"}</th>
                      <th className="px-2 py-2">{register.form === "FORM_25" ? "Absent" : "Hours"}</th>
                      <th className="px-2 py-2">OT h</th>
                    </tr>
                  </thead>
                  <tbody>
                    {register.rows.map((r) => (
                      <tr key={r.employee_id} className="border-b border-border/60" data-testid={`register-row-${r.employee_id}`}>
                        <td className="sticky start-0 bg-surface px-3 py-1.5"><span className="font-medium">{r.name}</span>
                          <span className="block text-[10px] text-muted-foreground">{r.employee_code}{r.designation ? ` · ${r.designation}` : ""}</span></td>
                        {register.dates.map((d, i) => {
                          const code = r.marks[i];
                          const hours = register.form === "FORM_D" ? r.hours?.[i] : null;
                          return (
                            <td key={d} className="px-0.5 py-1 text-center">
                              <span className={cn("inline-block min-w-[1.75rem] rounded-md px-1 py-0.5 font-medium tabular-nums", MARK_TONE[code.split("/").pop() ?? ""] ?? "")}
                                data-testid={`register-cell-${r.employee_id}-${d}`}>{hours ?? code}</span>
                            </td>
                          );
                        })}
                        <td className="px-2 text-center tabular-nums">{register.form === "FORM_25" ? r.totals.present_units : r.totals.days_worked}</td>
                        <td className="px-2 text-center tabular-nums">{register.form === "FORM_25" ? r.totals.absent_units : r.totals.hours_worked}</td>
                        <td className="px-2 text-center tabular-nums">{r.totals.ot_hours}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="border-t border-border p-3 text-[11px] text-muted-foreground">{register.legend}</p>
              </Card>
            )}
            {register.corrections.length > 0 && (
              <Card className="p-4 text-xs">
                <p className="mb-2 font-semibold">Corrections after the first final version</p>
                <ul className="space-y-1">{register.corrections.map((c) => (
                  <li key={`${c.date}-${c.employee}-${c.version}`}><Badge tone="warning">v{c.version}</Badge> {c.date} · {c.employee} · {c.day_result ?? ""} · {c.trigger ?? ""}</li>
                ))}</ul>
              </Card>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
