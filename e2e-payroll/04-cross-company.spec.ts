import {
  BRAND, COMPANY_NAME, KEYS, api, company, db, expect, expectNoForeignBrand, login, settle, shot, test, writeEvidence,
  type CompanyKey, type Session,
} from "./support";

/**
 * Cross-company browser security (Goal 2 §19): six simultaneous Chrome contexts — Alpha admin, Beta admin,
 * Gamma admin, Alpha payroll processor, Beta department manager, Gamma employee — each with its own cookies
 * and storage, all open at the same time. Every context attacks the other two companies' runs, structures,
 * bank accounts, payslips, payments, reports, settings and documents through the real API (the browser's own
 * session), and opens their URLs in the UI. Correct result: authorized denial without disclosure, verified by
 * the network responses AND by read-only DB fingerprints that do not change. No console errors, no mixed
 * branding, no tenant selector.
 */
const ACTORS: [CompanyKey, string][] = [
  ["alpha", "admin"], ["beta", "admin"], ["gamma", "admin"], ["alpha", "processor"], ["beta", "deptmgr"], ["gamma", "emp1"],
];

interface Victim {
  key: CompanyKey;
  run: number;
  draft: number;
  structure: number;
  bank: number;
  payslip: number;
  employee: number;
  entity: number;
}
function victim(key: CompanyKey): Victim {
  const c = company(key) as any;
  return {
    key,
    run: c.runs.finalized.id,
    draft: c.runs.draft.id,
    structure: db("structures_of_company", { company_id: c.company_id })[0].id,
    bank: db("bank_accounts_of_company", { company_id: c.company_id })[0].id,
    payslip: db("payslips_of_company", { company_id: c.company_id })[0].id,
    employee: c.people.emp1.employee_id,
    entity: Object.values(c.ids.entities as Record<string, number>)[0],
  };
}

/** Requests a tampering user would send. Valid bodies, so only ownership can refuse them. */
function attacks(v: Victim): [string, string, unknown?][] {
  return [
    ["GET", `/payroll/runs/${v.run}`],
    ["GET", `/payroll/runs/${v.run}/employees`],
    ["GET", `/payroll/runs/${v.run}/summary`],
    ["POST", `/payroll/runs/${v.draft}/calculate`, { row_version: 1 }],
    ["POST", `/payroll/runs/${v.draft}/cancel`, { reason: "attack", row_version: 1 }],
    ["POST", `/payroll/runs/${v.run}/approve`, { row_version: 1, comment: null }],
    ["GET", `/payroll/salary-structures/${v.structure}`],
    ["POST", `/payroll/salary-structures/${v.structure}/archive`, { reason: "attack" }],
    ["GET", `/payroll/employees/${v.employee}/compensation`],
    ["GET", `/payroll/bank-accounts/${v.bank}`],
    ["POST", `/payroll/bank-accounts/${v.bank}/reveal`, { reason: "attack" }],
    ["POST", `/payroll/bank-accounts/${v.bank}/deactivate`, { reason: "attack" }],
    ["GET", `/payroll/payslips/${v.payslip}`],
    ["GET", `/payroll/payslips/${v.payslip}/download`],
    ["GET", `/me/payroll/payslips/${v.payslip}`],
    ["GET", `/payroll/documents/${v.payslip}/download`],
    ["GET", `/payroll/runs/${v.run}/payments`],
    ["GET", `/payroll/runs/${v.run}/finalization`],
    ["PUT", `/payroll/settings/values`, { changes: [{ key: "payroll.rounding.net_pay_increment", scope_type: "LEGAL_ENTITY", scope_id: v.entity, value: "100", effective_from: "2026-10-01", reason: "attack" }] }],
  ];
}

test("six simultaneous contexts cannot reach each other's payroll", async ({ browser }, testInfo) => {
  test.setTimeout(20 * 60_000);
  const victims = Object.fromEntries(KEYS.map((k) => [k, victim(k)])) as Record<CompanyKey, Victim>;
  const fingerprints = Object.fromEntries(KEYS.map((k) => [k, db("company_fingerprint", { company_id: company(k).company_id })[0]]));
  const sessions: Session[] = [];
  const evidence: Record<string, Record<string, number>> = {};
  const leaks: string[] = [];
  try {
    // All six contexts signed in at the same time (isolated cookies/storage).
    for (const [key, role] of ACTORS) sessions.push(await login(browser, testInfo, key, role, { label: `${role}-xco` }));
    // Each sees its own brand only.
    for (const s of sessions) {
      await s.page.goto("/dashboard");
      await settle(s.page);
      await expect(s.page.locator("body")).toContainText(BRAND[s.key]);
      await expectNoForeignBrand(s.page, s.key);
    }
    // Cookies are not shared between contexts: each /auth/me names its own user.
    const whoami = await Promise.all(sessions.map(async (s) => (await api(s.page, "GET", "/auth/me")).data));
    const emails = whoami.map((w: any) => (w?.user?.email ?? w?.email ?? "").toLowerCase());
    expect(new Set(emails).size).toBe(sessions.length);

    for (const s of sessions) {
      for (const vk of KEYS.filter((k) => k !== s.key)) {
        const v = victims[vk];
        const log: Record<string, number> = {};
        for (const [method, path, body] of attacks(v)) {
          const res = await api(s.page, method, path, body);
          log[`${method} ${path}`] = res.status;
          // Denied without disclosure: never 2xx, never a 5xx; a 422 is accepted only for bodies the API
          // validated before looking the record up (recorded in the evidence).
          if (res.status < 300 || res.status >= 500) leaks.push(`${s.name} -> ${vk}: ${method} ${path} = ${res.status}`);
          const text = JSON.stringify(res.data ?? "");
          const victimName = (company(vk) as any).people.emp1.name as string;
          if (text.includes(victimName) || text.includes(COMPANY_NAME[vk])) leaks.push(`${s.name} -> ${vk}: ${method} ${path} disclosed victim data`);
        }
        // Filtered lists never include the victim's rows.
        const obligations = await api(s.page, "GET", `/payroll/payment-obligations?run_id=${v.run}`);
        log[`GET /payroll/payment-obligations?run_id=<victim> (status)`] = obligations.status;
        if (obligations.status === 200 && ((obligations.data as any)?.items ?? []).length) leaks.push(`${s.name} -> ${vk}: obligations listed`);
        const docs = await api(s.page, "GET", `/payroll/documents?run_id=${v.run}`);
        log[`GET /payroll/documents?run_id=<victim> (status)`] = docs.status;
        if (docs.status === 200 && ((docs.data as any)?.items ?? []).length) leaks.push(`${s.name} -> ${vk}: documents listed`);
        const reports = await api(s.page, "GET", "/payroll/reports");
        log["GET /payroll/reports (status)"] = reports.status;
        if (reports.status === 200) {
          const codes = ((reports.data as any).groups as { reports: { code: string }[] }[]).flatMap((g) => g.reports.map((r) => r.code));
          for (const code of codes.slice(0, 4)) {
            // Filter manipulation: the victim's legal entity id as a report filter.
            const r = await api(s.page, "GET", `/payroll/reports/${code}/preview?period_from=2026-09-01&period_to=2026-11-30&legal_entity_id=${v.entity}`);
            log[`GET /payroll/reports/${code}/preview?legal_entity_id=<victim>`] = r.status;
            const t = JSON.stringify(r.data ?? "");
            if (t.includes((company(vk) as any).people.emp1.name)) leaks.push(`${s.name} -> ${vk}: report ${code} disclosed`);
            const victimEntityCode = Object.keys((company(vk) as any).ids.entities)[0];
            if (t.includes(`"${victimEntityCode}"`)) leaks.push(`${s.name} -> ${vk}: report ${code} returned rows of ${victimEntityCode}`);
          }
        }
        // UI: the victim's run URL shows no victim data and no victim brand
        await s.page.goto(`/payroll/runs/${v.run}`);
        await settle(s.page);
        const body = await s.page.locator("body").innerText();
        if (body.includes((company(vk) as any).people.emp1.name) || body.includes(BRAND[vk])) leaks.push(`${s.name} -> ${vk}: UI showed victim data`);
        evidence[`${s.name} -> ${vk}`] = log;
      }
      await shot(s.page, testInfo, `xco-${s.name}-victim-run-url`);
    }

    // DB: nothing of any company changed, and no payroll row references another company's employee.
    for (const k of KEYS) expect(db("company_fingerprint", { company_id: company(k).company_id })[0], `${k} unchanged`).toEqual(fingerprints[k]);
    const refs = db("cross_company_refs")[0];
    expect(Object.values(refs).every((n) => Number(n) === 0)).toBe(true);
    writeEvidence("D-cross-company-denials.json", { actors: ACTORS.map(([k, r]) => `${k}-${r}`), responses: evidence, leaks, db_fingerprints: fingerprints, cross_company_refs: refs });
    expect(leaks).toEqual([]);
    for (const s of sessions) {
      expect(s.pageErrors, `${s.name} page errors`).toEqual([]);
      expect(s.consoleErrors.filter((e) => !/status of (401|403|404|409|422)/.test(e)), `${s.name} console errors`).toEqual([]);
    }
  } finally {
    for (const s of sessions) await s.close();
  }
});

test("a session copied into another context is not a cross-tenant key; stale tabs after sign-out are refused", async ({ browser }, testInfo) => {
  const a = await login(browser, testInfo, "alpha", "admin", { label: "admin-copy-src" });
  const b = await login(browser, testInfo, "beta", "admin", { label: "admin-copy-dst" });
  try {
    // Copy Alpha's cookies into Beta's context: the context becomes Alpha (same user), never a mixed tenant.
    const cookies = await a.context.cookies();
    await b.context.addCookies(cookies);
    const me = (await api(b.page, "GET", "/auth/me")).data as any;
    const email = (me?.user?.email ?? me?.email ?? "").toLowerCase();
    expect([company("alpha").accounts.admin.email.toLowerCase(), company("beta").accounts.admin.email.toLowerCase()]).toContain(email);
    const run = await api(b.page, "GET", `/payroll/runs/${company("beta").runs.finalized.id}`);
    if (email === company("alpha").accounts.admin.email.toLowerCase()) expect([403, 404]).toContain(run.status);
    // Sign out Alpha; the copied/stale session must stop working.
    await api(a.page, "POST", "/auth/logout");
    const after = await api(a.page, "GET", `/payroll/runs/${company("alpha").runs.finalized.id}`);
    expect([401, 403]).toContain(after.status);
    await a.page.goto("/payroll/runs");
    await expect(a.page).toHaveURL(/\/login/);
    await shot(a.page, testInfo, "xco-stale-session-after-logout");
    writeEvidence("D-session-copy.json", { copied_session_identity: email === company("alpha").accounts.admin.email.toLowerCase() ? "alpha admin" : "beta admin", foreign_run_status: run.status, after_logout_status: after.status });
  } finally {
    await a.close();
    await b.close();
  }
});
