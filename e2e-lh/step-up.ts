/**
 * "Confirm it's you" for holiday publication on the time stack (LH-SEC-02): publishing a holiday year needs a fresh
 * step-up; the e-mailed six-digit code is read from the stack's development outbox
 * (hrms-backend/logs/outbox/<company id>/auth.step_up_code-<email>-*.eml).
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

import type { Page } from "@playwright/test";

import { BACKEND, account, api, expect, store, type CompanyKey } from "../e2e-as/support";

const PYTHON = path.join(BACKEND, "venv", "Scripts", "python.exe");

async function outboxCode(companyId: number, email: string, since: number, timeoutMs = 25_000): Promise<string> {
  const script = [
    "import email,re,sys,pathlib",
    "from email import policy",
    "folder=pathlib.Path(sys.argv[1]); safe=re.sub(r'[^a-zA-Z0-9@._-]','_',sys.argv[2]); since=float(sys.argv[3])",
    "files=sorted((p for p in folder.glob(f'auth.step_up_code-{safe}-*.eml') if p.stat().st_mtime>=since-1),key=lambda p:p.stat().st_mtime)",
    "code=''",
    "if files:",
    "  m=email.message_from_bytes(files[-1].read_bytes(),policy=policy.default); part=m.get_body(preferencelist=('plain','html'))",
    "  t=part.get_content() if part is not None else ''",
    "  r=re.search(r'Code:\\s*(\\d{6})',t); code=r.group(1) if r else ''",
    "sys.stdout.write(code)",
  ].join("\n");
  const folder = path.join(BACKEND, "logs", "outbox", String(companyId));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const code = execFileSync(PYTHON, ["-c", script, folder, email, String(since / 1000)], { cwd: BACKEND, encoding: "utf8" }).trim();
    if (code) return code;
    await new Promise((r) => setTimeout(r, 700));
  }
  throw new Error(`No step-up code for ${email} reached the outbox ${folder}`);
}

/** A fresh step-up for the signed-in page's session without the dialog (e-mailed code from the dev outbox). */
export async function stepUpViaApi(page: Page, key: CompanyKey, person: string) {
  const since = Date.now();
  const sent = await api(page, "POST", "/payroll/step-up/email-code", {});
  expect(sent.status, JSON.stringify(sent.data)).toBe(200);
  const code = await outboxCode(store().companies[key].company_id, account(key, person).email, since);
  const verified = await api(page, "POST", "/payroll/step-up", { code });
  expect(verified.status, JSON.stringify(verified.data)).toBe(200);
}

/** If the "Confirm it's you" prompt is open, complete it with the e-mailed code (no-op when it does not appear). */
export async function completeStepUpIfAsked(page: Page, key: CompanyKey, person: string, waitMs = 6_000) {
  const dialog = page.getByRole("dialog", { name: /confirm it's you/i });
  try {
    await dialog.waitFor({ state: "visible", timeout: waitMs });
  } catch {
    return false;
  }
  const since = Date.now();
  await dialog.getByRole("button", { name: /e-mail me a code|send a new code/i }).click();
  const code = await outboxCode(store().companies[key].company_id, account(key, person).email, since);
  await dialog.getByPlaceholder("123456").fill(code);
  await dialog.getByRole("button", { name: /^confirm$/i }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  return true;
}
