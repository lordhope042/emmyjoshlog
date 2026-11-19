'use strict';

// Run manually after setup/start: node tests/live-readonly-check.js
// Opens a temporary administrator session, performs read-only queries/calculations,
// then revokes that session. Creates no products, rules, imports, inventory or orders.
const assert = require('node:assert/strict');
const base = process.env.TEST_ORIGIN || 'http://127.0.0.1:3000';
let cookie = '';
let csrf = '';
async function call(path, method = 'GET', body, expected = 200, includeCsrf = true) {
  const headers = { 'X-EJ-Request': '1', Accept: 'application/json' };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (includeCsrf && csrf) headers['X-Admin-CSRF'] = csrf;
  const response = await fetch(`${base}/api/admin-tools${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal(response.status, expected, `Unexpected HTTP status on ${path}`);
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return { data: await response.json(), setCookie };
}
(async () => {
  try {
    await call('/summary', 'GET', undefined, 401);
    const login = await call('/login', 'POST', { email: process.env.ADMIN_BOOTSTRAP_EMAIL, password: process.env.ADMIN_BOOTSTRAP_PASSWORD });
    assert(login.data.user?.role === 'ADMIN');
    assert(/HttpOnly/i.test(login.setCookie) && /Secure/i.test(login.setCookie) && /SameSite=None/i.test(login.setCookie));
    csrf = login.data.csrfToken;
    const session = await call('/session');
    assert.equal(session.data.csrfToken, csrf, 'CSRF token must remain stable on session refresh');
    await call('/pricing/preview', 'POST', { cost: '1600.00', rule: { mode: 'FIXED', value: '300.00' } }, 403, false);
    await call('/pricing/preview', 'POST', { cost: 1600, rule: { mode: 'FIXED', value: '300.00' } }, 400);
    for (const path of ['/summary', '/products', '/pricing-rules', '/imports', '/inventory', '/audit', '/supplier', '/catalog']) await call(path);
    const fixed = (await call('/pricing/preview', 'POST', { cost: '1600.00', rule: { mode: 'FIXED', value: '300.00' } })).data;
    assert.equal(fixed.pricing.retailMinor, 190000);
    assert.equal(fixed.pricing.grossMinor, 30000);
    const percent = (await call('/pricing/preview', 'POST', { cost: '1600.00', rule: { mode: 'PERCENT', value: '20.00' } })).data;
    assert.equal(percent.pricing.retailMinor, 192000);
    const manual = (await call('/pricing/preview', 'POST', { cost: null, rule: { mode: 'MANUAL', value: '2000.00' } })).data;
    assert.equal(manual.pricing.retailMinor, 200000);
    assert.equal(manual.pricing.grossMinor, null);
    const below = (await call('/pricing/preview', 'POST', { cost: '1600.00', rule: { mode: 'MANUAL', value: '1000.00' } })).data;
    assert.equal(below.pricing, null);
    console.log('Read-only live checks passed: auth, cookie attributes, stable CSRF, access gates, admin reads, fixed/percentage/manual pricing and below-cost rejection. No stock or orders created.');
  } finally {
    if (cookie && csrf) await call('/logout', 'POST', {});
  }
})().catch(() => { console.error('Read-only integration check failed. No credential values are printed.'); process.exitCode = 1; });
