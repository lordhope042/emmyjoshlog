'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { config } = require('../backend/providers/config');

const REQUIRED_PROVIDER_ENV_NAMES = [
  'DONMARKETPLACE_ENABLED', 'DONMARKETPLACE_PURCHASES_ENABLED', 'DONMARKETPLACE_DELIVERY_CONTRACT_CONFIRMED', 'DONMARKETPLACE_MODE', 'DONMARKETPLACE_API_KEY', 'DONMARKETPLACE_SANDBOX_API_KEY',
  'PROVIDER1_ENABLED', 'PROVIDER1_PURCHASES_ENABLED', 'PROVIDER1_5SIM_API_TOKEN', 'PROVIDER1_CURRENCY', 'PROVIDER1_NGN_RATE', 'PROVIDER1_RETAIL_MODE', 'PROVIDER1_RETAIL_MARKUP',
  'PROVIDER2_ENABLED', 'PROVIDER2_PURCHASES_ENABLED', 'PROVIDER2_SMSBOWER_API_KEY', 'PROVIDER2_CURRENCY', 'PROVIDER2_NGN_RATE', 'PROVIDER2_RETAIL_MODE', 'PROVIDER2_RETAIL_MARKUP',
];

test('provider environment contract names are explicit and safe by default', () => {
  assert.equal(REQUIRED_PROVIDER_ENV_NAMES.length, 20);
  const value = config({});
  assert.equal(value.don.enabled, false);
  assert.equal(value.don.purchasesEnabled, false);
  assert.equal(value.providers[1].purchasesEnabled, false);
  assert.equal(value.providers[2].purchasesEnabled, false);
  assert.equal(value.providers[1].token, '');
  assert.equal(value.providers[2].token, '');
});

module.exports = { REQUIRED_PROVIDER_ENV_NAMES };
