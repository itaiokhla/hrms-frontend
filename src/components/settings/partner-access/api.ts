import { api } from "@/lib/api";
import { withStepUp } from "@/lib/payroll/api";

import type { ActivityItem, Delegation, GrantInput, Overview } from "./types";

const BASE = "/partner-access";

export const partnerAccessApi = {
  overview: () => api.get<Overview>(BASE),
  /** Granting needs a recent step-up: a STEP_UP_REQUIRED answer prompts once and retries. */
  grant: (input: GrantInput) => withStepUp(() => api.post<Delegation>(BASE, input)),
  /** Ending access never needs a step-up. */
  revoke: (id: number, reason: string) => api.post<Delegation>(`${BASE}/${id}/revoke`, { reason }),
  activity: (id: number) => api.get<{ items: ActivityItem[] }>(`${BASE}/${id}/activity`).then((r) => r.items),
};
