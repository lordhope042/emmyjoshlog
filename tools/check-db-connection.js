'use strict';

// Quick connectivity and TLS check for the PostgreSQL database. Read-only. Prints no secrets.
//   node tools/check-db-connection.js
require('dotenv').config();
const { createPool, parseDatabaseUrl } = require('../backend/db');

(async () => {
  const config = parseDatabaseUrl();
  const db = createPool({ config });
  try {
    const row = (await db.inner.query('SELECT current_database() AS db, version() AS version, current_setting(\'ssl\', true) AS ssl')).rows[0];
    console.log(`Connected to ${config.host}:${config.port}/${row.db}`);
    console.log(`TLS requested: ${config.ssl ? 'yes (certificate verified)' : 'no'}`);
    console.log(row.version);
  } catch (error) {
    console.error(`Connection failed: ${error.code || error.message}`);
    process.exitCode = 1;
  } finally { await db.end().catch(() => {}); }
})();
