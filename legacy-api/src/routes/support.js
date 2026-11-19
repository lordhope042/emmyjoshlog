const router = require('express').Router();
const { z } = require('zod');
const prisma = require('../db');
const { validate } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

const ticketSchema = z.object({
  subject: z.string().trim().min(3).max(160),
  body: z.string().trim().min(3).max(4000),
});

router.post('/tickets', validate('body', ticketSchema), async (req, res, next) => {
  try {
    const ticket = await prisma.supportTicket.create({
      data: {
        userId: req.user.id,
        subject: req.body.subject,
        messages: { create: [{ senderRole: 'CUSTOMER', body: req.body.body }] },
      },
      include: { messages: true },
    });
    res.status(201).json({ ticket });
  } catch (e) { next(e); }
});

router.get('/tickets', async (req, res, next) => {
  try {
    const tickets = await prisma.supportTicket.findMany({
      where: { userId: req.user.id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ tickets });
  } catch (e) { next(e); }
});

module.exports = router;
