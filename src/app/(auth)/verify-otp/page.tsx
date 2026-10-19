"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { AuthShell, FormAlert } from "@/components/layout/AuthShell";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";

export default function VerifyOtpPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    const stored = sessionStorage.getItem("hrms_reset_email");
    if (!stored) router.replace("/forgot-password");
    else setEmail(stored);
  }, [router]);

  const setDigit = (index: number, value: string) => {
    const clean = value.replace(/\D/g, "");
    if (clean.length > 1) {
      const next = clean.slice(0, 6).split("");
      setDigits([...next, ...Array(6 - next.length).fill("")]);
      inputs.current[Math.min(next.length, 5)]?.focus();
      return;
    }
    const next = [...digits];
    next[index] = clean;
    setDigits(next);
    if (clean && index < 5) inputs.current[index + 1]?.focus();
  };

  const verify = async () => {
    setError(null);
    setBusy(true);
    try {
      const { reset_token } = await api.post<{ reset_token: string }>("/auth/verify-otp", { email, otp: digits.join("") });
      sessionStorage.setItem("hrms_reset_token", reset_token);
      router.push("/reset-password");
    } catch (e) {
      setError(errorMessage(e));
      setDigits(Array(6).fill(""));
      inputs.current[0]?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Check your email" subtitle={<>If an account exists for <b>{email}</b>, we sent a 6-digit code. It expires in 10 minutes.</>}>
      {error && <FormAlert>{error}</FormAlert>}
      <div className="flex justify-between gap-2" onPaste={(e) => setDigit(0, e.clipboardData.getData("text"))}>
        {digits.map((d, i) => (
          <motion.input
            key={i}
            ref={(el) => {
              inputs.current[i] = el;
            }}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            value={d}
            inputMode="numeric"
            maxLength={6}
            aria-label={`Digit ${i + 1}`}
            onChange={(e) => setDigit(i, e.target.value)}
            onKeyDown={(e) => e.key === "Backspace" && !digits[i] && i > 0 && inputs.current[i - 1]?.focus()}
            className="h-14 w-full rounded-xl border border-input bg-surface text-center text-xl font-semibold shadow-sm focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10"
          />
        ))}
      </div>
      <Button size="lg" className="mt-6 w-full" loading={busy} disabled={digits.join("").length !== 6} onClick={verify}>
        Verify code
      </Button>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Didn't get it? <Link href="/forgot-password" className="font-medium text-primary hover:underline">Send a new code</Link>
      </p>
    </AuthShell>
  );
}
