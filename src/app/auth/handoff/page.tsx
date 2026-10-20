"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { AuthShell, FormAlert } from "@/components/layout/AuthShell";
import { api, errorMessage } from "@/lib/api";
import type { Me } from "@/lib/types";
import { useSession } from "@/store/session";

/**
 * Lands a sign-in that started on the platform address on this company's own domain.
 * The one-time code travels in the URL fragment (never sent to servers or logs) and is
 * exchanged once, server side, for this host's own session cookies.
 */
export default function HandoffPage() {
  const router = useRouter();
  const setMe = useSession((s) => s.setMe);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const code = new URLSearchParams(window.location.hash.slice(1)).get("code");
    // Remove the code from the address bar and history immediately.
    window.history.replaceState(null, "", "/auth/handoff");
    if (!code) {
      setError("This sign-in link is incomplete. Sign in again.");
      return;
    }
    api
      .post<{ me: Me }>("/auth/handoff", { code })
      .then((result) => {
        setMe(result.me);
        router.replace("/dashboard");
      })
      .catch((e) => setError(errorMessage(e)));
  }, [router, setMe]);

  return (
    <AuthShell title={error ? "Sign-in link expired" : "Signing you in…"} subtitle={error ? undefined : "One moment."}>
      {error ? (
        <>
          <FormAlert>{error}</FormAlert>
          <Link href="/login" className="text-sm font-medium text-primary hover:underline">
            Go to sign in
          </Link>
        </>
      ) : (
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Signing in" />
      )}
    </AuthShell>
  );
}
