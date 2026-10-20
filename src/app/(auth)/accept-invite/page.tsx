"use client";

import { Building2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { AuthShell, FormAlert } from "@/components/layout/AuthShell";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api";
import type { Me } from "@/lib/types";
import { useSession } from "@/store/session";

interface Invitation {
  email: string;
  full_name: string;
  company_name: string;
}

function AcceptInvite() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const setMe = useSession((s) => s.setMe);
  const [invite, setInvite] = useState<Invitation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("This invitation link is incomplete.");
      return;
    }
    api.get<Invitation>(`/auth/invitations/${encodeURIComponent(token)}`).then(setInvite).catch((e) => setError(errorMessage(e)));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ me: Me }>("/auth/invitations/accept", { token, password });
      setMe(result.me);
      router.replace("/dashboard?welcome=1");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Join your team" subtitle="Set a password to activate your account.">
      {error && <FormAlert>{error}</FormAlert>}
      {!invite && !error && <Skeleton className="h-40 w-full" />}
      {invite && (
        <>
          <div className="mb-6 flex items-center gap-3 rounded-2xl border border-border bg-surface p-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
              <Building2 className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold">{invite.company_name}</p>
              <p className="text-xs text-muted-foreground">{invite.full_name} · {invite.email}</p>
            </div>
          </div>
          <form onSubmit={submit} className="space-y-5">
            <Field label="Password" htmlFor="password" hint="At least 8 characters with a letter and a number.">
              <Input id="password" type="password" autoComplete="new-password" required value={password}
                onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Field label="Confirm password" htmlFor="confirm">
              <Input id="confirm" type="password" autoComplete="new-password" required value={confirm}
                onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            <Button type="submit" size="lg" className="w-full" loading={busy}>Activate account</Button>
          </form>
        </>
      )}
    </AuthShell>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense>
      <AcceptInvite />
    </Suspense>
  );
}
