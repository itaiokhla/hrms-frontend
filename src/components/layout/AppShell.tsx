"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Bell,
  CheckCheck,
  ChevronDown,
  CreditCard,
  LogOut,
  Menu as MenuIcon,
  Moon,
  Search,
  ShieldAlert,
  Sun,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";

import { useAgentStatus } from "@/components/agent/useAgentStatus";
import { LocationTracker } from "@/components/attendance/LocationTracker";
import { BrandMark, BrandWordmark } from "@/components/brand/BrandLogo";
import { useBrand } from "@/components/brand/BrandProvider";
import { TrackingIndicator } from "@/components/attendance/TrackingIndicator";
import { MyTeamsMenu } from "@/components/teams/MyTeamsMenu";
import { Button } from "@/components/ui/button";
import { DropdownMenu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/overlay";
import { Avatar } from "@/components/ui/primitives";
import { api, onSessionEvent } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fromNow } from "@/lib/format";
import type { Brand } from "@/lib/brand";
import { navFor, navHrefs, type NavItem } from "@/lib/navigation";
import type { AppNotification } from "@/lib/types";
import { useSession } from "@/store/session";

type Blocker = null | "subscription-inactive" | "suspended";

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { status, me, load, expire } = useSession();
  const { brand, applyBrand } = useBrand();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [blocker, setBlocker] = useState<Blocker>(null);

  // A published brand change reaches open tabs without a reload (01 §8 "live update").
  useEffect(() => {
    if (!me?.brand_version || brand.preview || me.brand_version === brand.version) return;
    api
      .get<Brand>("/branding/current")
      .then((next) => next.version !== brand.version && applyBrand(next))
      .catch(() => undefined);
  }, [me?.brand_version, brand.version, brand.preview, applyBrand]);

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
      {/* One location controller per tab, alive across every in-app route change. */}
      <LocationTracker />
      <aside className="sticky top-0 hidden h-screen w-[272px] shrink-0 border-e border-sidebar-foreground/10 lg:block">
        <Sidebar />
      </aside>
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              className="fixed inset-y-0 start-0 z-50 h-[100dvh] w-[300px] max-w-[85vw] shadow-2xl lg:hidden"
              initial={{ x: brand.dir === "rtl" ? "100%" : "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: brand.dir === "rtl" ? "100%" : "-100%" }}
              transition={{ type: "spring", stiffness: 340, damping: 34 }}
            >
              <Sidebar onClose={() => setMobileOpen(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setMobileOpen(true)} />
        {brand.preview && (
          <div className="flex flex-wrap items-center justify-center gap-3 bg-warning-soft px-4 py-2 text-sm text-warning" role="status" data-testid="preview-banner">
            You are previewing unpublished branding. Nobody else sees it.
            <a href="?brand_preview=off" className="font-semibold underline">Exit preview</a>
          </div>
        )}
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {/* Enter animation only: an exit (AnimatePresence) keeps the outgoing wrapper alive, and the App Router
              already renders the new page inside it, so every page mounted twice (double fetches, typed input lost). */}
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            {children}
          </motion.div>
        </main>
      </div>
    </div>
  );
}

function Sidebar({ onClose }: { onClose?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const me = useSession((s) => s.me)!;
  const { logout } = useSession();
  const { resolvedTheme, setTheme } = useTheme();
  const { brand } = useBrand();
  // The assistant entry appears only when GET /agent/status says it is enabled for this user.
  const assistant = useAgentStatus(me.user.id)?.enabled === true;
  const groups = useMemo(() => navFor(me, { assistant }), [me, assistant]);
  const surface = brand.sidebar_style === "LIGHT" ? "light" : "dark";
  const [search, setSearch] = useState("");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // The most specific matching entry is active (/settings/branding is not also "Company settings").
  const activeHref = navHrefs(groups)
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((x, y) => y.length - x.length)[0];
  const hasLogo = !!(brand.logos.light || brand.logos.dark);

  // Search filter across all top-level items and sub-items
  const searchQuery = search.trim().toLowerCase();
  const searchResults = useMemo(() => {
    if (!searchQuery) return null;
    const results: { label: string; href: string; parentLabel?: string; icon: LucideIcon }[] = [];
    for (const group of groups) {
      for (const item of group.items) {
        if (item.label.toLowerCase().includes(searchQuery)) {
          results.push({ label: item.label, href: item.href, parentLabel: group.label, icon: item.icon });
        }
        if (item.children) {
          for (const child of item.children) {
            if (child.label.toLowerCase().includes(searchQuery)) {
              results.push({ label: child.label, href: child.href, parentLabel: `${item.label}`, icon: child.icon });
            }
          }
        }
      }
    }
    return results;
  }, [groups, searchQuery]);

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Brand Header */}
      <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-4 sm:px-5 sm:pt-5 border-b border-sidebar-foreground/10">
        <Link
          href="/dashboard"
          onClick={onClose}
          className={cn("flex min-w-0 gap-3 group transition-opacity hover:opacity-90", hasLogo ? "flex-col items-start gap-1.5" : "items-center")}
          title={brand.display_name}
          data-testid="sidebar-brand"
        >
          {hasLogo ? <BrandWordmark brand={brand} surface={surface} height={36} /> : <BrandMark brand={brand} />}
          <div className="min-w-0">
            {!hasLogo && (
              <p className="truncate font-display text-[15px] font-semibold tracking-tight text-sidebar-foreground">
                {brand.display_name || me.company.name}
              </p>
            )}
            <p className="truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-sidebar-muted" data-testid="sidebar-product">
              {brand.product_name}
            </p>
          </div>
        </Link>
        {onClose && (
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-sidebar-muted transition-colors hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground lg:hidden"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Quick Search */}
      <div className="px-3 pt-3 pb-1">
        <div className="relative flex items-center">
          <Search className="pointer-events-none absolute start-3 h-3.5 w-3.5 text-sidebar-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Quick search tabs..."
            className="w-full rounded-xl border border-sidebar-foreground/10 bg-sidebar-foreground/5 py-1.5 ps-8 pe-7 text-xs text-sidebar-foreground placeholder:text-sidebar-muted/60 transition-all focus:border-sidebar-active focus:bg-sidebar-foreground/10 focus:outline-none"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute end-2 flex h-5 w-5 items-center justify-center rounded-full text-sidebar-muted hover:text-sidebar-foreground"
              aria-label="Clear search"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Navigation or Search Results */}
      {searchResults ? (
        <div className="scrollbar-thin flex-1 overflow-y-auto px-3 py-2 space-y-1" aria-label="Search results">
          <p className="px-2 text-[10px] font-bold uppercase tracking-wider text-sidebar-muted">
            Matching Tabs ({searchResults.length})
          </p>
          {searchResults.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-sidebar-muted">
              No matching features found for &ldquo;{search}&rdquo;
            </div>
          ) : (
            <ul className="space-y-0.5">
              {searchResults.map((res) => (
                <li key={res.href}>
                  <Link
                    href={res.href}
                    onClick={() => {
                      setSearch("");
                      onClose?.();
                    }}
                    className={cn(
                      "group flex items-center justify-between rounded-xl px-3 py-2 text-xs font-medium transition-colors",
                      pathname === res.href
                        ? "bg-sidebar-active text-sidebar-active-foreground font-semibold"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground",
                    )}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <res.icon className="h-4 w-4 shrink-0 transition-transform group-hover:scale-110" />
                      <span className="truncate">{res.label}</span>
                    </div>
                    {res.parentLabel && (
                      <span className="ms-2 shrink-0 rounded-md bg-sidebar-foreground/10 px-1.5 py-0.5 text-[10px] text-sidebar-muted">
                        {res.parentLabel}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <nav className="scrollbar-thin flex-1 space-y-5 overflow-y-auto px-3 py-2" aria-label="Main">
          {groups.map((group) => (
            <div key={group.label} className="space-y-1">
              <div className="flex items-center justify-between px-3 pt-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-sidebar-muted/80">{group.label}</p>
              </div>
              <ul className="space-y-0.5">
                {group.items.map((item) =>
                  item.children?.length ? (
                    <NavGroupEntry key={item.href} item={item} activeHref={activeHref} onClose={onClose} />
                  ) : (
                    <li key={item.href}>
                      <NavLink item={item} active={item.href === activeHref} onClick={onClose} />
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}
        </nav>
      )}

      {/* User profile & actions footer */}
      <div className="m-3 mt-auto rounded-2xl border border-sidebar-foreground/10 bg-sidebar-foreground/5 p-2.5 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-2">
          <Link
            href="/account"
            onClick={onClose}
            className="flex items-center gap-2.5 min-w-0 group hover:opacity-90 transition-opacity"
            title="My account"
          >
            <div className="relative shrink-0">
              <Avatar
                name={me.user.full_name}
                src={me.employee?.has_photo ? `/api/v1/employees/${me.employee.id}/photo` : null}
                size={34}
              />
              <span className="absolute bottom-0 end-0 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-sidebar" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold leading-tight text-sidebar-foreground group-hover:underline">
                {me.user.full_name}
              </p>
              <p className="truncate text-[10px] text-sidebar-muted">
                {me.roles.map((r) => r.name).join(", ") || "User"}
              </p>
            </div>
          </Link>
          <div className="flex items-center gap-0.5 shrink-0">
            {mounted && (
              <button
                type="button"
                onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
                className="rounded-lg p-1.5 text-sidebar-muted transition-colors hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground"
                aria-label="Toggle theme"
                title={resolvedTheme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              >
                {resolvedTheme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
              </button>
            )}
            <button
              type="button"
              onClick={async () => {
                await logout();
                router.replace("/login");
              }}
              className="rounded-lg p-1.5 text-sidebar-muted transition-colors hover:bg-danger-soft hover:text-danger"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NavLink({
  item,
  active,
  nested = false,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  nested?: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={cn(
        "group relative flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-3 text-sm font-medium transition-colors",
        nested ? "py-1.5 text-[13px]" : "py-2.5",
        active
          ? "font-semibold text-sidebar-active-foreground"
          : "text-sidebar-foreground/80 hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground",
      )}
    >
      {active && (
        <motion.span
          layoutId="nav-active"
          className={cn(
            "absolute inset-0 rounded-xl bg-sidebar-active shadow-glow",
            nested && "bg-sidebar-active/95",
          )}
          transition={{ type: "spring", stiffness: 420, damping: 36 }}
        />
      )}
      <item.icon
        className={cn(
          "relative shrink-0 transition-transform group-hover:scale-110",
          nested ? "h-3.5 w-3.5 opacity-80 group-hover:opacity-100" : "h-[18px] w-[18px]",
          active && "text-sidebar-active-foreground",
        )}
      />
      <span className="relative truncate">{item.label}</span>
    </Link>
  );
}

/**
 * A menu entry with sub-pages: the entry itself stays a link, and a separate disclosure button
 * shows or hides its sub-pages (open by default while one of them is the current page).
 */
function NavGroupEntry({
  item,
  activeHref,
  onClose,
}: {
  item: NavItem;
  activeHref: string | undefined;
  onClose?: () => void;
}) {
  const children = item.children ?? [];
  const childActive = children.some((c) => c.href === activeHref);
  const [open, setOpen] = useState(childActive);
  const reduceMotion = useReducedMotion();
  const listId = useId();

  useEffect(() => {
    if (childActive) setOpen(true);
  }, [childActive]);

  // While collapsed, the entry carries the highlight for its active sub-page; while open, the sub-page does.
  const selfActive = open ? item.href === activeHref && !childActive : item.href === activeHref || childActive;

  return (
    <li className="relative">
      <div className="flex items-center gap-1">
        <NavLink
          item={item}
          active={selfActive}
          onClick={() => {
            setOpen((prev) => !prev);
            onClose?.();
          }}
        />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
          aria-expanded={open}
          aria-controls={listId}
          aria-label={`${open ? "Hide" : "Show"} ${item.label} pages`}
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sidebar-muted transition-colors hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground",
            open && "text-sidebar-foreground",
          )}
        >
          <span className="me-1 rounded-md bg-sidebar-foreground/10 px-1 py-0.5 text-[10px] font-semibold text-sidebar-muted">
            {children.length}
          </span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 transition-transform duration-200 motion-reduce:transition-none",
              open && "rotate-180 text-sidebar-active",
            )}
            aria-hidden
          />
        </button>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            id={listId}
            key="children"
            aria-label={item.label}
            className="ms-4 space-y-0.5 overflow-hidden border-s border-sidebar-foreground/15 ps-2 pt-1 pb-1"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            {children.map((child) => (
              <li key={child.href} className="pt-0.5 first:pt-0">
                <NavLink item={child} nested active={child.href === activeHref} onClick={onClose} />
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </li>
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
      <TrackingIndicator />
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
        <MyTeamsMenu me={me} />
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
