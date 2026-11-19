'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { pocketfiConfig } = require('../legacy-api/src/services/pocketfi');

test('PocketFi API token never falls back to the webhook signing secret', () => {
  const secretOnly = pocketfiConfig({ env: { POCKETFI_SECRET_KEY: 'webhook-only-secret', POCKETFI_ENABLED: 'true' } });
  assert.equal(secretOnly.token, '');
  assert.equal(secretOnly.secretKey, 'webhook-only-secret');
  assert.equal(secretOnly.enabled, true);

  const independent = pocketfiConfig({ env: { POCKETFI_API_TOKEN: 'merchant-api-token', POCKETFI_SECRET_KEY: 'webhook-only-secret' } });
  assert.equal(independent.token, 'merchant-api-token');
  assert.equal(independent.secretKey, 'webhook-only-secret');
});