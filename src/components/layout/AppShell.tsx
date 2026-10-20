"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Bell,
  Building2,
  CheckCheck,
  CreditCard,
  LogOut,
  Menu as MenuIcon,
  Moon,
  ShieldAlert,
  Sun,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/overlay";
import { Avatar } from "@/components/ui/primitives";
import { api, onSessionEvent } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fromNow } from "@/lib/format";
import { navFor } from "@/lib/navigation";
import type { AppNotification } from "@/lib/types";
import { useSession } from "@/store/session";

type Blocker = null | "subscription-inactive" | "suspended";

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { status, me, load, expire } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [blocker, setBlocker] = useState<Blocker>(null);

  useEffect(() => {
    if (status === "idle") void load();
  }, [status, load]);

  // The only place the shell redirects to sign-in, so an "expired" notice is never overwritten.
  useEffect(() => {
    if (status === "anonymous" || status === "expired") {
      const reason = status === "expired" ? "expired=1&" : "";
      router.replace(`/login?${reason}next=${encodeURIComponent(pathname)}`);
    }
  }, [status, router, pathname]);

  useEffect(
    () =>
      onSessionEvent((event) => {
        if (event === "session-expired") expire();
        else setBlocker(event);
      }),
    [expire],
  );

  // Pick up permission changes made by an administrator while this tab is open.
  useEffect(() => {
    const refresh = () => document.visibilityState === "visible" && void load({ silent: true });
    document.addEventListener("visibilitychange", refresh);
    const timer = setInterval(refresh, 5 * 60 * 1000);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      clearInterval(timer);
    };
  }, [load]);

  useEffect(() => setMobileOpen(false), [pathname]);

  if (status !== "authenticated" || !me) return <ShellSkeleton />;
  if (!me.company.subscription.active || blocker === "subscription-inactive") {
    return <BlockedScreen kind="subscription" companyName={me.company.name} />;
  }
  if (blocker === "suspended") return <BlockedScreen kind="suspended" companyName={me.company.name} />;

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-[264px] shrink-0 lg:block">
        <Sidebar />
      </aside>
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-black/40 lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              className="fixed inset-y-0 left-0 z-50 w-[280px] lg:hidden"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 340, damping: 34 }}
            >
              <Sidebar onClose={() => setMobileOpen(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setMobileOpen(true)} />
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={pathname}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

function Sidebar({ onClose }: { onClose?: () => void }) {
  const pathname = usePathname();
  const me = useSession((s) => s.me)!;
  const groups = useMemo(() => navFor(me), [me]);
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center justify-between gap-3 px-5 pb-4 pt-5">
        <Link href="/dashboard" className="flex min-w-0 items-center gap-3">
          <CompanyMark />
          <div className="min-w-0">
            <p className="truncate font-display text-[15px] font-semibold">{me.company.name}</p>
            <p className="text-[11px] uppercase tracking-[0.18em] text-sidebar-muted">HRMS</p>
          </div>
        </Link>
        {onClose && (
          <button onClick={onClose} className="rounded-lg p-1.5 text-sidebar-muted hover:bg-white/10" aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>
      <nav className="scrollbar-thin flex-1 space-y-6 overflow-y-auto px-3 py-2" aria-label="Main">
        {groups.map((group) => (
          <div key={group.label}>
            <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-sidebar-muted">{group.label}</p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                        active ? "text-white" : "text-sidebar-foreground/75 hover:bg-white/5 hover:text-white",
                      )}
                    >
                      {active && (
                        <motion.span
                          layoutId="nav-active"
                          className="absolute inset-0 rounded-xl bg-gradient-to-r from-primary/90 to-primary/60 shadow-glow"
                          transition={{ type: "spring", stiffness: 420, damping: 36 }}
                        />
                      )}
                      <item.icon className="relative h-[18px] w-[18px] shrink-0 transition-transform group-hover:scale-110" />
                      <span className="relative">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="m-3 rounded-2xl bg-white/5 p-3">
        <div className="flex items-center gap-3">
          <Avatar name={me.user.full_name} src={me.employee?.has_photo ? `/api/v1/employees/${me.employee.id}/photo` : null} size={36} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{me.user.full_name}</p>
            <p className="truncate text-xs text-sidebar-muted">{me.roles.map((r) => r.name).join(", ") || "No role"}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function CompanyMark() {
  const [failed, setFailed] = useState(false);
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-primary to-accent shadow-glow">
      {failed ? (
        <Building2 className="h-5 w-5 text-white" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/api/v1/settings/logo" alt="" className="h-full w-full bg-white object-contain" onError={() => setFailed(true)} />
      )}
    </span>
  );
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const router = useRouter();
  const { me, logout } = useSession();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const signOut = async () => {
    await logout();
    router.replace("/login");
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border/70 bg-background/80 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenu} aria-label="Open menu">
        <MenuIcon className="h-5 w-5" />
      </Button>
      <div className="min-w-0 flex-1">
        <p className="hidden text-sm text-muted-foreground sm:block">
          Welcome back, <span className="font-medium text-foreground">{me?.user.full_name.split(" ")[0]}</span>
        </p>
      </div>
      {mounted && (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Toggle theme"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          <motion.span key={resolvedTheme} initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }}>
            {resolvedTheme === "dark" ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
          </motion.span>
        </Button>
      )}
      <Notifications />
      <DropdownMenu
        trigger={
          <button className="rounded-full transition-transform hover:scale-105" aria-label="Account menu">
            <Avatar name={me?.user.full_name} src={me?.employee?.has_photo ? `/api/v1/employees/${me.employee.id}/photo` : null} size={36} />
          </button>
        }
      >
        <MenuLabel>{me?.user.email}</MenuLabel>
        <MenuItem icon={<UserRound />} onSelect={() => router.push("/account")}>
          My account
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<LogOut />} tone="danger" onSelect={signOut}>
          Sign out
        </MenuItem>
      </DropdownMenu>
    </header>
  );
}

function Notifications() {
  const router = useRouter();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<{ count: number; notifications: AppNotification[] }>("/notifications");
      setItems(data.notifications);
      setCount(data.count);
    } catch {
      /* non-critical */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => document.visibilityState === "visible" && void refresh(), 30000);
    return () => clearInterval(timer);
  }, [refresh]);

  const openItem = async (n: AppNotification) => {
    setOpen(false);
    if (!n.is_read) await api.put(`/notifications/${n.id}/read`).catch(() => undefined);
    void refresh();
    // Server-validated relative paths only.
    if (n.action_url?.startsWith("/") && !n.action_url.startsWith("//")) router.push(n.action_url);
  };

  return (
    <div className="relative">
      <Button variant="ghost" size="icon" aria-label={`Notifications (${count} unread)`} onClick={() => setOpen((o) => !o)}>
        <Bell className="h-[18px] w-[18px]" />
        <AnimatePresence>
          {count > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white"
            >
              {count > 99 ? "99+" : count}
            </motion.span>
          )}
        </AnimatePresence>
      </Button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.97 }}
              transition={{ duration: 0.18 }}
              className="absolute right-0 z-50 mt-2 w-[min(92vw,380px)] overflow-hidden rounded-2xl border border-border bg-surface shadow-lift"
            >
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <p className="text-sm font-semibold">Notifications</p>
                {count > 0 && (
                  <button
                    className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    onClick={async () => {
                      await api.put("/notifications/read-all");
                      void refresh();
                    }}
                  >
                    <CheckCheck className="h-3.5 w-3.5" /> Mark all read
                  </button>
                )}
              </div>
              <div className="scrollbar-thin max-h-[420px] overflow-y-auto">
                {items.length === 0 ? (
                  <p className="px-4 py-10 text-center text-sm text-muted-foreground">You're all caught up.</p>
                ) : (
                  items.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => openItem(n)}
                      className={cn(
                        "block w-full border-b border-border/60 px-4 py-3 text-left transition-colors last:border-0 hover:bg-surface-muted",
                        !n.is_read && "bg-primary-soft/40",
                      )}
                    >
                      <div className="flex items-start gap-2">
                        {!n.is_read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{n.title}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{n.message}</p>
                          <p className="mt-1 text-[11px] text-muted-foreground/80">{fromNow(n.created_at)}</p>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function ShellSkeleton() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center gap-4"
      >
        <span className="h-12 w-12 animate-pulse-ring rounded-2xl bg-gradient-to-br from-primary to-accent" />
        <p className="text-sm text-muted-foreground">Loading your workspace…</p>
      </motion.div>
    </div>
  );
}

function BlockedScreen({ kind, companyName }: { kind: "subscription" | "suspended"; companyName: string }) {
  const { logout } = useSession();
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md rounded-3xl border border-border bg-surface p-8 text-center shadow-lift"
      >
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-warning-soft text-warning">
          {kind === "subscription" ? <CreditCard className="h-6 w-6" /> : <ShieldAlert className="h-6 w-6" />}
        </div>
        <h1 className="text-xl font-semibold">
          {kind === "subscription" ? "Subscription inactive" : "Workspace suspended"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {kind === "subscription"
            ? `${companyName}'s subscription is not active, so HR data is temporarily unavailable. Your administrator can restore access.`
            : `${companyName}'s workspace has been suspended. Contact your administrator.`}
        </p>
        <Button
          className="mt-6"
          variant="secondary"
          onClick={async () => {
            await logout();
            router.replace("/login");
          }}
        >
          Sign out
        </Button>
      </motion.div>
    </div>
  );
}
