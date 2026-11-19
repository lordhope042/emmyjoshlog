'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../js/admin-tools.js'), 'utf8');

test('admin logout invalidates stale loaders and clears private records and drafts', () => {
  assert.match(source, /function clearPrivateAdminState\(\)/);
  assert.match(source, /state\.summary = null; state\.products = \[\]; state\.rules = \[\]; state\.imports = \[\]; state\.units = \[\]; state\.audits = \[\];/);
  assert.match(source, /state\.supplier = null; state\.checkoutOrders = \[\]; state\.supplierStatus = null;/);
  assert.match(source, /state\.upload = emptyUpload\(\); state\.uploadResult = null;/);
  assert.match(source, /busy = true; revision \+= 1; clearPrivateAdminState\(\); render\(\);/);
  assert.match(source, /session = null;\s*csrfToken = null;/);
});