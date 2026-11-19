'use strict';

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const COOKIE = 'ej_customer_csrf';

// The site and API are served from one origin, so cookies do not need to cross sites.
// SameSite=Lax is the safe default; set COOKIE_SAMESITE=none only if a separate site must call the API.
function sameSiteMode() {
  const value = String(process.env.COOKIE_SAMESITE || 'lax').trim().toLowerCase();
  return ['lax', 'strict', 'none'].includes(value) ? value : 'lax';
}
function cookieOptions() {
  const local = process.env.CUSTOMER_LOCAL_HTTP === '1' || process.env.ADMIN_LOCAL_HTTP === '1';
  if (local && config.env === 'production') throw new Error('Local HTTP cookies are prohibited in production');
  return { httpOnly: true, secure: !local, sameSite: local ? 'lax' : sameSiteMode(), path: '/' };
}
function tokenFor(seed, session = '') {
  return crypto.createHmac('sha256', config.jwtSecret).update(`${seed}|${session}`).digest('base64url');
}
function csrfEndpoint(req, res) {
  let seed = req.cookies?.[COOKIE];
  if (typeof seed !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(seed)) {
    seed = crypto.randomBytes(32).toString('base64url');
    res.cookie(COOKIE, seed, { ...cookieOptions(), maxAge: 24 * 60 * 60 * 1000 });
  }
  res.set('Cache-Control', 'private, no-store').json({ csrfToken: tokenFor(seed, req.cookies?.token || '') });
}
function csrfProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // Bearer-only server API calls are not ambient-cookie authentication. Validate
  // the signature before allowing this path; a made-up header cannot bypass CSRF.
  const authorization = req.headers.authorization || '';
  if (!req.cookies?.token && authorization.startsWith('Bearer ')) {
    try { jwt.verify(authorization.slice(7), config.jwtSecret, { algorithms: ['HS256'] }); return next(); }
    catch { return res.status(401).json({ error: 'Invalid bearer session' }); }
  }
  const seed = req.cookies?.[COOKIE];
  const supplied = req.get('X-CSRF-Token') || '';
  if (typeof seed !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(seed)) return res.status(403).json({ error: 'Refresh the security token and try again', code: 'CSRF_INVALID' });
  const expected = tokenFor(seed, req.cookies?.token || '');
  const a = Buffer.from(supplied); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(403).json({ error: 'Refresh the security token and try again', code: 'CSRF_INVALID' });
  return next();
}
module.exports = { csrfEndpoint, csrfProtection, cookieOptions, tokenFor, COOKIE };
