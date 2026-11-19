const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const prisma = require('../db');
const { hashPassword, verifyPassword, verifyAgainstDummy, passwordWithinLimit, signToken, MAX_PASSWORD_BYTES } = require('../lib/auth');
const { validate } = require('../middleware/validate');
const config = require('../config');
const { cookieOptions, COOKIE: CSRF_COOKIE } = require('../middleware/csrf');

// Rate limit auth endpoints to blunt credential stuffing.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true });

// Per-account throttle. Keyed on IP + identifier so one attacker cannot lock a real customer out
// from another address, but cannot guess many passwords for one account either. Successful logins
// do not count against the limit.
const accountLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${req.ip}|${String(req.body?.identifier || '').trim().toLowerCase().slice(0, 191)}`,
  message: { error: 'Too many sign-in attempts. Please wait a few minutes and try again.', code: 'RATE_LIMITED' },
});

const strongPassword = z.string().min(8).max(128)
  .refine(passwordWithinLimit, { message: `Password must not exceed ${MAX_PASSWORD_BYTES} bytes (long or non-English passwords count more)` });

const registerSchema = z.object({
  // A first and last name are required: the PocketFi virtual account needs both.
  fullName: z.string().trim().min(2).max(120).refine((value) => /\S+\s+\S+/.test(value), { message: 'Enter your first and last name' }),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,30}$/, { message: 'Username must be 3-30 characters using letters, numbers, or underscores' }),
  email: z.string().trim().toLowerCase().email(),
  phoneNumber: z.string().trim().min(7).max(20),
  password: strongPassword,
  confirmPassword: z.string(),
}).refine(d => d.password === d.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] });

function setTokenCookie(res, token, rememberMe = false) {
  res.cookie('token', token, {
    ...cookieOptions(),
    maxAge: rememberMe ? 7 * 24 * 60 * 60 * 1000 : 60 * 60 * 1000,
  });
}

// POST /api/v1/auth/register — creates a CUSTOMER account + empty wallet.
// NOTE: per approved flow, no PocketFi virtual account is created here.
router.post('/register', authLimiter, validate('body', registerSchema), async (req, res, next) => {
  try {
    const { fullName, username, email, phoneNumber, password } = req.body;
    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { phoneNumber }, { username }] },
      select: { id: true, email: true, phoneNumber: true, username: true },
    });
    // Do not reveal which field exists.
    if (existing) return res.status(409).json({ error: 'An account with those details already exists' });

    const user = await prisma.user.create({
      data: {
        fullName, username, email, phoneNumber,
        passwordHash: await hashPassword(password),
        role: 'CUSTOMER',
        wallet: { create: { currency: 'NGN', balance: 0 } },
      },
    });
    setTokenCookie(res, signToken(user));
    res.status(201).json({ user: { id: user.id, fullName: user.fullName, username: user.username, email: user.email, role: user.role } });
  } catch (e) {
    // A concurrent signup can pass the pre-check; do not expose database details.
    if (e?.code === 'P2002') return res.status(409).json({ error: 'An account with those details already exists', code: 'ACCOUNT_CONFLICT' });
    next(e);
  }
});

const loginSchema = z.object({
  identifier: z.string().trim().min(3).max(191), // email OR phone
  password: z.string().min(1).max(128),
  rememberMe: z.boolean().optional(),
});

router.post('/login', authLimiter, validate('body', loginSchema), accountLoginLimiter, async (req, res, next) => {
  try {
    const id = req.body.identifier.toLowerCase();
    const user = await prisma.user.findFirst({
      where: { OR: [{ email: id }, { phoneNumber: req.body.identifier }, { username: id }] },
    });
    // Same generic error and the same work whether or not the account exists.
    const valid = user ? await verifyPassword(req.body.password, user.passwordHash) : await verifyAgainstDummy(req.body.password);
    if (!user || !valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (user.status !== 'ACTIVE') return res.status(403).json({ error: 'Account suspended. Contact support.' });
    setTokenCookie(res, signToken(user, { rememberMe: Boolean(req.body.rememberMe) }), Boolean(req.body.rememberMe));
    res.json({ user: { id: user.id, fullName: user.fullName, username: user.username, email: user.email, role: user.role } });
  } catch (e) { next(e); }
});

// Logout revokes the session on the server, not just in the browser: bumping tokenVersion
// invalidates every token issued before (this also signs the account out of other devices).
router.post('/logout', async (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    const token = req.cookies?.token || (header.startsWith('Bearer ') ? header.slice(7) : null);
    if (token) {
      try {
        const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
        if (typeof payload.sub === 'string') {
          await prisma.user.update({ where: { id: payload.sub }, data: { tokenVersion: { increment: 1 } } });
        }
      } catch (error) {
        // Expired/invalid tokens are already unusable. Anything else (for example the
        // tokenVersion column not migrated yet) must not be silent.
        if (error?.name !== 'TokenExpiredError' && error?.name !== 'JsonWebTokenError') {
          console.warn('Session revocation failed: run the database migration and prisma generate.');
        }
      }
    }
    res.clearCookie('token', cookieOptions());
    res.clearCookie(CSRF_COOKIE, cookieOptions());
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.get('/me', require('../middleware/auth').requireAuth, (req, res) => {
  const { id, fullName, username, email, phoneNumber, role, status, createdAt } = req.user;
  res.json({ user: { id, fullName, username, email, phoneNumber, role, status, createdAt } });
});

// TODO: forgot-password / reset-password — send a time-limited, single-use
// token via email/SMS provider; never reveal whether an identifier exists.

module.exports = router;
