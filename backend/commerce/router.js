'use strict';

const express = require('express');
const { refundOrder } = require('./service');

function createCommerceRouter(options = {}) {
  const router = express.Router();
  const db = options.db;
  const rows = async (sql, params = []) => {
    const result = await (db || options.pool).query(sql, params);
    return Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
  };
  router.get('/orders', async (req, res, next) => {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 100);
      const orders = await rows('SELECT id,userId,orderReference,total,currency,status,createdAt,updatedAt FROM `Order` ORDER BY createdAt DESC LIMIT ?', [limit]);
      res.json({ orders: orders.map(order => ({ id: order.id, userId: order.userId, orderReference: order.orderReference, total: String(order.total), currency: order.currency, status: order.status, createdAt: order.createdAt, updatedAt: order.updatedAt })) });
    } catch (e) { next(e); }
  });
  router.post('/orders/:id/refund', async (req, res, next) => {
    try {
      const result = await refundOrder({ orderId: req.params.id, actorId: req.admin.id, reason: typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 500) : null, providerRefundConfirmed: false, db });
      res.status(result.replayed ? 200 : 201).json(result);
    } catch (e) { next(e); }
  });
  return router;
}

module.exports = { createCommerceRouter };
