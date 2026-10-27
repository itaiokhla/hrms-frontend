"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { X } from "lucide-react";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";

import { Button } from "./button";

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}

const SIZES = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };

export function Modal({ open, onOpenChange, title, description, children, footer, size = "md" }: ModalProps) {
  return (
    // reducedMotion="user": with prefers-reduced-motion, transforms are skipped and only opacity fades.
    <MotionConfig reducedMotion="user">
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount>
              <motion.div
                className={cn(
                  "fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-3xl border border-border bg-surface shadow-lift",
                  SIZES[size],
                )}
                initial={{ opacity: 0, scale: 0.95, y: "-46%", x: "-50%" }}
                animate={{ opacity: 1, scale: 1, y: "-50%", x: "-50%" }}
                exit={{ opacity: 0, scale: 0.96, y: "-48%", x: "-50%" }}
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
              >
                <div className="flex items-start justify-between gap-4 px-6 pb-2 pt-5">
                  <div>
                    <Dialog.Title className="font-display text-lg font-semibold">{title}</Dialog.Title>
                    {description ? (
                      <Dialog.Description className="mt-1 text-sm text-muted-foreground">{description}</Dialog.Description>
                    ) : (
                      <Dialog.Description className="sr-only">{typeof title === "string" ? title : "Dialog"}</Dialog.Description>
                    )}
                  </div>
                  <Dialog.Close asChild>
                    <Button variant="ghost" size="icon" aria-label="Close">
                      <X className="h-4 w-4" />
                    </Button>
                  </Dialog.Close>
                </div>
                <div className="scrollbar-thin flex-1 overflow-y-auto px-6 py-4">{children}</div>
                {footer && <div className="flex justify-end gap-2 border-t border-border bg-surface-muted/50 px-6 py-4">{footer}</div>}
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
    </MotionConfig>
  );
}

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = "max-w-xl",
  modal = true,
}: Omit<ModalProps, "size"> & {
  width?: string;
  /** false: non-modal side panel (X 04 §3.6, list hosts ≥ lg): no scrim, focus not trapped, aria-modal="false". */
  modal?: boolean;
}) {
  // Slides in from the inline end: the right in LTR, the left in RTL.
  const rtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";
  const offscreen = rtl ? "-100%" : "100%";
  return (
    <MotionConfig reducedMotion="user">
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            {modal && (
              <Dialog.Overlay asChild forceMount>
                <motion.div
                  className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                />
              </Dialog.Overlay>
            )}
            <Dialog.Content asChild forceMount
              onInteractOutside={modal ? undefined : (e) => e.preventDefault()}>
              <motion.aside
                className={cn("fixed inset-y-0 end-0 z-50 flex w-full flex-col border-s border-border bg-surface shadow-lift", width)}
                initial={{ x: offscreen }}
                animate={{ x: 0 }}
                exit={{ x: offscreen }}
                transition={{ type: "spring", stiffness: 320, damping: 34 }}
              >
                <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
                  <div className="min-w-0">
                    <Dialog.Title className="truncate font-display text-lg font-semibold">{title}</Dialog.Title>
                    {description ? (
                      <Dialog.Description className="mt-1 text-sm text-muted-foreground">{description}</Dialog.Description>
                    ) : (
                      <Dialog.Description className="sr-only">Details</Dialog.Description>
                    )}
                  </div>
                  <Dialog.Close asChild>
                    <Button variant="ghost" size="icon" aria-label="Close">
                      <X className="h-4 w-4" />
                    </Button>
                  </Dialog.Close>
                </div>
                <div className="scrollbar-thin flex-1 overflow-y-auto px-6 py-5">{children}</div>
                {footer && <div className="flex justify-end gap-2 border-t border-border px-6 py-4">{footer}</div>}
              </motion.aside>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
    </MotionConfig>
  );
}

/* ---------------------------------------------------------------- Confirm */
interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  /** The dismiss button names what is kept (e.g. "Keep editing"); default "Cancel". */
  cancelLabel?: string;
  tone?: "danger" | "primary";
}

const ConfirmContext = createContext<(options: ConfirmOptions) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ ...options, resolve })),
    [],
  );
  const close = (value: boolean) => {
    state?.resolve(value);
    setState(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={!!state}
        onOpenChange={(open) => !open && close(false)}
        title={state?.title ?? ""}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => close(false)}>
              {state?.cancelLabel ?? "Cancel"}
            </Button>
            <Button variant={state?.tone === "danger" ? "danger" : "primary"} onClick={() => close(true)}>
              {state?.confirmLabel ?? "Confirm"}
            </Button>
          </>
        }
      >
        <div className="text-sm text-muted-foreground">{state?.message}</div>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext);

/* ---------------------------------------------------------------- Menu */
export function DropdownMenu({
  trigger,
  children,
  align = "end",
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "end";
}) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>{trigger}</Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align={align}
          sideOffset={8}
          className="z-50 min-w-[200px] overflow-hidden rounded-2xl border border-border bg-surface p-1.5 shadow-lift"
        >
          {children}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

export function MenuItem({
  children,
  onSelect,
  tone,
  icon,
}: {
  children: ReactNode;
  onSelect?: () => void;
  tone?: "danger";
  icon?: ReactNode;
}) {
  return (
    <Menu.Item
      onSelect={onSelect}
      className={cn(
        "flex cursor-pointer select-none items-center gap-2.5 rounded-xl px-3 py-2 text-sm outline-none transition-colors data-[highlighted]:bg-muted",
        tone === "danger" && "text-danger data-[highlighted]:bg-danger-soft",
      )}
    >
      {icon && <span className="text-muted-foreground [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
      {children}
    </Menu.Item>
  );
}

export const MenuSeparator = () => <Menu.Separator className="my-1 h-px bg-border" />;
export const MenuLabel = ({ children }: { children: ReactNode }) => (
  <Menu.Label className="px-3 py-1.5 text-xs font-medium text-muted-foreground">{children}</Menu.Label>
);
