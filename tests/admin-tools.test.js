'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  decimalToMinor, minorToDecimal, calculateRetail, pricingInput, productInput,
  parseJsonl, encryptPayload, decryptPayload, fingerprintPayload, publicProduct, csrfToken,
} = require('../backend');

const secret = 'unit-test-secret-that-is-at-least-32-characters-long';

test('money uses exact integer kobo arithmetic and safe JSON bounds', () => {
  assert.equal(decimalToMinor('12.5'), 1250n);
  assert.equal(minorToDecimal(1250n), '12.50');
  assert.equal(calculateRetail({ costMinor: 10000n, mode: 'PERCENT', value: '12.50' }), 11250n);
  assert.equal(calculateRetail({ costMinor: 1n, mode: 'PERCENT', value: '0.01' }), 2n);
  assert.equal(calculateRetail({ costMinor: 1000n, mode: 'FIXED', value: '10.00' }), 2000n);
  assert.equal(calculateRetail({ costMinor: 1000n, mode: 'FIXED', value: '0.00' }), 1000n);
  assert.equal(calculateRetail({ costMinor: null, mode: 'MANUAL', value: '10.00' }), 1000n);
  assert.throws(() => calculateRetail({ costMinor: null, mode: 'FIXED', value: '10.00' }));
  assert.throws(() => calculateRetail({ costMinor: 100n, mode: 'PERCENT', value: '1000.01' }));
  assert.throws(() => calculateRetail({ costMinor: 9007199254740991n, mode: 'FIXED', value: '0.01' }));
  assert.throws(() => decimalToMinor('1.234'));
  assert.throws(() => decimalToMinor('90071992547409.92'));
});

test('pricing and product validation enforce scopes and supplier mapping before activation', () => {
  assert.deepEqual(pricingInput({ scope: 'DEFAULT', scopeKey: 'ignored', mode: 'FIXED', value: '10.00' }), { scope: 'DEFAULT', scopeKey: 'logs', mode: 'FIXED', value: '10.00' });
  const input = { name: 'Mapped logs', platform: 'Instagram', description: '', terms: '', source: 'DONMARKETPLACE', status: 'ACTIVE', acquisitionCost: null, minQty: 1, maxQty: 2 };
  assert.throws(() => productInput(input), error => error.code === 'supplier_mapping_required');
  assert.equal(productInput({ ...input, status: 'DRAFT' }).status, 'DRAFT');
  assert.equal(productInput({ ...input, acquisitionCost: '10.00' }, { id: 'ejp_valid', supplier_product_id: 'supplier-1', acquisition_cost_minor: 1000 }).status, 'ACTIVE');
  assert.deepEqual(pricingInput({ scope: 'PLATFORM', scopeKey: 'Instagram', mode: 'FIXED', value: '0.00' }), { scope: 'PLATFORM', scopeKey: 'Instagram', mode: 'FIXED', value: '0.00' });
  assert.throws(() => pricingInput({ scope: 'PLATFORM', scopeKey: 'NotAPlatform', mode: 'FIXED', value: '1.00' }));
  assert.throws(() => productInput({ name: '   ', platform: 'Instagram', description: '', terms: '', source: 'OWN' }));
});

test('JSONL validation preserves passwords, flags upload duplicates, and bounds rows', () => {
  const content = [
    JSON.stringify({ payload: { username: ' Alice ', password: '  keep spaces exactly  ' }, sourceRef: 'batch-a' }),
    JSON.stringify({ payload: { username: 'alice', password: 'different' } }),
    JSON.stringify({ payload: { email: 'new@example.test', password: 'another' } }),
  ].join('\n');
  const diagnostics = parseJsonl(content, { platform: 'Instagram' }, secret);
  assert.equal(diagnostics[0].status, 'NEW');
  assert.equal(diagnostics[1].status, 'DUPLICATE_IN_UPLOAD');
  assert.equal(diagnostics[2].status, 'NEW');
  assert.equal(diagnostics[0].payload.password, '  keep spaces exactly  ');
  assert.equal(diagnostics[0].fingerprint.length, 64);
  assert.equal(parseJsonl(`${JSON.stringify({ payload: { password: 'x' } })}\n`, { platform: 'Instagram' }, secret)[0].status, 'INVALID');
  assert.equal(parseJsonl(`\n${JSON.stringify({ payload: { username: 'line-two', password: 'ok' } })}\n\n${JSON.stringify({ payload: { username: 'line-four', password: 'ok' } })}`, { platform: 'Instagram' }, secret)[0].lineNo, 2);
  assert.equal(parseJsonl(JSON.stringify({ payload: { username: 'empty-password', password: '' } }), { platform: 'Instagram' }, secret)[0].status, 'INVALID');
});

test('inventory payload encryption is authenticated and fingerprint is deterministic but not an API payload', () => {
  const payload = { username: 'alice', password: 'secret' };
  const ciphertext = encryptPayload(payload, secret);
  assert.notEqual(ciphertext.toString('utf8').includes('secret'), true);
  assert.deepEqual(decryptPayload(ciphertext, secret), payload);
  assert.equal(fingerprintPayload(payload, 'Instagram', secret), fingerprintPayload(payload, 'Instagram', secret));
  assert.notEqual(fingerprintPayload(payload, 'Instagram', secret), fingerprintPayload({ ...payload, password: 'other' }, 'Instagram', secret));
});

test('CSRF token is stable per opaque session cookie and not a stored digest', () => {
  const first = csrfToken('opaque-session-cookie-a', secret);
  assert.equal(first, csrfToken('opaque-session-cookie-a', secret));
  assert.notEqual(first, csrfToken('opaque-session-cookie-b', secret));
  assert.notEqual(first, 'opaque-session-cookie-a');
});

test('public product redaction excludes cost, rules, ciphertext, and credential fields', () => {
  const product = publicProduct({ id: 'ejl_1', name: 'Logs', platform: 'Instagram', description: 'desc', terms: 'terms', min_qty: 1, max_qty: 5 }, { retailMinor: 2500 }, 3);
  assert.deepEqual(product, { id: 'ejl_1', name: 'Logs', platform: 'Instagram', description: 'desc', terms: 'terms', category: 'Logs', categorySlug: 'logs', price: '25.00', priceMinor: 2500, available: true, _count: { inventory: 3 }, customLog: true, minQty: 1, maxQty: 5, checkoutEnabled: false });
  assert.equal('fingerprint' in product, false);
  assert.equal('payload' in product, false);
});
