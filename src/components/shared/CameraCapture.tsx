"use client";

import { motion } from "framer-motion";
import { Camera, CameraOff } from "lucide-react";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import Webcam from "react-webcam";

import { cn } from "@/lib/cn";

export interface CameraHandle {
  capture: () => Promise<Blob | null>;
}

/** Webcam preview with an animated scan frame; capture() returns a JPEG blob. */
export const CameraCapture = forwardRef<CameraHandle, { className?: string; scanning?: boolean }>(
  ({ className, scanning }, ref) => {
    const webcam = useRef<Webcam>(null);
    const [error, setError] = useState<string | null>(null);
    const [ready, setReady] = useState(false);

    useImperativeHandle(ref, () => ({
      capture: async () => {
        const shot = webcam.current?.getScreenshot();
        if (!shot) return null;
        const response = await fetch(shot);
        return response.blob();
      },
    }));

    return (
      <div className={cn("relative aspect-[4/3] overflow-hidden rounded-3xl bg-sidebar", className)}>
        {error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sidebar-foreground">
            <CameraOff className="h-8 w-8 text-sidebar-muted" />
            <p className="text-sm">{error}</p>
          </div>
        ) : (
          <>
            <Webcam
              ref={webcam}
              audio={false}
              mirrored
              screenshotFormat="image/jpeg"
              screenshotQuality={0.9}
              videoConstraints={{ facingMode: "user", width: 640, height: 480 }}
              onUserMedia={() => setReady(true)}
              onUserMediaError={() => setError("Camera access was blocked. Allow camera access in your browser to continue.")}
              className="h-full w-full object-cover"
            />
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center text-sidebar-muted">
                <Camera className="h-8 w-8 animate-pulse" />
              </div>
            )}
            <div className="pointer-events-none absolute inset-[12%] rounded-[40%] border-2 border-white/60 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]" />
            {scanning && (
              <motion.div
                className="pointer-events-none absolute inset-x-[12%] h-0.5 bg-gradient-to-r from-transparent via-accent to-transparent shadow-[0_0_20px_hsl(var(--accent))]"
                initial={{ top: "14%" }}
                animate={{ top: ["14%", "84%", "14%"] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
              />
            )}
          </>
        )}
      </div>
    );
  },
);
CameraCapture.displayName = "CameraCapture";
