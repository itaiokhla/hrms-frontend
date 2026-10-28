"use client";

import { Star, UsersRound } from "lucide-react";
import { useRouter } from "next/navigation";

import { MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/overlay";
import type { Me } from "@/lib/types";

/** The teams of the profile menu: led teams first, then the other memberships (no duplicates). */
export function myTeamsEntries(teams: Me["teams"]): { id: number; name: string; lead: boolean; routing: boolean; primary: boolean }[] {
  if (!teams) return [];
  const led = new Map(teams.leads.map((t) => [t.id, t]));
  const entries = teams.leads.map((t) => ({
    id: t.id, name: t.name, lead: true, routing: t.routing,
    primary: teams.member_of.some((m) => m.id === t.id && m.primary),
  }));
  for (const m of teams.member_of) {
    if (!led.has(m.id)) entries.push({ id: m.id, name: m.name, lead: false, routing: false, primary: m.primary });
  }
  return entries;
}

/** "My teams" in the account menu (X 01 §15.3), from `me.teams`; nothing when the user belongs to no team. */
export function MyTeamsMenu({ me }: { me: Me | null | undefined }) {
  const router = useRouter();
  const entries = myTeamsEntries(me?.teams).slice(0, 6);
  if (!entries.length) return null;
  return (
    <>
      <MenuSeparator />
      <MenuLabel>My teams</MenuLabel>
      {entries.map((t) => (
        <MenuItem key={t.id} icon={t.routing ? <Star /> : <UsersRound />} onSelect={() => router.push(`/teams/${t.id}`)}>
          <span className="flex min-w-0 flex-1 items-center justify-between gap-3" data-testid={`my-team-${t.id}`}>
            <span className="truncate">{t.name}</span>
            <span className="text-xs text-muted-foreground">{t.lead ? "Lead" : t.primary ? "Primary" : ""}</span>
          </span>
        </MenuItem>
      ))}
    </>
  );
}
