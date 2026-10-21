"use client";

import { motion } from "framer-motion";
import { AlertCircle, CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { MotionSafe } from "@/components/ui/primitives";
import { toApiError, type ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { getWithEtag, jobUrl, type JobDto } from "@/lib/payroll/api";

import { StatusChip } from "./StatusChip";

export interface UseJobOptions {
  /** Poll interval while the job runs (default 2 s). */
  intervalMs?: number;
  /** Called once when the job reaches a terminal status. */
  onFinished?: (job: JobDto) => void;
  /** Consecutive request failures before polling stops (default 3). */
  maxErrors?: number;
}

/**
 * Poll GET /api/v1/jobs/{id} with ETag / If-None-Match until the job finishes. Polling pauses while
 * the tab is hidden and resumes when it is visible again, so a refreshed or revisited page picks up
 * where the job is (EC-UX-05).
 */
export function useJob(jobId: number | string | null | undefined, { intervalMs = 2000, onFinished, maxErrors = 3 }: UseJobOptions = {}) {
  const [job, setJob] = useState<JobDto | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const etag = useRef<string | null>(null);
  const last = useRef<JobDto | null>(null);
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;

  useEffect(() => {
    setJob(null);
    setError(null);
    etag.current = null;
    last.current = null;
  }, [jobId]);

  useEffect(() => {
    if (jobId === null || jobId === undefined || jobId === "") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let controller: AbortController | null = null;
    let reported = false;

    const schedule = (ms: number) => {
      if (!cancelled) timer = setTimeout(tick, ms);
    };
    const tick = async () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return; // resumes on visibilitychange
      controller = new AbortController();
      try {
        const res = await getWithEtag<JobDto>(jobUrl(jobId), etag.current, { signal: controller.signal });
        if (cancelled) return;
        failures = 0;
        setError(null);
        etag.current = res.etag;
        if (!res.notModified) {
          last.current = res.data;
          setJob(res.data);
        }
        const current = last.current;
        if (current?.finished) {
          if (!reported) {
            reported = true;
            finishedRef.current?.(current);
          }
          return;
        }
        schedule(intervalMs);
      } catch (err) {
        if (cancelled) return;
        const apiError = toApiError(err);
        failures += 1;
        if (failures >= maxErrors || apiError.status === 404 || apiError.status === 403) {
          setError(apiError);
          return;
        }
        schedule(intervalMs * 2 ** failures);
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && !cancelled) {
        if (timer) clearTimeout(timer);
        void tick();
      }
    };
    void tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [jobId, intervalMs, maxErrors, attempt]);

  /** Restart polling after it stopped on errors. */
  const resume = useCallback(() => {
    setError(null);
    setAttempt((a) => a + 1);
  }, []);

  return { job, error, resume, polling: !!jobId && !error && !job?.finished };
}

export interface JobProgressProps {
  jobId: number | string | null | undefined;
  /** What the job does, e.g. "Calculating 350 employees". */
  title: string;
  /** Toast when it succeeds (no amounts), e.g. "Calculation finished — review the results". */
  successMessage?: string;
  /** Toast when it fails. */
  failureMessage?: string;
  /** Re-run the job (offered after a failure); the page decides what that means. */
  onRetry?: () => void;
  onFinished?: (job: JobDto) => void;
  intervalMs?: number;
  className?: string;
}

function errorText(error: JobDto["error"]): string | null {
  if (!error) return null;
  if (typeof error === "string") return error;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : "The job failed.";
}

/**
 * A long-running job (3.8 §8): progress bar, status chip, errors and retry. Completion is
 * announced through the app's persistent aria-live toast region; the bar itself is a labelled
 * progressbar, so screen readers don't hear every percent.
 */
export function JobProgress({ jobId, title, successMessage, failureMessage, onRetry, onFinished, intervalMs, className }: JobProgressProps) {
  const { job, error, resume } = useJob(jobId, {
    intervalMs,
    onFinished: (finished) => {
      if (finished.status === "SUCCEEDED") toast.success(successMessage ?? `${title}: done`);
      else if (finished.status === "CANCELLED") toast(`${title}: cancelled`);
      else toast.error(failureMessage ?? `${title}: failed`);
      onFinished?.(finished);
    },
  });
  if (!jobId) return null;
  const percent = job?.progress.percent ?? null;
  const failed = job && (job.status === "FAILED" || job.status === "DEAD");
  const succeeded = job?.status === "SUCCEEDED";
  const counts = job?.progress.total ? `${job.progress.done} of ${job.progress.total}` : null;

  return (
    <div className={cn("rounded-2xl border border-border bg-surface p-4", className)} aria-busy={!job?.finished}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          {succeeded ? (
            <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
          ) : failed || error ? (
            <AlertCircle className="h-4 w-4 text-danger" aria-hidden />
          ) : (
            <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
          )}
          {title}
        </div>
        {job && <StatusChip vocabulary="job" code={job.status} />}
      </div>
      <div
        role="progressbar"
        aria-label={title}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        aria-valuetext={percent === null ? "Working…" : `${percent}%${counts ? `, ${counts}` : ""}`}
        className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
      >
        <MotionSafe>
          {percent === null && !job?.finished ? (
            <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/60" />
          ) : (
            <motion.div
              className={cn("h-full origin-left rounded-full rtl:origin-right", failed ? "bg-danger" : succeeded ? "bg-success" : "bg-primary")}
              initial={false}
              animate={{ scaleX: (percent ?? 0) / 100 }}
              transition={{ duration: 0.3 }}
            />
          )}
        </MotionSafe>
      </div>
      <p className="mt-2 text-xs text-muted-foreground tabular-nums">
        {counts ?? (percent !== null ? `${percent}%` : job ? "Working…" : "Starting…")}
        {job && !job.finished && " · You can leave this page; the job keeps running."}
      </p>
      {failed && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
          <span>{errorText(job?.error ?? null) ?? "The job failed."}</span>
          {onRetry && (
            <Button size="sm" variant="secondary" className="h-11 sm:h-8" onClick={onRetry}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              Retry
            </Button>
          )}
        </div>
      )}
      {error && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">
          <span>We couldn&apos;t check progress: {error.message}</span>
          <Button size="sm" variant="secondary" className="h-11 sm:h-8" onClick={resume}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}
