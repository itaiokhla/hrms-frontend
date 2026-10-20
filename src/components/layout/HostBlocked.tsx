import { Globe2, ShieldAlert } from "lucide-react";

import type { Brand } from "@/lib/brand";

/**
 * Neutral screens in the platform brand for hosts that must not serve a workspace:
 * an address that is not configured (never another tenant's workspace) or a suspended
 * tenant. No data is requested from these screens.
 */
export function HostBlocked({ kind, brand }: { kind: "unknown" | "suspended"; brand: Brand }) {
  const unknown = kind === "unknown";
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-3xl border border-border bg-surface p-8 text-center shadow-lift">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-warning-soft text-warning">
          {unknown ? <Globe2 className="h-6 w-6" /> : <ShieldAlert className="h-6 w-6" />}
        </div>
        <h1 className="text-xl font-semibold">{unknown ? "This address is not configured" : "Workspace unavailable"}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {unknown
            ? "No workspace is connected to this address. Check the link you were given, or contact your administrator."
            : "This workspace is currently suspended. Contact your administrator."}
        </p>
        <p className="mt-6 text-xs text-muted-foreground">{brand.product_name}</p>
      </div>
    </main>
  );
}
