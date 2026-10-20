"use client";

import { Briefcase } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { FormAlert } from "@/components/layout/AuthShell";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { api, errorMessage } from "@/lib/api";

export default function PartnerLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ mfa_required: boolean }>("/partner/auth/login", { email, password, mfa_code: code || null });
      if (r.mfa_required) setNeedsCode(true);
      else router.replace("/partner");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-sidebar p-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-3xl border border-white/10 bg-surface p-8 shadow-lift">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-glow"><Briefcase className="h-6 w-6" /></span>
        <h1 className="mt-5 text-xl font-semibold">Partner console</h1>
        <p className="mt-1 text-sm text-muted-foreground">For reseller administrators. Company users sign in at their company&apos;s address.</p>
        <div className="mt-6 space-y-4">
          {error && <FormAlert>{error}</FormAlert>}
          <Field label="Email"><Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          <Field label="Password"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
          {needsCode && <Field label="Authenticator code"><Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} autoFocus /></Field>}
          <Button type="submit" className="w-full" size="lg" loading={busy}>Sign in</Button>
        </div>
      </form>
    </div>
  );
}
