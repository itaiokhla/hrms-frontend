"use client";

import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { Toaster } from "react-hot-toast";

import { BrandProvider } from "@/components/brand/BrandProvider";
import { ServiceWorkerRegistrar } from "@/components/layout/ServiceWorker";
import { ConfirmProvider } from "@/components/ui/overlay";
import type { Brand } from "@/lib/brand";

export function Providers({ children, brand }: { children: ReactNode; brand: Brand }) {
  return (
    <BrandProvider brand={brand}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <ConfirmProvider>{children}</ConfirmProvider>
        <ServiceWorkerRegistrar />
        {/* Modal dialogs aria-hide the rest of the page but keep [aria-live] elements, so this
            persistent live region keeps toasts announced while a dialog or drawer is open. */}
        <div aria-live="polite">
          <Toaster
            position={brand.dir === "rtl" ? "top-left" : "top-right"}
            toastOptions={{
              duration: 3500,
              className: "!rounded-2xl !border !border-border !bg-surface !text-foreground !shadow-lift !text-sm",
            }}
          />
        </div>
      </ThemeProvider>
    </BrandProvider>
  );
}
