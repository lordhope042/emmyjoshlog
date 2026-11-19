'use strict';

require('dotenv').config();
const { getPool, closePool } = require('../backend/db');

async function main() {
  const db = getPool();
  const [identity] = await db.query(
    'SELECT VERSION() AS serverVersion, DATABASE() AS databaseName, CURRENT_USER() AS databaseUser'
  );
  const [tls] = await db.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
  const cipher = tls?.[0]?.Value || '';

  if (!cipher) {
    throw new Error('Connected to MySQL, but the session did not report an active TLS cipher.');
  }

  console.log('[Aiven] MySQL connection successful');
  console.log(JSON.stringify({
    serverVersion: identity[0]?.serverVersion,
    databaseName: identity[0]?.databaseName,
    databaseUser: identity[0]?.databaseUser,
    tls: 'enabled',
    tlsCipher: cipher,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error('[Aiven] Connection test failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
