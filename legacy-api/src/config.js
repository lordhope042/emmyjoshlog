'use strict';
require('./load-env');
const crypto = require('node:crypto');

function signingSecret(env = process.env) {
  if (env.JWT_SECRET) {
    if (env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
    return env.JWT_SECRET;
  }
  if ((env.INVENTORY_ENCRYPTION_KEY_V1 || '').length >= 32) {
    return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(env.INVENTORY_ENCRYPTION_KEY_V1), Buffer.from('emmyjosh-customer-auth-v1'), Buffer.from('jwt-signing-v1'), 32)).toString('hex');
  }
  throw new Error('Configure a strong JWT_SECRET or INVENTORY_ENCRYPTION_KEY_V1; no default signing secret exists');
}
const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '5000', 10),
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: signingSecret(),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  clientUrl: process.env.CLIENT_URL || ''
};
if (!config.databaseUrl) throw new Error('DATABASE_URL is required');
if (process.env.MOCK_POCKETFI === 'true') throw new Error('MOCK_POCKETFI is not supported; unauthenticated mock credits are prohibited');
module.exports = config;
Object.defineProperty(module.exports, 'signingSecret', { value: signingSecret });
