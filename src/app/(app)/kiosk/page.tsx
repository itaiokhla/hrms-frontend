"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Hourglass, Pause, Play, ScanFace, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { RequireAccess } from "@/components/access/Can";
import { CameraCapture, type CameraHandle } from "@/components/shared/CameraCapture";
import { Button } from "@/components/ui/button";
import { LiveClock, PageHeader } from "@/components/ui/layout";
import { Card } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api";
import { companyWide } from "@/lib/access";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";

interface ScanResult {
  success: boolean;
  action: "check_in" | "check_out" | "completed" | "wait" | "unknown";
  employee_name?: string;
  message: string;
}

export default function KioskPage() {
  return (
    <RequireAccess check={(me) => companyWide(me, P.ATTENDANCE_KIOSK)}>
      <Kiosk />
    </RequireAccess>
  );
}

function Kiosk() {
  const cam = useRef<CameraHandle>(null);
  const [running, setRunning] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data: engine } = useApi(() => api.get<{ engine_available: boolean }>("/face/status"), []);

  const scan = useCallback(async () => {
    const blob = await cam.current?.capture();
    if (!blob) return;
    setScanning(true);
    try {
      const form = new FormData();
      form.append("file", blob, "frame.jpg");
      const r = await api.post<ScanResult>("/attendance/kiosk/scan", form);
      setResult(r);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void scan(), 4000);
    return () => clearInterval(timer);
  }, [running, scan]);

  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => setResult(null), 3500);
    return () => clearTimeout(timer);
  }, [result]);

  const tone = result?.action === "check_in" || result?.action === "check_out" ? "success" : result?.action === "wait" ? "warning" : "danger";

  return (
    <div>
      <PageHeader
        title="Face kiosk"
        description="A shared check-in station. Faces are matched only against employees of your company."
        actions={<LiveClock className="rounded-xl border border-border bg-surface px-3 py-2 font-display text-sm font-semibold shadow-sm" />}
      />
      {engine && !engine.engine_available && (
        <Card className="mb-6 border-warning/30 bg-warning-soft/60 p-4 text-sm">
          Face recognition isn't installed on the server, so scans will be rejected. Install the optional <code>face_recognition</code> package on the backend to enable it.
        </Card>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card className="relative overflow-hidden p-3">
          <CameraCapture ref={cam} scanning={running || scanning} className="aspect-video" />
          <AnimatePresence>
            {result && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className={`absolute inset-x-6 bottom-6 flex items-center gap-3 rounded-2xl p-4 text-white shadow-lift backdrop-blur ${
                  tone === "success" ? "bg-success/90" : tone === "warning" ? "bg-warning/90" : "bg-danger/90"
                }`}
              >
                {tone === "success" ? <CheckCircle2 className="h-7 w-7" /> : tone === "warning" ? <Hourglass className="h-7 w-7" /> : <XCircle className="h-7 w-7" />}
                <div>
                  <p className="font-display text-lg font-semibold">{result.employee_name ?? "Not recognised"}</p>
                  <p className="text-sm opacity-90">{result.message}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
        <Card className="flex flex-col gap-4 p-6">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary"><ScanFace className="h-7 w-7" /></div>
          <div>
            <p className="font-semibold">{running ? "Scanning automatically" : "Kiosk paused"}</p>
            <p className="mt-1 text-sm text-muted-foreground">First scan checks in, the next one checks out. Scans run every few seconds while active.</p>
          </div>
          <Button size="lg" variant={running ? "secondary" : "primary"} onClick={() => setRunning((r) => !r)}>
            {running ? <><Pause className="h-4 w-4" /> Pause</> : <><Play className="h-4 w-4" /> Start kiosk</>}
          </Button>
          <Button variant="ghost" loading={scanning} onClick={scan}>Scan once</Button>
          {error && <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        </Card>
      </div>
    </div>
  );
}
