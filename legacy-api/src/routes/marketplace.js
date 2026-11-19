const router = require('express').Router();
const { z } = require('zod');
const prisma = require('../db');
const { validate } = require('../middleware/validate');

// GET /api/v1/categories — only the two approved categories.
router.get('/categories', async (_req, res, next) => {
  try {
    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
    res.json({ categories: await prisma.productCategory.findMany({ where: { status: 'ACTIVE' } }) });
  } catch (e) { next(e); }
});

const listSchema = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(60).optional(),
  sort: z.enum(['popular', 'price_asc', 'price_desc', 'newest']).default('popular'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// GET /api/v1/products — search, filter, sort. Only ACTIVE products with stock.
router.get('/products', validate('query', listSchema), async (req, res, next) => {
  try {
    const { q, category, sort, page, limit } = req.query;
    const where = {
      status: 'ACTIVE',
      ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }] } : {}),
      ...(category ? { category: { slug: category } } : {}),
      inventory: { some: { status: 'AVAILABLE' } }, // available only if backend confirms stock
    };
    const orderBy =
      sort === 'price_asc' ? { price: 'asc' } :
      sort === 'price_desc' ? { price: 'desc' } :
      sort === 'newest' ? { createdAt: 'desc' } :
      { createdAt: 'desc' };
    const [items, total] = await Promise.all([
      prisma.product.findMany({
        where, orderBy, skip: (page - 1) * limit, take: limit,
        include: { category: { select: { name: true, slug: true } }, _count: { select: { inventory: { where: { status: 'AVAILABLE' } } } } },
      }),
      prisma.product.count({ where }),
    ]);
    res.set('Cache-Control', 'public, max-age=10, stale-while-revalidate=30');
    res.json({ products: items, page, limit, total, pages: Math.ceil(total / limit) });
  } catch (e) { next(e); }
});

// GET /api/v1/products/:id
router.get('/products/:id', async (req, res, next) => {
  try {
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, status: 'ACTIVE' },
      include: {
        category: { select: { name: true, slug: true } },
        _count: { select: { inventory: { where: { status: 'AVAILABLE' } } } },
      },
    });
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.set('Cache-Control', 'public, max-age=10, stale-while-revalidate=30');
    res.json({ product });
  } catch (e) { next(e); }
});

module.exports = router;
