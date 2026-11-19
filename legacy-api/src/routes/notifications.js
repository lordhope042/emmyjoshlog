const router = require('express').Router();
const prisma = require('../db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ notifications, unread: notifications.filter(n => !n.readAt).length });
  } catch (e) { next(e); }
});

router.patch('/:id/read', async (req, res, next) => {
  try {
    await prisma.notification.updateMany({
      where: { id: req.params.id, userId: req.user.id },
      data: { readAt: new Date() },
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/read-all', async (req, res, next) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user.id, readAt: null },
      data: { readAt: new Date() },
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
