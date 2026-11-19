'use strict';

// Applies the PostgreSQL migrations in backend/migrations to DATABASE_URL.
// Safe to run again: applied migrations are recorded and skipped. It does not create an admin user
// (use `npm run db:setup` for a brand-new empty database, or copy the data with the copy tool).
//   node tools/run-migrations.js
require('dotenv').config();
const { runMigrations } = require('../backend/setup');
const { closePool } = require('../backend/db');

runMigrations()
  .then((applied) => { console.log(`Migrations up to date (${applied.length} files checked).`); })
  .catch((error) => { console.error(`Migration failed: ${error.message}`); process.exitCode = 1; })
  .finally(() => closePool());
