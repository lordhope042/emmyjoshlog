'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// Test subprocess gets only synthetic values; never connects to this datasource.
process.env.DATABASE_URL = 'mysql://test@127.0.0.1:3308/not_used';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
delete process.env.MOCK_POCKETFI;
const config = require('../legacy-api/src/config');
const { csrfProtection, csrfEndpoint, tokenFor, cookieOptions, COOKIE } = require('../legacy-api/src/middleware/csrf');

test('JWT configuration rejects public/short fallbacks and derives distinct encoded key bytes', () => {
  assert.throws(() => config.signingSecret({}), /no default/);
  assert.throws(() => config.signingSecret({ JWT_SECRET: 'short' }), /32/);
  const key = config.signingSecret({ INVENTORY_ENCRYPTION_KEY_V1: 'a'.repeat(40) });
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.notEqual(key, config.signingSecret({ INVENTORY_ENCRYPTION_KEY_V1: 'b'.repeat(40) }));
});
test('customer CSRF rejects absent/mismatched/session-stale tokens and permits matching authenticated writes', () => {
  const seed = crypto.randomBytes(32).toString('base64url');
  let status = 0; let nextCalls = 0;
  const res = { status(n) { status = n; return this; }, json() { return this; } };
  const req = { method: 'POST', headers: {}, cookies: { [COOKIE]: seed, token: 'session-A' }, get() { return this.csrf || ''; } };
  csrfProtection(req, res, () => nextCalls++); assert.equal(status, 403);
  req.csrf = tokenFor(seed, 'session-A'); csrfProtection(req, res, () => nextCalls++); assert.equal(nextCalls, 1);
  req.cookies.token = 'session-B'; csrfProtection(req, res, () => nextCalls++); assert.equal(status, 403); assert.equal(nextCalls, 1);
  req.headers.authorization = 'Bearer invalid-token'; delete req.cookies.token;
  csrfProtection(req, res, () => nextCalls++); assert.equal(status, 401); assert.equal(nextCalls, 1);
});
test('security token endpoint issues an HttpOnly cookie and no-store token response', () => {
  let value; let options; let payload; let cache;
  const res = { cookie(n, v, o) { assert.equal(n, COOKIE); value = v; options = o; return this; }, set(n,v) { cache=v; return this; }, json(p) { payload=p; return this; } };
  csrfEndpoint({ cookies: {} }, res);
  assert.equal(options.httpOnly, true); assert.equal(options.secure, true); assert.equal(options.sameSite, 'none');
  assert.equal(payload.csrfToken, tokenFor(value)); assert.equal(cache, 'private, no-store');
});
test('local customer cookie mode is explicit and keeps HttpOnly', () => {
  process.env.CUSTOMER_LOCAL_HTTP = '1';
  const options = cookieOptions(); assert.equal(options.secure, false); assert.equal(options.sameSite, 'lax'); assert.equal(options.httpOnly, true);
  delete process.env.CUSTOMER_LOCAL_HTTP;
});
