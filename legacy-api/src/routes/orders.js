const router = require('express').Router();
const { z } = require('zod');
const prisma = require('../db');
const { validate } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { httpError } = require('../middleware/error');
const { createCheckout, getOrderDelivery } = require('../../../backend/commerce/service');

router.use(requireAuth);

const createSchema = z.object({
  productId: z.string().min(1).max(191),
  quantity: z.coerce.number().int().min(1).max(100000).default(1),
  expectedUnitPriceMinor: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).optional(),
});

const orderInclude = { items: { include: { product: { include: { category: { select: { name: true, slug: true } } } } } } };

function idempotencyKey(req) {
  const value = req.get('Idempotency-Key');
  if (!value || value.length > 255) throw httpError(400, 'A valid Idempotency-Key header is required');
  return value;
}

// Logs only slow requests, and never logs user-controlled values.
async function timed(label, work) {
  const start = Date.now();
  try {
    return await work();
  } finally {
    const elapsed = Date.now() - start;
    if (elapsed > 1500) console.warn(`SLOW ${label} ${elapsed}ms`);
  }
}

// POST /api/v1/orders — exact-price, wallet-atomic checkout delegated to commerce service.
router.post('/', validate('body', createSchema), async (req, res, next) => {
  try {
    const result = await createCheckout({
      db: prisma,
      userId: req.user.id,
      productId: req.body.productId,
      quantity: req.body.quantity,
      expectedUnitPriceMinor: req.body.expectedUnitPriceMinor,
      idempotencyKey: idempotencyKey(req),
    });
    res.status(result.replayed ? 200 : 201).json({ order: result.order });
  } catch (e) { next(e); }
});

router.get('/', async (req, res, next) => {
  try {
    // Bounded page. Pass ?limit= (max 100) and ?cursor=<last order id> for older orders.
    const take = Math.min(Math.max(parseInt(req.query.limit || '50', 10) || 50, 1), 100);
    const cursor = typeof req.query.cursor === 'string' && req.query.cursor.length <= 191 ? req.query.cursor : null;
    const rows = await prisma.order.findMany({
      where: { userId: req.user.id },
      include: orderInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > take;
    const orders = hasMore ? rows.slice(0, take) : rows;
    res.json({ orders, nextCursor: hasMore ? orders[orders.length - 1].id : null });
  } catch (e) { next(e); }
});

// Delivery is deliberately separate from list/detail responses and is never admin/public data.
router.get('/:id/delivery', async (req, res, next) => {
  try {
    const delivery = await timed('GET /orders/:id/delivery', () =>
      getOrderDelivery({ db: prisma, orderId: req.params.id, userId: req.user.id }));
    res.set('Cache-Control', 'private, no-store');
    res.json(delivery);
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const order = await timed('GET /orders/:id', () =>
      prisma.order.findFirst({
        where: { id: req.params.id, userId: req.user.id },
        include: orderInclude,
      }));
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json({ order });
  } catch (e) { next(e); }
});

module.exports = router;
