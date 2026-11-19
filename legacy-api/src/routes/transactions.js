const router = require('express').Router();
const prisma = require('../db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// GET /api/v1/transactions — customer transaction history (append-only ledger view).
router.get('/', async (req, res, next) => {
  try {
    const take = Math.min(parseInt(req.query.limit || '50', 10) || 50, 100);
    const transactions = await prisma.walletTransaction.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true, type: true, amount: true, currency: true,
        reference: true, status: true, description: true, createdAt: true,
      },
    });
    res.json({ transactions });
  } catch (e) { next(e); }
});

module.exports = router;
