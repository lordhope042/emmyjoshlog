'use strict';
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');

const MAX_PASSWORD_BYTES = 72; // bcrypt ignores everything past 72 bytes

// Compared against when no account exists, so an unknown identifier costs the same
// time as a wrong password and login timing does not reveal which accounts exist.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 12);

function passwordWithinLimit(plain) {
  return typeof plain === 'string' && Buffer.byteLength(plain, 'utf8') <= MAX_PASSWORD_BYTES;
}
async function hashPassword(plain) {
  if (!passwordWithinLimit(plain)) throw new Error('Password must not exceed 72 UTF-8 bytes');
  return bcrypt.hash(plain, 12);
}
async function verifyPassword(plain, hash) { return bcrypt.compare(plain, hash); }
async function verifyAgainstDummy(plain) {
  await bcrypt.compare(String(plain ?? ''), DUMMY_HASH);
  return false;
}

// `tv` is the user's tokenVersion: bumping it (logout, password change) revokes every
// token issued before. Tokens issued before this field existed carry no `tv` and count as 0.
function signToken(user, { rememberMe = false, expiresInSeconds } = {}) {
  const expiresIn = Number.isFinite(expiresInSeconds) ? expiresInSeconds : (rememberMe ? config.jwtExpiresIn : '1h');
  return jwt.sign({ sub: user.id, role: user.role, tv: user.tokenVersion ?? 0 }, config.jwtSecret, { algorithm: 'HS256', expiresIn });
}
module.exports = { hashPassword, verifyPassword, verifyAgainstDummy, passwordWithinLimit, signToken, MAX_PASSWORD_BYTES };
