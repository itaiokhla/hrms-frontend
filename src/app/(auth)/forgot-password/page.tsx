"use client";

import { ArrowLeft, Mail } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AuthShell, FormAlert } from "@/components/layout/AuthShell";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { api, errorMessage } from "@/lib/api";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post("/auth/forgot-password", { email });
      sessionStorage.setItem("hrms_reset_email", email);
      router.push("/verify-otp");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Reset your password" subtitle="Enter your work email and we'll send you a 6-digit verification code.">
      {error && <FormAlert>{error}</FormAlert>}
      <form onSubmit={submit} className="space-y-5">
        <Field label="Work email" htmlFor="email">
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input id="email" type="email" required className="pl-9" autoComplete="email" value={email}
              onChange={(e) => setEmail(e.target.value)} />
          </div>
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={busy}>Send code</Button>
      </form>
      <Link href="/login" className="mt-8 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to sign in
      </Link>
    </AuthShell>
  );
}
