const router = require('express').Router();
const prisma = require('../db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// GET /api/v1/dashboard/summary — all figures come from the DB, never hardcoded.
router.get('/summary', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const [wallet, totalOrders, activeNumbers, unread, recentOrders, recentTx] = await Promise.all([
      prisma.wallet.findUnique({ where: { userId } }),
      prisma.order.count({ where: { userId } }),
      prisma.orderItem.count({
        where: { order: { userId, status: 'COMPLETED' }, product: { category: { slug: 'virtual-numbers' } } },
      }),
      prisma.notification.count({ where: { userId, readAt: null } }),
      prisma.order.findMany({ where: { userId }, select: { id: true, orderReference: true, subtotal: true, fees: true, total: true, currency: true, status: true, createdAt: true, updatedAt: true }, orderBy: { createdAt: 'desc' }, take: 5 }),
      prisma.walletTransaction.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 5 }),
    ]);
    res.json({
      walletBalance: wallet?.balance ?? 0,
      currency: wallet?.currency ?? 'NGN',
      totalOrders,
      activeNumbers,
      unreadNotifications: unread,
      recentOrders,
      recentTransactions: recentTx,
    });
  } catch (e) { next(e); }
});

module.exports = router;
