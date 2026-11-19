const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const prisma = require('../db');
const { validate } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { hashPassword, verifyPassword, passwordWithinLimit, signToken, MAX_PASSWORD_BYTES } = require('../lib/auth');
const { cookieOptions } = require('../middleware/csrf');

router.use(requireAuth);

router.get('/me', (req, res) => {
  const { id, fullName, email, phoneNumber, role, status, createdAt } = req.user;
  res.json({ user: { id, fullName, email, phoneNumber, role, status, createdAt } });
});

const patchSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  phoneNumber: z.string().trim().min(7).max(20).optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'No fields to update' });

router.patch('/me', validate('body', patchSchema), async (req, res, next) => {
  try {
    const user = await prisma.user.update({ where: { id: req.user.id }, data: req.body });
    res.json({ user: { id: user.id, fullName: user.fullName, email: user.email, phoneNumber: user.phoneNumber } });
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'Phone number already in use' });
    next(e);
  }
});

const pwSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128)
    .refine(passwordWithinLimit, { message: `Password must not exceed ${MAX_PASSWORD_BYTES} bytes (long or non-English passwords count more)` }),
});

// Sensitive change: requires the current password (re-authentication).
// Changing the password revokes every other session; this device gets a fresh token.
// A stolen session must not be able to brute-force the current password.
const passwordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `user:${req.user?.id || req.ip}`,
  message: { error: 'Too many password attempts. Try again later.', code: 'RATE_LIMITED' },
});
router.patch('/me/password', passwordLimiter, validate('body', pwSchema), async (req, res, next) => {
  try {
    if (!(await verifyPassword(req.body.currentPassword, req.user.passwordHash))) {
      return res.status(403).json({ error: 'Current password is incorrect' });
    }
    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: { passwordHash: await hashPassword(req.body.newPassword), tokenVersion: { increment: 1 } },
    });
    const current = req.cookies?.token;
    if (current) {
      // Keep the same remaining lifetime as the session being replaced.
      const exp = Number(jwt.decode(current)?.exp);
      const remaining = Number.isFinite(exp)
        ? Math.max(60, Math.min(exp - Math.floor(Date.now() / 1000), 7 * 24 * 60 * 60))
        : 60 * 60;
      res.cookie('token', signToken(updated, { expiresInSeconds: remaining }), { ...cookieOptions(), maxAge: remaining * 1000 });
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
