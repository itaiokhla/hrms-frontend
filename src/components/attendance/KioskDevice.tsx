"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Delete, KeyRound, LogIn, LogOut, MonitorSmartphone, ShieldOff, Timer, WifiOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { BrandMark } from "@/components/brand/BrandLogo";
import { useBrand } from "@/components/brand/BrandProvider";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { MotionSafe } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

import { DIRECTION_DONE, firstName, kioskErrorText, kioskInactive, secondsLeft, type Direction } from "./captureModel";
import { KioskError, kioskApi, rememberDevice, rememberedDevice, type KioskPunchResult } from "./kioskApi";

const RESULT_MS = 3500;
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

/* ===================================================================== frame */

function useDeviceClock(zone: string | null | undefined) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!now) return { time: "", date: "", abbr: "" };
  const opts = zone ? { timeZone: zone } : {};
  try {
    return {
      time: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", ...opts }),
      date: now.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", ...opts }),
      abbr: new Intl.DateTimeFormat([], { timeZoneName: "short", ...opts }).formatToParts(now)
        .find((p) => p.type === "timeZoneName")?.value ?? "",
    };
  } catch {
    return { time: now.toLocaleTimeString(), date: now.toLocaleDateString(), abbr: "" };
  }
}

/** Full-screen kiosk frame: tenant brand chain (logo + primary colour), device name, clock in the device's zone. */
export function KioskFrame({ title, zone, children }: { title: string; zone?: string | null; children: ReactNode }) {
  const { brand } = useBrand();
  const clock = useDeviceClock(zone);
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return (
    <MotionSafe>
      <div className="relative flex min-h-screen flex-col overflow-hidden bg-background">
        <motion.div aria-hidden className="pointer-events-none absolute -left-40 -top-40 h-[28rem] w-[28rem] rounded-full bg-primary/15 blur-3xl"
          animate={{ x: [0, 30, 0], y: [0, 20, 0] }} transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }} />
        <motion.div aria-hidden className="pointer-events-none absolute -bottom-48 -right-32 h-[30rem] w-[30rem] rounded-full bg-accent/15 blur-3xl"
          animate={{ x: [0, -24, 0], y: [0, -16, 0] }} transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }} />
        <header className="relative z-10 flex items-center justify-between gap-4 px-6 py-5 sm:px-10">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark brand={brand} size={44} />
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold" data-testid="kiosk-title">{title}</p>
              <p className="text-xs text-muted-foreground">{brand.display_name}</p>
            </div>
          </div>
          <div className="text-end" data-testid="kiosk-clock">
            <p className="font-display text-3xl font-semibold tabular-nums" dir="ltr">{clock.time}<span className="ms-2 text-sm font-medium text-muted-foreground">{clock.abbr}</span></p>
            <p className="text-xs text-muted-foreground">{clock.date}</p>
          </div>
        </header>
        {!online && (
          <div className="relative z-10 mx-6 flex items-center gap-2 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger sm:mx-10" role="alert" data-testid="kiosk-offline">
            <WifiOff className="h-4 w-4" aria-hidden /> No connection — punches are not recorded. Use another way to record your attendance.
          </div>
        )}
        <main className="relative z-10 flex flex-1 items-center justify-center px-4 pb-10 sm:px-10">{children}</main>
      </div>
    </MotionSafe>
  );
}

/* ===================================================================== pairing */

/**
 * `/kiosk/pair` (09-ui-ux/02 §13, SP-AS-207): device code + the one-time claim code shown to the administrator who
 * registered the kiosk. The server sets the device-token cookie; this page never sees the token.
 */
export function KioskPairForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [claim, setClaim] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paired, setPaired] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await kioskApi.pair(code, claim);
      rememberDevice(result.device);
      setPaired(result.device.name);
      setTimeout(() => router.push("/kiosk/device"), 1200);
    } catch (e) {
      const err = e as KioskError;
      setError(err.code === "CLAIM_CODE_EXPIRED" ? "This claim code has expired. Ask your administrator for a new one."
        : err.status === 429 ? "Too many attempts. Wait a few minutes and try again."
          : err.status === 0 ? "No connection. Check the network and try again."
            : "The device code or claim code is not valid. Check both and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KioskFrame title="Pair this kiosk">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
        className="w-full max-w-md rounded-3xl border border-border bg-surface/90 p-8 shadow-lift backdrop-blur">
        <AnimatePresence mode="wait">
          {paired ? (
            <motion.div key="done" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center gap-3 py-6 text-center" data-testid="kiosk-paired">
              <CheckCircle2 className="h-14 w-14 text-success" aria-hidden />
              <p className="text-xl font-semibold">Paired: {paired}</p>
              <p className="text-sm text-muted-foreground">Opening the kiosk…</p>
            </motion.div>
          ) : (
            <motion.form key="form" onSubmit={submit} className="space-y-5" data-testid="kiosk-pair-form">
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
                  <MonitorSmartphone className="h-6 w-6" aria-hidden />
                </span>
                <div>
                  <h1 className="text-xl font-semibold">Pair this kiosk</h1>
                  <p className="text-sm text-muted-foreground">Your administrator registered this device and got a claim code.</p>
                </div>
              </div>
              <Field label="Device code" hint="As registered, e.g. KIOSK-BLR-L2.">
                <Input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" required
                  className="h-12 font-mono uppercase" data-testid="kiosk-pair-code" />
              </Field>
              <Field label="Claim code" hint="Shown once to the administrator, valid for 24 hours.">
                <Input value={claim} onChange={(e) => setClaim(e.target.value)} autoComplete="off" required
                  className="h-12 font-mono uppercase tracking-widest" data-testid="kiosk-pair-claim" />
              </Field>
              {error && <p role="alert" className="text-sm font-medium text-danger" data-testid="kiosk-pair-error">{error}</p>}
              <Button type="submit" size="lg" className="h-12 w-full" loading={busy} disabled={!code.trim() || claim.trim().length < 4}
                data-testid="kiosk-pair-submit">
                Pair kiosk
              </Button>
            </motion.form>
          )}
        </AnimatePresence>
      </motion.div>
    </KioskFrame>
  );
}

/* ===================================================================== device screen */

type Phase =
  | { kind: "identify" }
  | { kind: "ticket"; ticket: string; expiresAt: string; skewMs: number; name: string; allowed: Direction[] }
  | { kind: "result"; result: KioskPunchResult }
  | { kind: "inactive" };

/**
 * `/kiosk/device` (09-ui-ux/02 §13; 04-attendance/01 §5): identify by PIN (the employee code until device mappings,
 * IG-AS-49) → a 60 s ticket → explicit Check in / Check out (BUG-AS-06) → a 3.5 s result card, then reset. The
 * device token cookie is the principal; an unpaired, suspended or revoked kiosk shows "not active".
 */
export function KioskDevice() {
  const [device, setDevice] = useState<ReturnType<typeof rememberedDevice>>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "identify" });
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const pinRef = useRef<HTMLInputElement>(null);

  useEffect(() => setDevice(rememberedDevice()), []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  const reset = useCallback((note: string | null = null) => {
    setPhase({ kind: "identify" });
    setPin("");
    setMessage(note);
    setTimeout(() => pinRef.current?.focus(), 50);
  }, []);

  const fail = useCallback((e: unknown) => {
    const err = e as KioskError;
    const status = err.status ?? 0;
    if (kioskInactive(err.code, status)) {
      setPhase({ kind: "inactive" });
      return;
    }
    if (err.code === "KIOSK_TICKET_EXPIRED" || status === 410) {
      reset(kioskErrorText(err.code, status));
      return;
    }
    setMessage(kioskErrorText(err.code, status) ?? err.message);
  }, [reset]);

  // The ticket lives 60 s: the screen resets itself when it runs out (no server call needed).
  const left = phase.kind === "ticket" ? secondsLeft(phase.expiresAt, now, phase.skewMs) : 0;
  useEffect(() => {
    if (phase.kind === "ticket" && left <= 0) reset("Took too long — please identify again.");
  }, [phase.kind, left, reset]);
  useEffect(() => {
    if (phase.kind !== "result") return;
    const timer = setTimeout(() => reset(null), RESULT_MS);
    return () => clearTimeout(timer);
  }, [phase, reset]);

  const identify = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!pin.trim() || busy) return;
    setBusy("identify");
    setMessage(null);
    try {
      const { data, serverDate } = await kioskApi.identify("PIN", pin.trim());
      if (!data.recognised) {
        setMessage(data.message || "We couldn't find that PIN.");
        setPin("");
        return;
      }
      setPhase({ kind: "ticket", ticket: data.kiosk_ticket, expiresAt: data.expires_at,
        skewMs: serverDate ? serverDate - Date.now() : 0, name: data.employee.display_name, allowed: data.allowed_actions });
      setPin("");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const punch = async (direction: Direction) => {
    if (phase.kind !== "ticket" || busy) return;
    setBusy(direction);
    setMessage(null);
    try {
      const result = await kioskApi.punch(phase.ticket, direction);
      setPhase({ kind: "result", result });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const title = device ? device.name : "Attendance kiosk";

  if (phase.kind === "inactive") {
    return (
      <KioskFrame title={title} zone={device?.timezone}>
        <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
          className="flex max-w-md flex-col items-center gap-4 text-center" data-testid="kiosk-inactive">
          <span className="flex h-20 w-20 items-center justify-center rounded-3xl bg-danger-soft text-danger"><ShieldOff className="h-10 w-10" aria-hidden /></span>
          <h1 className="text-2xl font-semibold">This kiosk is not active. Ask your administrator.</h1>
          <Link href="/kiosk/pair" className="text-sm font-medium text-primary hover:underline" data-testid="kiosk-go-pair">Pair this kiosk</Link>
        </motion.div>
      </KioskFrame>
    );
  }

  return (
    <KioskFrame title={title} zone={device?.timezone}>
      <div className="w-full max-w-3xl" data-testid="kiosk-device" data-phase={phase.kind}>
        <AnimatePresence mode="wait">
          {phase.kind === "identify" && (
            <motion.form key="identify" onSubmit={identify} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }}
              className="mx-auto max-w-md rounded-3xl border border-border bg-surface/90 p-6 shadow-lift backdrop-blur sm:p-8">
              <p className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.14em] text-primary">
                <KeyRound className="h-4 w-4" aria-hidden /> Identify
              </p>
              <h1 className="mb-5 text-2xl font-semibold">Enter your PIN</h1>
              <label htmlFor="kiosk-pin" className="sr-only">PIN</label>
              <input id="kiosk-pin" ref={pinRef} type="password" autoComplete="off" autoFocus value={pin}
                onChange={(e) => setPin(e.target.value.slice(0, 64))} data-testid="kiosk-pin"
                className="mb-4 h-16 w-full rounded-2xl border border-input bg-surface px-5 text-center font-mono text-3xl tracking-[0.4em] outline-none focus:border-primary focus:ring-4 focus:ring-primary/10" />
              <div className="grid grid-cols-3 gap-3" role="group" aria-label="PIN keypad">
                {KEYS.map((k) => <PadKey key={k} label={k} onPress={() => setPin((p) => (p + k).slice(0, 64))} />)}
                <PadKey label="Delete" icon={<Delete className="h-6 w-6" aria-hidden />} onPress={() => setPin((p) => p.slice(0, -1))} />
                <PadKey label="0" onPress={() => setPin((p) => (p + "0").slice(0, 64))} />
                <button type="submit" disabled={!pin.trim() || !!busy} data-testid="kiosk-pin-ok"
                  className="flex h-16 min-h-[64px] items-center justify-center rounded-2xl bg-primary text-lg font-semibold text-primary-foreground shadow-sm transition active:scale-[0.97] disabled:opacity-50">
                  {busy === "identify" ? "…" : "OK"}
                </button>
              </div>
              <AnimatePresence>
                {message && (
                  <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="alert"
                    className="mt-4 rounded-xl bg-warning-soft px-4 py-3 text-center text-sm font-medium text-warning" data-testid="kiosk-message">
                    {message}
                  </motion.p>
                )}
              </AnimatePresence>
            </motion.form>
          )}

          {phase.kind === "ticket" && (
            <motion.div key="ticket" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }} transition={{ duration: 0.25 }}
              className="mx-auto max-w-2xl rounded-3xl border border-border bg-surface/90 p-6 text-center shadow-lift backdrop-blur sm:p-10">
              <p className="text-3xl font-semibold" data-testid="kiosk-greeting">Hi {firstName(phase.name)}</p>
              <p className="mt-2 flex items-center justify-center gap-2 text-sm text-muted-foreground" data-testid="kiosk-countdown" data-seconds={left}>
                <Timer className="h-4 w-4" aria-hidden /> Choose within {left} s
              </p>
              <div className="mx-auto mt-3 h-1.5 max-w-xs overflow-hidden rounded-full bg-muted" aria-hidden>
                <motion.div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (left / 60) * 100)}%` }} />
              </div>
              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                <DirectionButton direction="IN" allowed={phase.allowed} busy={busy} onPress={punch} />
                <DirectionButton direction="OUT" allowed={phase.allowed} busy={busy} onPress={punch} />
              </div>
              {(phase.allowed.includes("BREAK_START") || phase.allowed.includes("BREAK_END")) && (
                <div className="mt-4 flex justify-center gap-3">
                  {phase.allowed.includes("BREAK_START") && (
                    <Button variant="secondary" size="lg" onClick={() => punch("BREAK_START")} disabled={!!busy} data-testid="kiosk-break-start">Start break</Button>
                  )}
                  {phase.allowed.includes("BREAK_END") && (
                    <Button variant="secondary" size="lg" onClick={() => punch("BREAK_END")} disabled={!!busy} data-testid="kiosk-break-end">End break</Button>
                  )}
                </div>
              )}
              {message && <p role="alert" className="mt-5 text-sm font-medium text-danger" data-testid="kiosk-message">{message}</p>}
              <button type="button" onClick={() => reset(null)} className="mt-6 text-sm text-muted-foreground hover:text-foreground" data-testid="kiosk-not-me">
                Not you? Start again
              </button>
            </motion.div>
          )}

          {phase.kind === "result" && (
            <motion.div key="result" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }} className="mx-auto flex max-w-xl flex-col items-center gap-4 rounded-3xl border border-success/30 bg-surface/95 p-10 text-center shadow-lift"
              data-testid="kiosk-result" data-direction={phase.result.direction} data-shift-date={phase.result.shift_date}
              data-session-id={phase.result.session_id}>
              <motion.span initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 18 }}
                className="flex h-20 w-20 items-center justify-center rounded-full bg-success-soft text-success">
                <CheckCircle2 className="h-11 w-11" aria-hidden />
              </motion.span>
              <p className="text-2xl font-semibold">
                {DIRECTION_DONE[phase.result.direction]} {phase.result.local_time}
              </p>
              <p className="text-muted-foreground">
                {firstName(phase.result.employee_name)} · {phase.result.direction === "IN" ? "Have a good shift" : "See you next time"}
              </p>
              <p className="text-xs text-muted-foreground" data-testid="kiosk-result-shift">Shift date {phase.result.shift_date}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </KioskFrame>
  );
}

function PadKey({ label, icon, onPress }: { label: string; icon?: ReactNode; onPress: () => void }) {
  return (
    <button type="button" onClick={onPress} aria-label={label} data-testid={`kiosk-key-${label}`}
      className="flex h-16 min-h-[64px] items-center justify-center rounded-2xl border border-border bg-surface text-2xl font-semibold shadow-sm transition hover:bg-surface-muted active:scale-[0.96]">
      {icon ?? label}
    </button>
  );
}

function DirectionButton({ direction, allowed, busy, onPress }: {
  direction: "IN" | "OUT";
  allowed: Direction[];
  busy: string | null;
  onPress: (d: Direction) => void;
}) {
  const offered = allowed.includes(direction);
  const Icon = direction === "IN" ? LogIn : LogOut;
  return (
    <button type="button" onClick={() => onPress(direction)} disabled={!!busy}
      data-testid={direction === "IN" ? "kiosk-check-in" : "kiosk-check-out"} data-offered={offered}
      className={cn(
        "flex h-24 min-h-[48px] items-center justify-center gap-3 rounded-3xl text-xl font-semibold shadow-sm transition active:scale-[0.97] disabled:opacity-60",
        offered
          ? direction === "IN" ? "bg-primary text-primary-foreground hover:brightness-110" : "bg-foreground text-background hover:brightness-110"
          : "border border-border bg-surface text-muted-foreground",
      )}>
      <Icon className="h-7 w-7" aria-hidden /> {direction === "IN" ? "Check in" : "Check out"}
    </button>
  );
}
