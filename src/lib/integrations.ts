/** Channels (Slack, Teams, signed webhooks, WhatsApp slot), browser push and the calendar feed (G-24;
 * backend app/routes/integrations.py). */
import { http } from "./api";
import { payrollApi } from "./payroll/api";

export type ChannelKind = "SLACK" | "TEAMS" | "WEBHOOK" | "WHATSAPP";
export interface Channel {
  id: number; kind: ChannelKind; name: string; url_hint: string | null; has_secret: boolean; events: string[];
  active: boolean; last_success_at: string | null; last_error: string | null; row_version: number; provider_ready: boolean;
}
export interface Delivery {
  id: number; event_type: string; status: "QUEUED" | "SENT" | "FAILED" | "SKIPPED"; attempts: number;
  last_error: string | null; title: string | null; created_at: string | null; sent_at: string | null;
}
export interface PushStatus { subscriptions: number; vapid_public_key: string | null }
export interface FeedStatus { active: boolean; last_used_at: string | null; path?: string }

export const CHANNEL_KIND_LABEL: Record<ChannelKind, string> = {
  SLACK: "Slack", TEAMS: "Microsoft Teams", WEBHOOK: "Signed webhook", WHATSAPP: "WhatsApp",
};

export const integrationsApi = {
  channels: () =>
    payrollApi.get<{ items: Channel[]; event_types: { code: string; label: string }[]; kinds: ChannelKind[] }>(
      "/integrations/channels"),
  create: (body: { kind: ChannelKind; name: string; url?: string | null; events: string[] }) =>
    payrollApi.post<Channel>("/integrations/channels", body),
  update: (id: number, body: { name?: string; url?: string; events?: string[]; active?: boolean; rotate_secret?: boolean;
    row_version?: number }) => payrollApi.patch<Channel>(`/integrations/channels/${id}`, body),
  remove: (id: number) => payrollApi.delete<void>(`/integrations/channels/${id}`),
  test: (id: number) => payrollApi.post<{ status: string; error: string | null }>(`/integrations/channels/${id}/test`, {}),
  deliveries: (id: number) => payrollApi.get<{ items: Delivery[] }>(`/integrations/channels/${id}/deliveries`),
  secret: (id: number) =>
    payrollApi.post<{ secret: string; header: string; algorithm: string }>(`/integrations/channels/${id}/secret`, {}),

  push: () => payrollApi.get<PushStatus>("/me/push"),
  subscribe: (subscription: PushSubscriptionJSON) => payrollApi.post<PushStatus>("/me/push", subscription),
  unsubscribe: async (endpoint?: string) =>
    (await http.delete<PushStatus>("/me/push", { data: endpoint ? { endpoint } : undefined })).data,
  testPush: () => payrollApi.post<{ sent: number; failed: number }>("/me/push/test", {}),

  feed: () => payrollApi.get<FeedStatus>("/me/calendar-feed"),
  rotateFeed: () => payrollApi.post<FeedStatus>("/me/calendar-feed", {}),
  revokeFeed: () => payrollApi.delete<FeedStatus>("/me/calendar-feed"),
};

/* ------------------------------------------------------------------ browser push helpers */

function keyBytes(base64: string): Uint8Array {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** Ask for permission, subscribe this browser with the server's VAPID key and register the subscription. */
export async function enablePush(vapidKey: string): Promise<PushStatus> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications are blocked for this site in the browser settings.");
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? await registration.pushManager.subscribe({
    userVisibleOnly: true, applicationServerKey: keyBytes(vapidKey) as BufferSource,
  });
  return integrationsApi.subscribe(subscription.toJSON());
}

export async function disablePush(): Promise<PushStatus> {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  const endpoint = subscription?.endpoint;
  await subscription?.unsubscribe();
  return integrationsApi.unsubscribe(endpoint);
}
