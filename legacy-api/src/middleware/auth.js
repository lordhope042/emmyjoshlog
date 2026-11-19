'use strict';
const jwt = require('jsonwebtoken');
const config = require('../config');
const prisma = require('../db');

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = req.cookies?.token || (header.startsWith('Bearer ') ? header.slice(7) : null);
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string') return res.status(401).json({ error: 'Invalid session' });
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== 'ACTIVE') return res.status(401).json({ error: 'Account unavailable' });
    // A token is only valid for the tokenVersion it was issued under. Logout and password
    // change bump the version, which revokes every earlier token. Both sides default to 0, so
    // tokens issued before this check existed keep working until the first revocation.
    if ((Number(payload.tv) || 0) !== (Number(user.tokenVersion) || 0)) return res.status(401).json({ error: 'Session expired. Please sign in again.' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'ADMIN') return res.status(403).json({ error: 'Administrator access required' });
  next();
}
module.exports = { requireAuth, requireAdmin };
