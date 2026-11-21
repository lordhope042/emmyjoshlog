'use strict';

const crypto = require('node:crypto');

const SECRET_MIN = 32;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const ROOT_SALT = Buffer.from('emmyjosh-admin-root-v1');
const ROOT_CACHE = new Map();

function inventorySecret(value = process.env.INVENTORY_ENCRYPTION_KEY_V1) {
  if (typeof value !== 'string' || value.length < SECRET_MIN) throw new Error('INVENTORY_ENCRYPTION_KEY_V1 must be at least 32 characters');
  return Buffer.from(value, 'utf8');
}

function deriveKeys(secret = inventorySecret()) {
  const passphrase = Buffer.isBuffer(secret) ? secret.toString('utf8') : String(secret);
  inventorySecret(passphrase);
  let root = ROOT_CACHE.get(passphrase);
  if (!root) {
    root = crypto.scryptSync(passphrase, ROOT_SALT, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    ROOT_CACHE.set(passphrase, root);
  }
  return {
    encryption: crypto.hkdfSync('sha256', root, Buffer.from('emmyjosh-admin-encryption-salt-v1'), Buffer.from('inventory-encryption-v1'), 32),
    hmac: crypto.hkdfSync('sha256', root, Buffer.from('emmyjosh-admin-hmac-salt-v1'), Buffer.from('inventory-fingerprint-v1'), 32),
    csrf: crypto.hkdfSync('sha256', root, Buffer.from('emmyjosh-admin-csrf-salt-v1'), Buffer.from('admin-csrf-v1'), 32),
  };
}

function csrfToken(sessionCookie, secret) {
  if (typeof sessionCookie !== 'string' || !sessionCookie) throw new Error('Session cookie is required');
  return crypto.createHmac('sha256', deriveKeys(secret).csrf).update(sessionCookie, 'utf8').digest('base64url');
}

function canonicalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((out, key) => { out[key] = canonicalize(value[key]); return out; }, {});
  throw new Error('Unsupported value for canonicalization');
}

function canonicalPayload(payload, platform) {
  const copy = { platform: String(platform || '').toLowerCase(), payload: canonicalize(payload) };
  return JSON.stringify(copy);
}

function fingerprintPayload(payload, platform, secret) {
  return crypto.createHmac('sha256', deriveKeys(secret).hmac).update(canonicalPayload(payload, platform), 'utf8').digest('hex');
}

function identityFingerprint(payload, platform, secret) {
  const identifier = typeof payload.username === 'string' && payload.username.trim() ? `username:${payload.username.trim().toLowerCase()}` : `email:${String(payload.email || '').trim().toLowerCase()}`;
  return crypto.createHmac('sha256', deriveKeys(secret).hmac).update(`${String(platform || '').toLowerCase()}|${identifier}`, 'utf8').digest('hex');
}

function encryptPayload(payload, secret) {
  const { encryption } = deriveKeys(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryption, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.from(JSON.stringify({ v: 1, iv: iv.toString('base64url'), tag: tag.toString('base64url'), data: ciphertext.toString('base64url') }), 'utf8');
}

function decryptPayload(value, secret) {
  const { encryption } = deriveKeys(secret);
  const text = Buffer.isBuffer(value)
    ? value.toString('utf8')
    : value instanceof Uint8Array
      ? Buffer.from(value).toString('utf8')
      : String(value);
  const record = JSON.parse(text);
  if (record.v !== 1 || !record.iv || !record.tag || !record.data) throw new Error('Invalid encrypted payload');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryption, Buffer.from(record.iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(record.tag, 'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(record.data, 'base64url')), decipher.final()]).toString('utf8'));
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

function randomToken(bytes = 32) { return crypto.randomBytes(bytes).toString('base64url'); }

function timingSafeEqualText(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function scryptHash(password) {
  if (typeof password !== 'string') throw new Error('Password must be a string');
  const salt = crypto.randomBytes(16);
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, derived) => err ? reject(err) : resolve(`$scrypt$N=16384,r=8,p=1$${salt.toString('base64url')}$${derived.toString('base64url')}`)));
}

function scryptVerify(password, encoded) {
  try {
    const match = /^\$scrypt\$N=(\d+),r=(\d+),p=(\d+)\$([^$]+)\$([^$]+)$/.exec(String(encoded));
    if (!match || !Number.isSafeInteger(Number(match[1])) || !Number.isSafeInteger(Number(match[2])) || !Number.isSafeInteger(Number(match[3]))) return Promise.resolve(false);
    const salt = Buffer.from(match[4], 'base64url');
    const expected = Buffer.from(match[5], 'base64url');
    return new Promise((resolve, reject) => crypto.scrypt(String(password), salt, expected.length, { N: Number(match[1]), r: Number(match[2]), p: Number(match[3]), maxmem: 64 * 1024 * 1024 }, (err, actual) => {
      if (err) return reject(err);
      resolve(actual.length === expected.length && crypto.timingSafeEqual(actual, expected));
    }));
  } catch { return Promise.resolve(false); }
}

function decimalToMinor(value, { allowZero = true } = {}) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(value)) throw new Error('Money must be a decimal naira string');
  const [whole, fraction = ''] = value.split('.');
  const minor = BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
  if (!allowZero && minor <= 0n) throw new Error('Money must be positive');
  if (minor > MAX_SAFE_BIGINT) throw new Error('Money is too large');
  return minor;
}

function minorToDecimal(value) {
  const minor = typeof value === 'bigint' ? value : BigInt(value);
  if (minor < 0n || minor > MAX_SAFE_BIGINT) throw new Error('Money is outside JSON-safe range');
  return `${minor / 100n}.${String(minor % 100n).padStart(2, '0')}`;
}

function calculateRetail({ costMinor, mode, value }) {
  const normalizedMode = String(mode || '').toUpperCase();
  const valueMinor = decimalToMinor(String(value), { allowZero: true });
  if (normalizedMode === 'MANUAL' || normalizedMode === 'FIXED') {
    if (normalizedMode === 'MANUAL') {
      if (valueMinor <= 0n) throw new Error('Retail must be positive');
      return valueMinor;
    }
    if (costMinor === null || costMinor === undefined) throw new Error('Cost is required for fixed pricing');
    const cost = BigInt(costMinor);
    if (cost < 0n || cost > MAX_SAFE_BIGINT) throw new Error('Cost is outside JSON-safe range');
    const retail = cost + valueMinor;
    if (retail <= 0n || retail > MAX_SAFE_BIGINT) throw new Error('Retail is outside JSON-safe range');
    return retail;
  }
  if (normalizedMode !== 'PERCENT') throw new Error('Unknown pricing mode');
  if (costMinor === null || costMinor === undefined) throw new Error('Cost is required for percentage pricing');
  const cost = typeof costMinor === 'bigint' ? costMinor : BigInt(costMinor);
  if (cost < 0n || cost > MAX_SAFE_BIGINT) throw new Error('Cost is outside JSON-safe range');
  const basisPoints = valueMinor; // value is represented as percent with two decimal places: 12.50 => 1250bp.
  if (basisPoints > 100000n) throw new Error('Percentage markup cannot exceed 1000%');
  const retail = cost + ((cost * basisPoints + 9999n) / 10000n);
  if (retail <= 0n || retail > MAX_SAFE_BIGINT) throw new Error('Retail is outside JSON-safe range');
  return retail;
}

module.exports = {
  SECRET_MIN, inventorySecret, deriveKeys, csrfToken, canonicalize, canonicalPayload, fingerprintPayload, identityFingerprint,
  encryptPayload, decryptPayload, hashSessionToken, randomToken, timingSafeEqualText, scryptHash, scryptVerify,
  decimalToMinor, minorToDecimal, calculateRetail,
};