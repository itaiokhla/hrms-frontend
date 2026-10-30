import { redirect } from "next/navigation";

/** `/settings/leave` opens the setup checklist (the first entry of the Leave group). */
export default function LeaveSettingsIndex() {
  redirect("/settings/leave/setup");
}
