import { KEYS, api, expect, host, openTenant, probe, secrets, shot, signIn, test, writeEvidence } from "./support";

/**
 * From each company administrator's signed-in browser, every other company's records, files,
 * settings, brand and address are attacked directly through the API (as a tampering user would).
 * Every response is recorded; FastAPI must refuse all of them.
 */
const S = secrets();

for (const attackerKey of KEYS) {
  test(`${attackerKey}: the administrator cannot reach the other two companies`, async ({ browser, request }, testInfo) => {
    const attacker = S.companies[attackerKey];
    const t = await openTenant(browser, testInfo, `${attackerKey}-attacker`, host(attacker));
    const evidence: Record<string, Record<string, number>> = {};
    try {
      await signIn(t.page, attacker.people.admin.email, S.password);
      for (const victimKey of KEYS.filter((k) => k !== attackerKey)) {
        const v = S.companies[victimKey];
        const log: Record<string, number> = {};
        const emp = v.people.emp1.employee_id;
        const payroll = Object.values(v.payroll)[0].id;
        await probe(t.page, log, "GET", `/employees/${emp}`);
        await probe(t.page, log, "PUT", `/employees/${emp}`, { position: "Hijacked" });
        await probe(t.page, log, "GET", `/employees/${emp}/photo`);
        await probe(t.page, log, "GET", `/employees/${emp}/assignments`);
        await probe(t.page, log, "GET", `/leaves/balance/${emp}`);
        await probe(t.page, log, "POST", `/leaves/${v.pending_leave_id}/approve`, { remarks: "x" });
        await probe(t.page, log, "GET", `/payroll/${payroll}`);
        await probe(t.page, log, "GET", `/payroll/${payroll}/slip.pdf`);
        await probe(t.page, log, "POST", `/payroll/${payroll}/approve`);
        await probe(t.page, log, "GET", `/legal-entities/${v.legal_entity.id}/document-brand`);
        await probe(t.page, log, "PATCH", `/legal-entities/${v.legal_entity.id}`, { legal_name: "Hijacked" });
        await probe(t.page, log, "PATCH", `/branches/${Object.values(v.branches)[0].id}`, { name: "Hijacked" });
        await probe(t.page, log, "PUT", `/departments/${Object.values(v.departments)[0]}`, { name: "Hijacked" });
        await probe(t.page, log, "PUT", `/org/employees/${attacker.people.emp1.employee_id}/manager`, { manager_id: emp });
        await probe(t.page, log, "PUT", `/users/${v.people.emp1.user_id}/status`, { status: "suspended" });
        await probe(t.page, log, "PUT", `/users/${attacker.people.emp1.user_id}/assigned-employees`, { employee_ids: [emp] });
        for (const [call, status] of Object.entries(log)) expect([403, 404], `${attackerKey} -> ${victimKey}: ${call}`).toContain(status); // valid bodies: only ownership can refuse

        // Lists, searches, filters and reports never return the victim's people.
        const search = await api(t.page, "GET", `/employees?q=${encodeURIComponent(v.people.emp1.name.split(" ")[0])}&company_id=${v.company_id}`);
        expect(search.data.items.map((e: { id: number }) => e.id)).not.toContain(emp);
        const filtered = await api(t.page, "GET", `/employees?department_id=${Object.values(v.departments)[0]}`);
        log["GET /employees?department_id=<victim dept> (total)"] = filtered.data.total;
        expect(filtered.data.total).toBe(0);
        const leaveReport = await api(t.page, "GET", `/reports/leaves?employee_id=${emp}`);
        expect(JSON.stringify(leaveReport.data)).not.toContain(v.people.emp1.name);
        // A forged company_id is refused outright.
        log["POST /employees with company_id"] = await probe(t.page, {}, "POST", "/employees", {
          first_name: "Forged", last_name: "Tenant", email: `forged-${victimKey}@example.test`, employee_code: `F-${victimKey}`,
          hire_date: "2026-01-05", company_id: v.company_id,
        });
        expect(log["POST /employees with company_id"]).toBe(422);
        // The victim's brand assets are served on the victim's address only.
        const brand = await (await request.get(`${host(v)}/api/v1/public/brand`)).json();
        const logo = brand.logos.light as string;
        log["GET <victim logo> on attacker host"] = (await t.page.request.get(`${host(attacker)}${logo}`)).status();
        log["GET <victim logo> on victim host"] = (await request.get(`${host(v)}${logo}`)).status();
        expect(log["GET <victim logo> on attacker host"]).toBe(404);
        expect(log["GET <victim logo> on victim host"]).toBe(200);
        // The attacker's cookies are host-only: the victim's address treats the browser as signed out.
        log["GET <victim host>/api/v1/auth/me"] = (await t.page.request.get(`${host(v)}/api/v1/auth/me`)).status();
        expect(log["GET <victim host>/api/v1/auth/me"]).toBe(401);
        evidence[`${attackerKey} -> ${victimKey}`] = log;
      }
      // Victim records were not changed by any of the attempts.
      const victimKey = KEYS.find((k) => k !== attackerKey)!;
      const victim = await openTenant(browser, testInfo, `${victimKey}-after-attack-by-${attackerKey}`, host(S.companies[victimKey]));
      await signIn(victim.page, S.companies[victimKey].people.admin.email, S.password);
      const record = (await api(victim.page, "GET", `/employees/${S.companies[victimKey].people.emp1.employee_id}`)).data;
      expect(record.position).not.toBe("Hijacked");
      await victim.close();

      // Opening another company's address shows that company's sign-in page, not a session.
      await t.page.goto(`${host(S.companies[KEYS.find((k) => k !== attackerKey)!])}/dashboard`);
      await expect(t.page).toHaveURL(/\/login/);
      await shot(t.page, testInfo, `02-${attackerKey}-other-company-address`);
      writeEvidence(`02-${attackerKey}-attack-responses.json`, evidence);
      expect(t.errors).toEqual([]);
    } finally {
      await t.close();
    }
  });
}
