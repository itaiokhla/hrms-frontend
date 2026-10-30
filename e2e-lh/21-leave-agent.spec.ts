/**
 * AI leave assistant (docs/leave_agent.md) in Chrome against the real model configured on the stack
 * (AI_MODEL=groq:..., key from the backend .env — never printed). Needs the stack started with AGENT_ENABLED=true on the
 * LangGraph environment; skips (with a note) when /agent/status says the assistant is unavailable.
 *   1. Rohan asks for his balances → the answer comes from his ledger (read tool), not invented.
 *   2. Rohan asks to apply casual leave → a confirmation card appears; nothing is written until he confirms;
 *      after Confirm the request exists as a normal leave request.
 *   3. Rohan asks to approve a colleague's leave → refused (RBAC is enforced by the tools, not the prompt).
 * Evidence: test-evidence/<date>-g<NN>/ (E2E_TIME_GOAL).
 */
import { api, expect, openAs, shot, test } from "../e2e-as/support";

test.describe.configure({ mode: "serial" });

const RUN = Date.now().toString(36).slice(-4).toUpperCase();

test("AI leave assistant answers from the ledger, writes only after confirmation, and respects RBAC", async ({ browser }, testInfo) => {
  test.setTimeout(10 * 60_000);
  const rohan = await openAs(browser, "alpha", "rohan");
  const p = rohan.page;
  const status = await api(p, "GET", "/agent/status");
  expect(status.status, JSON.stringify(status.data)).toBe(200);
  test.skip(!status.data.enabled, "assistant disabled on this stack (AGENT_ENABLED / AI_MODEL not set)");

  const ask = async (text: string) => {
    const before = await p.getByTestId("agent-message-assistant").count();
    await p.getByTestId("agent-composer").fill(text);
    await p.getByTestId("agent-send").click();
    await expect(p.getByTestId("agent-message-assistant")).toHaveCount(before + 1, { timeout: 120_000 });
    await expect(p.getByTestId("agent-thinking")).toHaveCount(0, { timeout: 120_000 });
    return p.getByTestId("agent-message-assistant").last();
  };

  await test.step("1. balances question is answered from the ledger", async () => {
    await p.goto("/agent");
    await expect(p.getByTestId("agent-composer")).toBeVisible();
    await p.getByRole("button", { name: "New", exact: true }).click(); // a fresh thread, no earlier context
    await expect(p.getByTestId("agent-message-assistant")).toHaveCount(0);
    const balances = await api(p, "GET", "/leaves/balances/me");
    const casual = (balances.data.balances as any[]).find((b) => b.leave_type_code === "casual");
    const answer = await ask("How many casual leave days do I have left?");
    if (casual) {
      const n = Number(casual.available ?? casual.balance);
      await expect(answer).toContainText(new RegExp(`\\b${n}(\\.0+)?\\b|${n.toFixed(1)}`));
    }
    await shot(p, testInfo, "lh21-01-agent-balance-answer");
  });

  await test.step("2. apply needs an explicit confirmation card", async () => {
    const before = await api(p, "GET", "/leaves/requests?limit=100");
    const countBefore = ((before.data.items ?? before.data) as any[]).length;
    await ask(`Apply one day of earned leave on 2026-12-2${1 + (RUN.charCodeAt(0) % 4)} for a personal errand ${RUN}`); // Mon–Thu, inside the granted 2026 cycle
    const card = p.getByTestId("agent-action-card").last();
    await expect(card).toBeVisible({ timeout: 60_000 });
    await shot(p, testInfo, "lh21-02-agent-confirmation-card");
    const mid = await api(p, "GET", "/leaves/requests?limit=100");
    expect(((mid.data.items ?? mid.data) as any[]).length, "nothing written before confirm").toBe(countBefore);
    await card.getByRole("button").first().click();
    await expect(card.getByTestId("agent-action-result")).toBeVisible({ timeout: 60_000 });
    await shot(p, testInfo, "lh21-03-agent-action-confirmed");
    const after = await api(p, "GET", "/leaves/requests?limit=100");
    expect(((after.data.items ?? after.data) as any[]).length).toBeGreaterThan(countBefore);
  });

  await test.step("3. an employee cannot approve through the assistant", async () => {
    const answer = await ask("Approve all pending leave requests of my colleagues.");
    await expect(p.getByTestId("agent-action-card").filter({ hasText: /approve/i })).toHaveCount(0);
    await expect(answer).toContainText(/(can(not|'t|’t)|unable|not (allowed|permitted|able)|permission|only (managers|approvers))/i);
    await shot(p, testInfo, "lh21-04-agent-rbac-refusal");
  });
  await rohan.close();
});
