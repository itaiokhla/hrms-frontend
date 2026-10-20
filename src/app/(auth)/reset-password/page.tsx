"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AuthShell, FormAlert } from "@/components/layout/AuthShell";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { api, errorMessage } from "@/lib/api";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const stored = sessionStorage.getItem("hrms_reset_token");
    if (!stored) router.replace("/forgot-password");
    else setToken(stored);
  }, [router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api.post("/auth/reset-password", { reset_token: token, new_password: password });
      sessionStorage.removeItem("hrms_reset_token");
      sessionStorage.removeItem("hrms_reset_email");
      router.replace("/login?reset=1");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Choose a new password" subtitle="Use at least 8 characters with a letter and a number. All other sessions will be signed out.">
      {error && <FormAlert>{error}</FormAlert>}
      <form onSubmit={submit} className="space-y-5">
        <Field label="New password" htmlFor="password">
          <Input id="password" type="password" autoComplete="new-password" required minLength={8} value={password}
            onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Confirm password" htmlFor="confirm">
          <Input id="confirm" type="password" autoComplete="new-password" required value={confirm}
            onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={busy}>Update password</Button>
      </form>
    </AuthShell>
  );
}
