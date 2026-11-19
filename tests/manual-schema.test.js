'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const migrationNames = ['001_admin_tools.sql', '002_customer_tables.sql', '003_commerce.sql', '004_pocketfi.sql'];
const schema = fs.readFileSync(path.join(root, 'docs/sql/Complete_Checkout_Database.sql'), 'utf8');

test('complete manual schema contains each current additive migration and prevents replay after manual setup', () => {
  let previousMarker = -1;
  for (const name of migrationNames) {
    const migrationPath = path.join(root, 'backend/migrations', name);
    const migration = fs.readFileSync(migrationPath, 'utf8').trim();
    assert.ok(schema.includes(`-- ===== ${name} =====`), `missing section ${name}`);
    assert.ok(schema.includes(migration), `schema content differs from ${name}`);
    const version = path.basename(name, '.sql');
    const marker = `INSERT IGNORE INTO ej_admin_migrations (version) VALUES ('${version}');`;
    const position = schema.indexOf(marker);
    assert.ok(position > previousMarker, `migration marker out of order: ${version}`);
    assert.ok(position > schema.indexOf(migration), `migration marker appears before DDL: ${version}`);
    previousMarker = position;
  }
  assert.match(schema, /CREATE DATABASE IF NOT EXISTS emmyjosh_logs/);
  assert.doesNotMatch(schema, /\bDROP\s+DATABASE\b|\bTRUNCATE\b/i);
});