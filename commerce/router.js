'use strict';

const express = require('express');
const { refundOrder } = require('./service');
const { decryptPayload } = require('../crypto');

// One query for the whole admin orders list: the order, its customer, its first line item, and the
// checkout/provider record (source, provider state, request details, encrypted number session).
const ORDERS_SQL = `SELECT o.id, o.userId, o.orderReference, o.total, o.currency, o.status, o.createdAt, o.updatedAt,
       u.email AS userEmail, u.fullName AS userName,
       c.source AS source, c.provider AS provider, c.state AS providerState, c.request_payload AS requestPayload,
       c.session_state_ciphertext AS sessionCipher, c.refund_reference AS refundReference,
       (SELECT i.productNameSnapshot FROM OrderItem i WHERE i.orderId = o.id ORDER BY i.id LIMIT 1) AS productName
FROM \`Order\` o
LEFT JOIN \`User\` u ON u.id = o.userId
LEFT JOIN ej_checkout_orders c ON c.order_id = o.id
ORDER BY o.createdAt DESC LIMIT ?`;

function readNumberSession(cipher) {
  const key = process.env.INVENTORY_ENCRYPTION_KEY_V1;
  if (!cipher || typeof key !== 'string' || key.length < 32) return null;
  try { return decryptPayload(cipher, key); } catch { return null; }
}

// The admin sees that a number exists and whether its SMS arrived, never the full number or the code itself.
function maskPhone(phone) {
  const digits = String(phone || '').replace(/\s+/g, '');
  if (!digits) return null;
  if (digits.length <= 6) return '••••';
  return `${digits.slice(0, 3)}${'•'.repeat(Math.max(digits.length - 6, 3))}${digits.slice(-3)}`;
}

function parseJson(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value === 'string') { try { return JSON.parse(value); } catch { return null; } }
  return null;
}

function shapeAdminOrder(row) {
  const source = row.source || 'OWN';
  const isNumber = source === 'NUMBER';
  const request = parseJson(row.requestPayload) || {};
  const session = isNumber ? (readNumberSession(row.sessionCipher) || {}) : {};
  const messages = Array.isArray(session.messages) ? session.messages : [];
  const received = messages.length > 0 || Boolean(session.code);
  const status = String(row.status || '');
  return {
    id: row.id,
    userId: row.userId,
    orderReference: row.orderReference,
    total: String(row.total),
    currency: row.currency,
    status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    userEmail: row.userEmail || null,
    userName: row.userName || null,
    source,
    type: isNumber ? 'NUMBER' : 'LOG',
    provider: row.provider || null,
    providerState: row.providerState || null,
    productName: row.productName || null,
    country: session.country || request.country || null,
    service: session.serviceName || session.service || request.serviceName || request.service || null,
    operator: request.operator || null,
    phoneMasked: isNumber ? maskPhone(session.phone || session.number) : null,
    sms: isNumber ? { received, count: messages.length || (session.code ? 1 : 0), status: session.status || null } : null,
    refunded: status === 'REFUNDED' || Boolean(row.refundReference),
    // Number orders are refunded by the provider flow, not by an admin button.
    refundable: !isNumber && !['REFUNDED', 'FAILED'].includes(status),
  };
}


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
      const result = await rows(ORDERS_SQL, [limit]);
      res.json({ orders: result.map(shapeAdminOrder) });
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

module.exports = { createCommerceRouter, shapeAdminOrder, ORDERS_SQL };
