'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('frontend manifest declares customer number and delivery routes', () => {
  const manifest = JSON.parse(read('public/manus-routes.json'));
  const paths = manifest.routes.map((route) => route.path);
  assert.ok(paths.includes('/numbers'));
  assert.ok(paths.includes('/numbers/orders/:id'));
  assert.ok(paths.includes('/orders/:id'));
  assert.ok(paths.includes('/admin/checkout'));
  assert.ok(paths.includes('/admin/supplier'));
});

test('frontend API keeps checkout server-authoritative and retry-safe', () => {
  const api = read('js/api.js');
  assert.match(api, /expectedUnitPriceMinor/);
  assert.match(api, /Idempotency-Key/);
  assert.match(api, /auth\/csrf/);
  assert.match(api, /invalidateCsrf/);
  assert.match(api, /providers\/numbers\/orders/);
});

test('frontend does not persist delivery or provider session secrets', () => {
  const app = read('js/app.js');
  const api = read('js/api.js');
  assert.doesNotMatch(app, /localStorage\.(setItem|getItem)\([^)]*(delivery|session|code|phone)/i);
  assert.doesNotMatch(api, /localStorage\.(setItem|getItem)\([^)]*(delivery|session|code|phone)/i);
});
