"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Eye, EyeOff, KeyRound, Lock, Mail } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { useBrand } from "@/components/brand/BrandProvider";
import { AuthShell, FormAlert } from "@/components/layout/AuthShell";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { api, errorMessage } from "@/lib/api";
import type { Me } from "@/lib/types";
import { safeNext } from "@/lib/safe-redirect";
import { useSession } from "@/store/session";

const schema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});
type FormData = z.infer<typeof schema>;

type LoginResponse =
  | { mfa_required: true; mfa_token: string }
  | { mfa_required: false; me: Me; handoff_url?: undefined }
  | { mfa_required: false; handoff_url: string; me?: undefined };

/** The tenant enforces its own domain: continue there with a one-time code (never a session token). */
function followHandoff(url: string): boolean {
  try {
    const target = new URL(url);
    if (!["http:", "https:"].includes(target.protocol) || !target.pathname.startsWith("/auth/handoff")) return false;
    window.location.assign(target.toString());
    return true;
  } catch {
    return false;
  }
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { brand } = useBrand();
  const setMe = useSession((s) => s.setMe);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const { register, handleSubmit, formState } = useForm<FormData>({ resolver: zodResolver(schema) });

  const finish = (me: Me) => {
    setMe(me);
    router.replace(safeNext(params.get("next"), window.location.origin));
  };

  const onSubmit = async (data: FormData) => {
    setError(null);
    setBusy(true);
    try {
      const result = await api.post<LoginResponse>("/auth/login", data);
      if (result.mfa_required) setMfaToken(result.mfa_token);
      else if (result.handoff_url) followHandoff(result.handoff_url);
      else if (result.me) finish(result.me);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await api.post<{ me?: Me; handoff_url?: string }>("/auth/login/mfa", { mfa_token: mfaToken, code });
      if (result.handoff_url) followHandoff(result.handoff_url);
      else if (result.me) finish(result.me);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title={mfaToken ? "Two-step verification" : "Welcome back"}
      subtitle={
        mfaToken
          ? "Enter the 6-digit code from your authenticator app."
          : brand.login_scope === "TENANT"
            ? `Sign in to ${brand.display_name} with your work email.`
            : "Sign in with your work email. We'll take you to your company's workspace."
      }
    >
      {params.get("expired") && !error && <FormAlert tone="info">Your session ended. Please sign in again.</FormAlert>}
      {params.get("reset") && !error && <FormAlert tone="success">Password updated. Sign in with your new password.</FormAlert>}
      {error && <FormAlert>{error}</FormAlert>}
      <AnimatePresence mode="wait">
        {!mfaToken ? (
          <motion.form
            key="password"
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            onSubmit={handleSubmit(onSubmit)}
            className="space-y-5"
            noValidate
          >
            <Field label="Work email" htmlFor="email" error={formState.errors.email?.message}>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="email" type="email" autoComplete="username" className="pl-9" placeholder="you@company.com"
                  aria-invalid={!!formState.errors.email} {...register("email")} />
              </div>
            </Field>
            <Field label="Password" htmlFor="password" error={formState.errors.password?.message}>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="password" type={showPassword ? "text" : "password"} autoComplete="current-password"
                  className="px-9" aria-invalid={!!formState.errors.password} {...register("password")} />
                <button type="button" onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}>
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>
            <div className="flex justify-end">
              <Link href="/forgot-password" className="text-sm font-medium text-primary hover:underline">
                Forgot password?
              </Link>
            </div>
            <Button type="submit" size="lg" className="w-full" loading={busy}>
              Sign in <ArrowRight className="h-4 w-4" />
            </Button>
          </motion.form>
        ) : (
          <motion.div key="mfa" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} className="space-y-5">
            <Field label="Verification code" htmlFor="code">
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus
                  className="pl-9 text-lg tracking-[0.4em]" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
              </div>
            </Field>
            <Button size="lg" className="w-full" loading={busy} disabled={code.length !== 6} onClick={verify}>
              Verify and continue
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => { setMfaToken(null); setCode(""); }}>
              Use a different account
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
      {brand.login_scope === "ANY" && (
        <p className="mt-8 text-center text-sm text-muted-foreground">
          New to {brand.product_name}?{" "}
          <Link href="/signup" className="font-medium text-primary hover:underline">
            Create your company workspace
          </Link>
        </p>
      )}
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
