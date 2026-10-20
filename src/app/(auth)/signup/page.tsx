"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Building2, Check } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { AuthShell, FormAlert } from "@/components/layout/AuthShell";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { Me } from "@/lib/types";
import { useSession } from "@/store/session";

const schema = z
  .object({
    company_name: z.string().min(2, "Enter your company name").max(150),
    full_name: z.string().min(2, "Enter your full name").max(150),
    email: z.string().email("Enter a valid work email"),
    password: z
      .string()
      .min(8, "At least 8 characters")
      .regex(/[A-Za-z]/, "Include a letter")
      .regex(/\d/, "Include a number"),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, { path: ["confirm"], message: "Passwords don't match" });
type FormData = z.infer<typeof schema>;

export default function SignupPage() {
  const router = useRouter();
  const setMe = useSession((s) => s.setMe);
  const [error, setError] = useState<string | null>(null);
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const { register, handleSubmit, watch, formState } = useForm<FormData>({ resolver: zodResolver(schema) });
  const password = watch("password") ?? "";

  useEffect(() => {
    try {
      setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata");
    } catch {
      /* keep default */
    }
  }, []);

  const onSubmit = async ({ confirm: _confirm, ...data }: FormData) => {
    setError(null);
    try {
      const result = await api.post<{ me: Me }>("/auth/signup", { ...data, timezone });
      setMe(result.me);
      router.replace("/dashboard?welcome=1");
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const rules = [
    { ok: password.length >= 8, label: "8+ characters" },
    { ok: /[A-Za-z]/.test(password), label: "A letter" },
    { ok: /\d/.test(password), label: "A number" },
  ];

  return (
    <AuthShell
      title="Create your workspace"
      subtitle="Set up your company in under a minute. You'll be its first administrator and can invite your team next."
    >
      {error && <FormAlert>{error}</FormAlert>}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <Field label="Company name" htmlFor="company" error={formState.errors.company_name?.message}>
          <div className="relative">
            <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input id="company" className="pl-9" placeholder="Acme Pvt. Ltd." autoComplete="organization"
              aria-invalid={!!formState.errors.company_name} {...register("company_name")} />
          </div>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Your name" htmlFor="name" error={formState.errors.full_name?.message}>
            <Input id="name" autoComplete="name" aria-invalid={!!formState.errors.full_name} {...register("full_name")} />
          </Field>
          <Field label="Work email" htmlFor="email" error={formState.errors.email?.message}>
            <Input id="email" type="email" autoComplete="email" aria-invalid={!!formState.errors.email} {...register("email")} />
          </Field>
        </div>
        <Field label="Password" htmlFor="password" error={formState.errors.password?.message}>
          <Input id="password" type="password" autoComplete="new-password" aria-invalid={!!formState.errors.password}
            {...register("password")} />
        </Field>
        <div className="flex flex-wrap gap-2">
          {rules.map((r) => (
            <span key={r.label} className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
              r.ok ? "bg-success-soft text-success" : "bg-muted text-muted-foreground",
            )}>
              <Check className="h-3 w-3" /> {r.label}
            </span>
          ))}
        </div>
        <Field label="Confirm password" htmlFor="confirm" error={formState.errors.confirm?.message}>
          <Input id="confirm" type="password" autoComplete="new-password" aria-invalid={!!formState.errors.confirm}
            {...register("confirm")} />
        </Field>
        <p className="text-xs text-muted-foreground">Timezone: <span className="font-medium text-foreground">{timezone}</span> (you can change it later in settings)</p>
        <Button type="submit" size="lg" className="w-full" loading={formState.isSubmitting}>
          Create workspace <ArrowRight className="h-4 w-4" />
        </Button>
      </form>
      <p className="mt-8 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">Sign in</Link>
      </p>
    </AuthShell>
  );
}
