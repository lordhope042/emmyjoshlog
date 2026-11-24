const router = require('express').Router();
const prisma = require('../db');
const { requireAuth } = require('../middleware/auth');
const { listBroadcasts, markBroadcastRead, markAllBroadcastsRead, isBroadcastId } = require('../lib/broadcasts');

router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const [own, announcements] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: req.user.id },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      listBroadcasts(prisma, req.user.id),
    ]);
    // Admin announcements (with optional link buttons) and personal notices, newest first.
    const notifications = [...announcements, ...own].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ notifications, unread: notifications.filter(n => !n.readAt).length });
  } catch (e) { next(e); }
});

router.patch('/:id/read', async (req, res, next) => {
  try {
    if (isBroadcastId(req.params.id)) {
      await markBroadcastRead(prisma, req.user.id, req.params.id);
      return res.json({ ok: true });
    }
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
    await markAllBroadcastsRead(prisma, req.user.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
