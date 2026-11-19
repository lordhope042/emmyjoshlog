'use strict';

const router = require('express').Router();
const { z } = require('zod');
const prisma = require('../db');
const { validate } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const pocketfi = require('../services/pocketfi');

router.use(requireAuth);

// GET /api/v1/wallet
router.get('/', async (req, res, next) => {
  try {
    const wallet = await prisma.wallet.findUnique({ where: { userId: req.user.id } });
    res.json({ wallet: { balance: wallet?.balance ?? 0, currency: wallet?.currency ?? 'NGN' } });
  } catch (e) { next(e); }
});

// GET /api/v1/wallet/transactions — the ledger (append-only).
router.get('/transactions', async (req, res, next) => {
  try {
    const take = Math.min(parseInt(req.query.limit || '50', 10) || 50, 100);
    const transactions = await prisma.walletTransaction.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take,
    });
    res.json({ transactions });
  } catch (e) { next(e); }
});

// GET /api/v1/wallet/virtual-account — current account details (or null).
router.get('/virtual-account', async (req, res, next) => {
  try {
    const account = await prisma.virtualAccount.findUnique({ where: { userId: req.user.id } });
    res.json({ virtualAccount: account });
  } catch (e) { next(e); }
});

router.get('/virtual-account/status', async (req, res, next) => {
  try {
    const account = await prisma.virtualAccount.findUnique({ where: { userId: req.user.id } });
    res.json({ status: account?.status ?? 'NONE' });
  } catch (e) { next(e); }
});

// The UI does not collect KYC. The only accepted input is an optional legacy
// phone override; provider request fields are assembled from the authenticated
// customer and the server-side PocketFi configuration.
const createSchema = z.preprocess(
  (value) => (value == null ? {} : value),
  z.object({ phoneNumber: z.string().trim().min(7).max(20).optional() }).strict(),
);

// POST /api/v1/wallet/virtual-account
// Creation is serialized before the provider call. REQUESTED/DISPATCHED and
// UNKNOWN operations are never retried blindly because PocketFi does not expose
// a documented lookup that can safely match an unknown result to this customer.
router.post('/virtual-account', validate('body', createSchema), async (req, res, next) => {
  try {
    const existing = await prisma.virtualAccount.findUnique({ where: { userId: req.user.id } });
    if (existing) return res.json({ virtualAccount: existing, created: false, message: 'Virtual account already exists' });

    const account = await pocketfi.createDedicatedAccount({
      user: req.user,
      phoneNumber: req.body.phoneNumber || req.user.phoneNumber,
      db: prisma,
    });
    return res.status(201).json({ virtualAccount: account, created: true });
  } catch (error) {
    if (error.code === 'POCKETFI_RECONCILIATION_REQUIRED') {
      return res.status(409).json({
        error: error.message,
        status: error.operationState || 'UNKNOWN',
        reconciliationRequired: true,
      });
    }
    return next(error);
  }
});

module.exports = router;
