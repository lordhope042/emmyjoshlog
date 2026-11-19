'use strict';

const path = require('node:path');
const readline = require('node:readline/promises');
const { StringDecoder } = require('node:string_decoder');
const { stdin, stdout } = process;

function readHidden(prompt) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    return Promise.reject(new Error('Run this script in an interactive terminal so the password can be entered without echo.'));
  }
  return new Promise((resolve, reject) => {
    let value = '';
    const decoder = new StringDecoder('utf8');
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      stdin.removeListener('data', onData);
      try { stdin.setRawMode(false); } catch {}
      stdin.pause();
      stdout.write('\n');
    };
    const onData = (chunk) => {
      for (const character of decoder.write(chunk)) {
        if (character === '\u0003') {
          cleanup();
          reject(new Error('Cancelled. No password was changed.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          cleanup();
          resolve(value);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = [...value].slice(0, -1).join('');
          continue;
        }
        if (character >= ' ' && character !== '\u007f') value += character;
      }
    };
    stdout.write(prompt);
    try { stdin.setRawMode(true); } catch (error) { cleanup(); reject(error); return; }
    stdin.resume();
    stdin.on('data', onData);
  });
}

async function askVisible(prompt, defaultValue = '') {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question(prompt)).trim();
    return answer || defaultValue;
  } finally { rl.close(); }
}

async function main() {
  const projectRoot = process.cwd();
  const dbPath = path.join(projectRoot, 'backend', 'db.js');
  const cryptoPath = path.join(projectRoot, 'backend', 'crypto.js');
  let dbModule;
  let connection;
  let transactionOpen = false;
  try {
    dbModule = require(dbPath);
    const { scryptHash } = require(cryptoPath);
    const email = (await askVisible('Admin email [admin@emmyjosh.com]: ', 'admin@emmyjosh.com')).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid admin email address.');

    const password = await readHidden('New admin password (12+ characters; input is hidden): ');
    if (password.length < 12) throw new Error('Password must be at least 12 characters. No changes were made.');
    const confirmation = await readHidden('Re-enter new admin password: ');
    if (password !== confirmation) throw new Error('Passwords did not match. No changes were made.');

    const rl = readline.createInterface({ input: stdin, output: stdout });
    let finalConfirmation;
    try {
      finalConfirmation = (await rl.question(`Type RESET to change ${email} and revoke that account's admin sessions: `)).trim();
    } finally { rl.close(); }
    if (finalConfirmation !== 'RESET') throw new Error('Confirmation did not match. No changes were made.');

    const passwordHash = await scryptHash(password);
    const pool = dbModule.getPool();
    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionOpen = true;
    const [admins] = await connection.query(
      "SELECT id, email FROM ej_admin_users WHERE email = ? AND role = 'ADMIN' LIMIT 2 FOR UPDATE",
      [email],
    );
    if (admins.length !== 1) throw new Error('Exactly one matching admin account was not found. No changes were made.');

    const admin = admins[0];
    const [updated] = await connection.query(
      "UPDATE ej_admin_users SET password_hash = ? WHERE id = ? AND role = 'ADMIN'",
      [passwordHash, admin.id],
    );
    if (updated.affectedRows !== 1) throw new Error('The admin password was not updated.');
    const [revoked] = await connection.query('DELETE FROM ej_admin_sessions WHERE user_id = ?', [admin.id]);
    await connection.commit();
    transactionOpen = false;
    console.log(`Admin password updated for ${admin.email}. Revoked ${revoked.affectedRows} admin session(s).`);
  } finally {
    if (connection) {
      if (transactionOpen) { try { await connection.rollback(); } catch {} }
      try { connection.release(); } catch {}
    }
    if (dbModule?.closePool) {
      try { await dbModule.closePool(); } catch {}
    }
  }
}

main().catch((error) => {
  console.error(`Admin password reset did not complete: ${error.message}`);
  process.exitCode = 1;
});
