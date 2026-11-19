const router = require('express').Router();
const { z } = require('zod');
const prisma = require('../db');
const { validate } = require('../middleware/validate');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { audit } = require('../lib/audit');
const { refundOrder } = require('../../../backend/commerce/service');

// Role check on EVERY admin route — enforced server-side, never by hiding UI links.
router.use(requireAuth, requireAdmin);

// This router is read-mostly on purpose. Product, pricing, inventory and order-state changes
// go through the admin console (/api/admin-tools) and the commerce service, which keep stock
// encrypted and keep wallet/order state consistent. The old product create/edit, inventory
// upload and free-form order-status endpoints are removed because they bypassed both.

// GET /api/v1/admin/summary — dashboard aggregates.
router.get('/summary', async (_req, res, next) => {
  try {
    const [customers, orders, revenue, pendingTickets] = await Promise.all([
      prisma.user.count({ where: { role: 'CUSTOMER' } }),
      prisma.order.count(),
      prisma.order.aggregate({ _sum: { total: true }, where: { status: 'COMPLETED' } }),
      prisma.supportTicket.count({ where: { status: 'OPEN' } }),
    ]);
    res.json({ customers, orders, revenue: revenue._sum.total ?? 0, pendingTickets });
  } catch (e) { next(e); }
});

// Customers
router.get('/customers', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase().slice(0, 100);
    const customers = await prisma.user.findMany({
      where: { role: 'CUSTOMER', ...(q ? { OR: [{ fullName: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] } : {}) },
      select: { id: true, fullName: true, email: true, phoneNumber: true, status: true, createdAt: true,
                wallet: { select: { balance: true, currency: true } } },
      take: 100,
    });
    res.json({ customers });
  } catch (e) { next(e); }
});

const suspendSchema = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']) });
router.patch('/customers/:id/status', validate('body', suspendSchema), async (req, res, next) => {
  try {
    const before = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!before) return res.status(404).json({ error: 'Customer not found' });
    // Only customer accounts can be suspended here: never an administrator, and never yourself.
    if (before.role !== 'CUSTOMER' || before.id === req.user.id) {
      return res.status(403).json({ error: 'Only customer accounts can be suspended from this endpoint' });
    }
    const after = await prisma.user.update({
      where: { id: before.id },
      // Suspending also signs the customer out everywhere by revoking issued tokens.
      data: { status: req.body.status, ...(req.body.status === 'SUSPENDED' ? { tokenVersion: { increment: 1 } } : {}) },
    });
    await audit(req.user.id, 'customer.status_change', 'User', after.id, { status: before.status }, { status: after.status });
    res.json({ ok: true, status: after.status });
  } catch (e) { next(e); }
});

// Orders
router.get('/orders', async (_req, res, next) => {
  try {
    res.json({ orders: await prisma.order.findMany({ include: { items: true, user: { select: { fullName: true, email: true } } }, orderBy: { createdAt: 'desc' }, take: 100 }) });
  } catch (e) { next(e); }
});

// Wallet-backed refund (debits/credits and inventory are handled atomically by the commerce service).
router.post('/orders/:id/refund', async (req, res, next) => {
  try {
    const result = await refundOrder({
      db: prisma,
      orderId: req.params.id,
      actorId: req.user.id,
      reason: typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 500) : null,
      providerRefundConfirmed: false,
    });
    res.status(result.replayed ? 200 : 201).json({ order: result.order, replayed: result.replayed });
  } catch (e) { next(e); }
});

// Transactions & virtual accounts (read-only review)
router.get('/transactions', async (_req, res, next) => {
  try {
    res.json({ transactions: await prisma.walletTransaction.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }) });
  } catch (e) { next(e); }
});

router.get('/virtual-accounts', async (_req, res, next) => {
  try {
    res.json({ accounts: await prisma.virtualAccount.findMany({ include: { user: { select: { fullName: true, email: true } } }, orderBy: { createdAt: 'desc' }, take: 200 }) });
  } catch (e) { next(e); }
});

// Audit logs
router.get('/audit-logs', async (_req, res, next) => {
  try {
    res.json({ logs: await prisma.adminAuditLog.findMany({ include: { actor: { select: { fullName: true, email: true } } }, orderBy: { createdAt: 'desc' }, take: 100 }) });
  } catch (e) { next(e); }
});

// Support
router.get('/support/tickets', async (_req, res, next) => {
  try {
    res.json({ tickets: await prisma.supportTicket.findMany({ include: { user: { select: { fullName: true, email: true } }, messages: true }, orderBy: { updatedAt: 'desc' }, take: 200 }) });
  } catch (e) { next(e); }
});

module.exports = router;
