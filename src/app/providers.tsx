"use client";

import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { Toaster } from "react-hot-toast";

import { ConfirmProvider } from "@/components/ui/overlay";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <ConfirmProvider>{children}</ConfirmProvider>
      {/* Modal dialogs aria-hide the rest of the page but keep [aria-live] elements, so this
          persistent live region keeps toasts announced while a dialog or drawer is open. */}
      <div aria-live="polite">
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 3500,
            className: "!rounded-2xl !border !border-border !bg-surface !text-foreground !shadow-lift !text-sm",
          }}
        />
      </div>
    </ThemeProvider>
  );
}
