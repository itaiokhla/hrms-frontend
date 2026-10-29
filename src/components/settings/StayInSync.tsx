"use client";

import { BellRing, CalendarClock, Copy, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Badge, Card, Skeleton } from "@/components/ui/primitives";
import { toApiError } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { disablePush, enablePush, integrationsApi, pushSupported } from "@/lib/integrations";

/** Browser notifications (Web Push through the service worker) and the personal calendar feed of the published
 * schedule (G-24). */
export function StayInSync({ calendar = true }: { calendar?: boolean }) {
  return (
    <div className={`grid gap-3 ${calendar ? "md:grid-cols-2" : ""}`} data-testid="stay-in-sync">
      <PushCard />
      {calendar && <CalendarFeedCard />}
    </div>
  );
}

function PushCard() {
  const status = useApi(() => integrationsApi.push(), []);
  const [busy, setBusy] = useState(false);
  const [supported, setSupported] = useState(true);
  const [permission, setPermission] = useState<string>("default");
  useEffect(() => {
    setSupported(pushSupported());
    if (typeof Notification !== "undefined") setPermission(Notification.permission);
  }, []);
  const on = (status.data?.subscriptions ?? 0) > 0;
  const toggle = async () => {
    setBusy(true);
    try {
      if (on) await disablePush();
      else await enablePush(status.data?.vapid_public_key ?? "");
      toast.success(on ? "Browser notifications are off" : "Browser notifications are on");
      await status.reload();
    } catch (e) {
      toast.error(e instanceof Error && !("status" in e) ? e.message : toApiError(e).message);
    } finally {
      setBusy(false);
      if (typeof Notification !== "undefined") setPermission(Notification.permission);
    }
  };
  return (
    <Card className="space-y-3 p-4" data-testid="push-card">
      <p className="flex items-center gap-2 font-medium"><BellRing className="h-4 w-4 text-primary" /> Browser notifications
        {status.data && <Badge tone={on ? "success" : "neutral"} dot><span data-testid="push-state">{on ? "On" : "Off"}</span></Badge>}</p>
      <p className="text-sm text-muted-foreground">Get approvals, schedule changes and reminders even when HRMS is not open. Only a wake-up
        signal goes through the browser's push service; the text is fetched over your own session.</p>
      {!status.data ? <Skeleton className="h-9 w-40" /> : !supported ? (
        <p className="text-sm text-warning">This browser does not support push notifications.</p>
      ) : !status.data.vapid_public_key ? (
        <p className="text-sm text-warning">Push is not configured on this server.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" data-testid="push-toggle" loading={busy} variant={on ? "secondary" : "primary"}
            disabled={permission === "denied" && !on} onClick={() => void toggle()}>{on ? "Turn off" : "Turn on"}</Button>
          {on && <Button size="sm" variant="ghost" data-testid="push-test"
            onClick={() => void integrationsApi.testPush().then((r) => toast.success(r.sent ? "Test notification sent" : "Sent to no browser")).catch((e) => toast.error(toApiError(e).message))}>
            Send a test</Button>}
          {permission === "denied" && <p className="text-xs text-warning">Notifications are blocked for this site in your browser settings.</p>}
        </div>
      )}
    </Card>
  );
}

function CalendarFeedCard() {
  const feed = useApi(() => integrationsApi.feed(), []);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<{ path?: string }>, done: string) => {
    setBusy(true);
    try {
      const result = await fn();
      setUrl(result.path ? `${window.location.origin}${result.path}` : null);
      toast.success(done);
      await feed.reload();
    } catch (e) {
      toast.error(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="space-y-3 p-4" data-testid="calendar-feed-card">
      <p className="flex items-center gap-2 font-medium"><CalendarClock className="h-4 w-4 text-primary" /> Calendar subscription
        {feed.data && <Badge tone={feed.data.active ? "success" : "neutral"} dot><span data-testid="feed-state">{feed.data.active ? "Active" : "Off"}</span></Badge>}</p>
      <p className="text-sm text-muted-foreground">Subscribe from Google Calendar, Outlook or your phone to see your published shifts. The link
        is personal; anyone with it can read your schedule, so create a new one if it leaks.</p>
      {url && (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 p-2">
          <code className="min-w-0 flex-1 truncate text-xs" data-testid="feed-url">{url}</code>
          <Button size="icon" variant="ghost" aria-label="Copy link" onClick={() => void navigator.clipboard?.writeText(url).then(() => toast.success("Link copied"))}>
            <Copy className="h-4 w-4" /></Button>
        </div>
      )}
      {feed.data?.last_used_at && <p className="text-xs text-muted-foreground">Last read by a calendar {fmtDateTime(feed.data.last_used_at)}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" data-testid="feed-create" loading={busy} onClick={() => void act(integrationsApi.rotateFeed, feed.data?.active ? "New link created; the old one stopped working" : "Calendar link created")}>
          <RefreshCw className="h-4 w-4" /> {feed.data?.active ? "New link" : "Create link"}</Button>
        {feed.data?.active && <Button size="sm" variant="danger-ghost" data-testid="feed-revoke" onClick={() => void act(integrationsApi.revokeFeed, "Calendar link turned off")}>
          <Trash2 className="h-4 w-4" /> Turn off</Button>}
      </div>
    </Card>
  );
}
