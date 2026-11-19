'use strict';

const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('node:crypto');
const { requireAuth } = require('../../legacy-api/src/middleware/auth');
const { calculateRetail } = require('../crypto');
const { config } = require('./config');
const { createQuote, findQuote } = require('./quotes');
const { ceilProviderToMinor, retailFromMarkup, asPositiveMinor, opaqueSelection } = require('./money');
const { createDonAdapter } = require('./don');
const { create5SimAdapter } = require('./fivesim');
const { createSMSBowerAdapter } = require('./smsbower');
const { ProviderTransportError } = require('./transport');
const { getPool } = require('../db');

function dbOf(db) { return db || getPool(); }
async function rows(db, sql, params = []) { const result = await dbOf(db).query(sql, params); return result[0]; }
function idempotency(req) {
  const value = req.get('Idempotency-Key');
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{8,200}$/.test(value)) throw httpError(400, 'idempotency_key_required', 'A valid Idempotency-Key is required');
  return value;
}
function httpError(status, code, message) { const error = new Error(message); error.status = status; error.code = code; return error; }
function requirePositiveInt(value, field, max = 10000) { const n = typeof value === 'number' ? value : Number(value); if (!Number.isSafeInteger(n) || n < 1 || n > max) throw httpError(400, 'invalid_request', `${field} is invalid`); return n; }
function safeProvider(number) { if (!['1', '2', 1, 2].includes(number)) throw httpError(400, 'invalid_provider', 'Provider is invalid'); return Number(number); }
function errorMessage(error) { return error instanceof ProviderTransportError ? error.message : 'Provider request could not be completed'; }
function sendError(res, error) {
  const status = Number(error.status) || (error instanceof ProviderTransportError ? (error.status >= 400 && error.status < 500 ? error.status : 502) : 500);
  if (status >= 500) console.error(`provider error: ${error.code || 'internal_error'}`);
  return res.status(status).json({ error: { code: error.code || 'provider_error', message: status >= 500 ? 'The provider request could not be completed.' : error.message } });
}
function use(handler) { return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next); }
function safeOrder(order, record) {
  const source = order && typeof order === 'object' ? order : record || {};
  const allowed = ['id', 'orderId', 'orderReference', 'number', 'status', 'state', 'provider', 'source', 'kind', 'quantity', 'retailMinor', 'total', 'currency', 'createdAt', 'updatedAt'];
  const output = {};
  for (const key of allowed) if (source[key] !== undefined && source[key] !== null) output[key] = source[key];
  if (!output.id && record?.orderId) output.id = record.orderId;
  if (record?.state && !output.state) output.state = record.state;
  return output;
}
function safeSession(session) {
  if (!session || typeof session !== 'object') return null;
  const output = {};
  for (const key of ['id', 'phone', 'number', 'service', 'country', 'serviceName', 'status', 'code', 'expiresAt', 'messages']) {
    if (session[key] === undefined || session[key] === null) continue;
    if (key === 'messages' && Array.isArray(session[key])) output.messages = session[key].slice(0, 20).map((message) => {
      if (!message || typeof message !== 'object') return null;
      return Object.fromEntries(['sender', 'text', 'code', 'createdAt', 'created_at', 'date'].filter((name) => message[name] !== undefined).map((name) => [name === 'created_at' ? 'createdAt' : name, message[name]]));
    }).filter(Boolean);
    else output[key] = typeof session[key] === 'string' ? session[key].slice(0, 5000) : session[key];
  }
  return output;
}
function mergeSession(previous, current) {
  const oldValue = previous && typeof previous === 'object' ? previous : {};
  const newValue = current && typeof current === 'object' ? current : {};
  const merged = { ...oldValue, ...newValue };
  for (const key of ['phone', 'number', 'expiresAt']) if (newValue[key] === undefined || newValue[key] === null || newValue[key] === '') merged[key] = oldValue[key];
  if (!Array.isArray(newValue.messages) && Array.isArray(oldValue.messages)) merged.messages = oldValue.messages;
  return merged;
}
function numberStatusMayPoll(record) {
  if (!record?.providerRef || record.source !== 'NUMBER') return false;
  if (['REFUNDED', 'CANCELED', 'CANCELLED'].includes(String(record.state || '').toUpperCase())) return false;
  if (String(record.state || '').toUpperCase() === 'COMPLETED') return record.provider === 'SMSBOWER';
  return true;
}
function statusBody(cfg) {
  const providerStatus = Object.values(cfg.providers).map((item) => ({ provider: item.number, providerLabel: item.label, enabled: item.enabled, configured: Boolean(item.token && item.currency && item.rate && item.markup), quotesEnabled: item.ready, purchasesEnabled: item.ready && item.purchasesEnabled, currency: item.currency || null }));
  return { don: { enabled: cfg.don.enabled, configured: cfg.don.keyConfigured, mode: cfg.don.mode, modeValid: cfg.don.modeValid, deliveryContractConfirmed: cfg.don.deliveryContractConfirmed, purchasesEnabled: cfg.don.purchasesEnabled && cfg.don.enabled }, providers: providerStatus };
}
function providerName(number) { return Number(number) === 1 ? '5SIM' : Number(number) === 2 ? 'SMSBOWER' : 'DONMARKETPLACE'; }
function adaptersFor(cfg, options) {
  return {
    don: createDonAdapter({ envConfig: cfg.don, fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs }),
    1: create5SimAdapter({ envConfig: cfg.providers[1], fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs }),
    2: createSMSBowerAdapter({ envConfig: cfg.providers[2], fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs }),
  };
}
function normalizeRecord(value) {
  if (!value || typeof value !== 'object') return value;
  let requestPayload = value.requestPayload ?? value.request_payload;
  if (typeof requestPayload === 'string') { try { requestPayload = JSON.parse(requestPayload); } catch { requestPayload = {}; } }
  return { ...value, orderId: value.orderId ?? value.order_id, providerRef: value.providerRef ?? value.provider_ref, supplierKey: value.supplierKey ?? value.supplier_key, requestPayload: requestPayload || {} };
}
function commerceOf(options) {
  if (options.commerce) return options.commerce;
  // Intentionally lazy: the commerce owner may load provider routes during boot.
  return require('../commerce/service');
}
async function callCommerce(options, method, args) {
  const service = commerceOf(options); if (typeof service[method] !== 'function') throw new Error(`Commerce service export ${method} is unavailable`);
  if (method === 'claimExternalDispatch') return service[method](args.orderId, args.db);
  if (method === 'getExternalOrder') return service[method](args.orderId, { userId: args.userId, db: args.db });
  if (method === 'completeExternalOrder' || method === 'markExternalUncertain') return service[method](args.orderId, args, args.db);
  return service[method](args);
}
function providerReady(cfg, number, purchase = false) {
  const item = cfg.providers[number];
  if (!item || !item.ready || (purchase && !item.purchasesEnabled)) throw httpError(503, 'provider_disabled', 'This provider is not enabled');
  return item;
}
function parsePayload(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value === 'string') { try { return JSON.parse(value); } catch {} }
  return {};
}
async function existingExternalReplay(db, userId, key) {
  if (db?.__commerceMemory) {
    const state = db.__commerceMemory;
    const orderId = state.ordersByUserKey?.get(`${userId}|${key}`);
    if (!orderId) return null;
    const order = state.orders.get(orderId); const meta = state.orderMeta.get(orderId);
    return order && meta ? { order, record: normalizeRecord(meta) } : null;
  }
  const found = await rows(db, 'SELECT e.*, o.id AS order_id_value, o.orderReference, o.total, o.currency AS order_currency, o.status AS order_status, o.createdAt, o.updatedAt FROM ej_checkout_orders e LEFT JOIN `Order` o ON o.id=e.order_id WHERE e.user_id=? AND e.idempotency_key=? LIMIT 1', [userId, key]);
  if (!found[0]) return null;
  const row = found[0];
  const order = row.order_id_value ? { id: row.order_id_value, orderReference: row.orderReference, total: row.total, currency: row.order_currency || row.currency, status: row.order_status, createdAt: row.createdAt, updatedAt: row.updatedAt } : null;
  return { order, record: normalizeRecord(row) };
}
function assertReplayMatches(replay, source, body) {
  const record = replay.record || {}; const payload = parsePayload(record.requestPayload);
  if (record.source !== source) throw httpError(409, 'idempotency_mismatch', 'Idempotency key was already used for a different provider order');
  const sameQuote = String(payload.quoteId || '') === String(body.quoteId || '');
  const sameQuantity = source === 'NUMBER' || Number(payload.quantity) === Number(body.quantity);
  if (!sameQuote || !sameQuantity) throw httpError(409, 'idempotency_mismatch', 'Idempotency key was already used for a different request');
}
async function verifyFreshNumberQuote(db, quote, item, adapter) {
  const selection = quote.selection || {};
  const catalog = await adapter.catalog({ country: selection.country, service: selection.service });
  const raw = (catalog.quotes || []).find((candidate) => String(candidate.country) === String(selection.country) && String(candidate.service) === String(selection.service) && String(candidate.operator || 'any') === String(selection.operator || 'any'));
  if (!raw || !raw.available || Number(raw.count || 0) < 1) throw httpError(409, 'quote_unavailable', 'The provider quote is no longer available');
  let costMinor; let retailMinor;
  try { costMinor = ceilProviderToMinor(raw.amount, item.rate); retailMinor = retailFromMarkup(costMinor, item.markup); } catch { throw httpError(409, 'quote_changed', 'The provider quote changed'); }
  if (String(costMinor) !== String(quote.costMinor) || String(retailMinor) !== String(quote.retailMinor)) throw httpError(409, 'quote_changed', 'The provider quote changed; refresh before checkout');
  return String(raw.amount);
}
async function verifyFreshDonQuote(db, quote, adapter, quantity) {
  const selection = quote.selection || {}; const supplierId = String(selection.supplierProductId || selection.productId || '');
  const catalog = await adapter.catalog(); const raw = (catalog.products || []).map(normalizeDonProduct).find((candidate) => candidate && candidate.id === supplierId);
  if (!raw || !raw.available || raw.stock < quantity || quantity < raw.minQty || quantity > raw.maxQty) throw httpError(409, 'quote_unavailable', 'The supplier product is no longer available');
  const pricing = await adminRetail(db, raw.id, raw.category, raw.costMinor);
  if (!pricing || String(raw.costMinor) !== String(quote.costMinor) || String(pricing.retailMinor) !== String(quote.retailMinor)) throw httpError(409, 'quote_changed', 'The supplier price or retail rule changed; refresh before checkout');
  return raw;
}
async function recoverKnownDonOrder({ record, quantity, adapters, options, db, fallbackOrder }) {
  if (!record?.providerRef) return null;
  try {
    const recovered = await adapters.don.getOrder(String(record.providerRef));
    const supplierOrder = recovered?.order || recovered; const delivery = recovered?.delivery?.lines;
    if (String(supplierOrder?.status || '').toLowerCase() !== 'completed' || !Array.isArray(delivery) || delivery.length !== quantity) return null;
    const completed = await callCommerce(options, 'completeExternalOrder', { orderId: record.orderId, providerRef: String(record.providerRef), delivery: delivery.map((line) => String(line)), state: 'COMPLETED', db });
    return { status: 201, order: safeOrder(completed?.order || fallbackOrder, { ...record, state: 'COMPLETED' }) };
  } catch { return null; }
}
function normalizeDonProduct(product) {
  if (!product || product.id === undefined || typeof product.name !== 'string') return null;
  const cost = String(product.price_minor ?? product.rank_price_minor ?? '');
  if (!/^\d+$/.test(cost) || BigInt(cost) <= 0n) return null;
  const stock = Number(product.stock ?? 0); const minQty = requirePositiveInt(product.min_qty ?? 1, 'min quantity', 100000); const maxQty = Number.isSafeInteger(Number(product.max_qty)) ? Number(product.max_qty) : Math.max(minQty, Math.min(100000, stock || minQty));
  if (!Number.isSafeInteger(stock) || stock < 0 || maxQty < minQty) return null;
  return { id: String(product.id), name: product.name.slice(0, 160), category: typeof product.category === 'string' ? product.category.slice(0, 80) : 'Logs', costMinor: cost, available: stock > 0, stock, minQty, maxQty };
}
function supplierProductId(provider, value) { return `${String(provider).toLowerCase()}:${String(value)}`; }
function numberProductId(provider, selection) { return supplierProductId(providerName(provider), `${selection.country}:${selection.service}:${selection.operator}`); }
function requestPayloadForNumber(selection, quoteId) {
  return { quoteId: String(quoteId), country: String(selection.country), service: String(selection.service), operator: String(selection.operator || 'any') };
}
function requestPayloadForLogs(productId, supplierProductIdValue, quantity, quoteId) {
  return { quoteId: String(quoteId), productId: String(productId), supplierProductId: String(supplierProductIdValue), quantity };
}
async function adminRetail(db, productId, platform, costMinor) {
  let rules = [];
  try {
    const mapped = await rows(db, 'SELECT id, platform, status, acquisition_cost_minor, supplier_product_id FROM ej_admin_products WHERE source = \'DONMARKETPLACE\' AND supplier_product_id = ? LIMIT 1', [String(productId)]);
    if (!mapped[0] || mapped[0].status !== 'ACTIVE' || String(mapped[0].supplier_product_id) !== String(productId)) return null;
    if (costMinor === undefined || costMinor === null || !/^\d+$/.test(String(costMinor)) || BigInt(costMinor) <= 0n) return null;
    const localProductId = mapped[0].id;
    rules = await rows(db, "SELECT id, scope, scope_key, mode, value, version FROM ej_admin_pricing_rules WHERE scope='PRODUCT' AND scope_key=? AND mode='MANUAL' LIMIT 1", [localProductId]);
  } catch { return null; }
  const rule = rules[0];
  if (!rule) return null;
  try {
    const retailMinor = calculateRetail({ costMinor: BigInt(costMinor), mode: 'MANUAL', value: rule.value });
    if (retailMinor < BigInt(costMinor)) return null;
    return { retailMinor, costMinor: BigInt(costMinor), scope: rule.scope, ruleId: rule.id, version: Number(rule.version) };
  } catch { return null; }
}
async function buildDonQuotes(db, userId, adapter) {
  const catalog = await adapter.catalog(); const output = [];
  for (const raw of catalog.products) {
    const product = normalizeDonProduct(raw); if (!product || !product.available) continue;
    const pricing = await adminRetail(db, product.id, product.category, product.costMinor);
    if (!pricing) continue;
    const namespacedId = supplierProductId('DONMARKETPLACE', product.id);
    const quote = await createQuote(db, { userId, provider: 'DONMARKETPLACE', kind: 'LOGS', productId: namespacedId, selection: { productId: namespacedId, supplierProductId: product.id, name: product.name, category: product.category, minQty: product.minQty, maxQty: product.maxQty, stock: product.stock }, costMinor: product.costMinor, retailMinor: pricing.retailMinor, currency: 'NGN' });
    output.push({ id: quote.quoteId, provider: 'DONMARKETPLACE', providerLabel: 'Donmarketplace Logs', country: null, service: 'logs', operator: null, name: product.name, priceMinor: String(pricing.retailMinor), currency: 'NGN', available: true, minQty: product.minQty, maxQty: product.maxQty });
    if (output.length >= 200) break;
  }
  return output;
}
async function buildNumberQuotes(db, userId, number, adapter, item, query) {
  const catalog = await adapter.catalog({ country: query.country, service: query.service }); const output = [];
  for (const raw of catalog.quotes || []) {
    if (!raw.available) continue;
    let costMinor; try { costMinor = ceilProviderToMinor(raw.amount, item.rate); } catch { continue; }
    let retailMinor; try { retailMinor = retailFromMarkup(costMinor, item.markup); } catch { continue; }
    if (retailMinor < costMinor) continue;
    const selection = { country: String(raw.country), service: String(raw.service), operator: String(raw.operator || 'any'), name: String(raw.name || raw.service).slice(0, 160), providerAmount: String(raw.amount), available: true, count: Number(raw.count || 0) };
    const quote = await createQuote(db, { userId, provider: providerName(number), kind: 'NUMBER', productId: numberProductId(number, selection), selection, costMinor, retailMinor, currency: 'NGN' });
    output.push({ id: quote.quoteId, provider: number, providerLabel: item.label, country: selection.country, service: selection.service, operator: selection.operator, name: selection.name, priceMinor: String(retailMinor), currency: 'NGN', available: true });
    if (output.length >= 2000) break;
  }
  return { countries: catalog.countries || [], services: catalog.services || [], quotes: output };
}
async function dispatchNumber({ req, db, options, cfg, adapters, quote }) {
  const key = idempotency(req); const provider = quote.provider === '5SIM' ? 1 : 2; providerReady(cfg, provider, true);
  const selection = quote.selection || {}; const providerAmount = await verifyFreshNumberQuote(db, quote, cfg.providers[provider], adapters[provider]); const requestPayload = requestPayloadForNumber(selection, quote.quoteId);
  const reservation = await callCommerce(options, 'reserveExternalOrder', { userId: req.user.id, idempotencyKey: key, supplierKey: key, productId: quote.productId, productName: selection.name || quote.productId, categorySlug: 'virtual-numbers', retailMinor: quote.retailMinor, costMinor: quote.costMinor, currency: 'NGN', provider: providerName(provider), source: 'NUMBER', requestPayload, quantity: 1, db });
  const reservationRecord = normalizeRecord(reservation?.record);
  if (reservation?.replayed) return { status: 200, order: safeOrder(reservation.order, reservationRecord), session: safeSession(reservationRecord?.session) };
  const record = reservationRecord || {};
  const claimed = await callCommerce(options, 'claimExternalDispatch', { orderId: record.orderId, db });
  const claimedRecord = normalizeRecord(claimed?.record);
  if (!claimed?.claimed) return { status: 202, order: safeOrder(reservation.order, claimedRecord || record), session: safeSession(claimedRecord?.session || record.session) };
  try {
    const response = await adapters[provider].buy({ country: selection.country, service: selection.service, operator: selection.operator, maxPrice: providerAmount });
    const providerRef = String(response?.id ?? response?.activationId ?? ''); if (!providerRef) throw new ProviderTransportError('Provider returned no activation reference', { code: 'provider_missing_reference', unknownOutcome: true });
    const allocatedPhone = provider === 1
      ? (response.phone ?? response.number ?? response.phoneNumber ?? null)
      : (response.phone ?? response.phoneNumber ?? response.number ?? null);
    const session = provider === 1
      ? { id: providerRef, phone: allocatedPhone, number: allocatedPhone, service: selection.service, country: selection.country, serviceName: selection.name, status: response.status, code: response.sms?.[0]?.code || null, messages: response.sms || [], expiresAt: response.expires }
      : { id: providerRef, phone: allocatedPhone, number: allocatedPhone, service: selection.service, country: selection.country, serviceName: selection.name, status: 'waiting', code: null, messages: [], expiresAt: response.activationTime || null };
    const status = provider === 1 && ['FINISHED', 'RECEIVED'].includes(String(response.status).toUpperCase()) && session.code ? 'COMPLETED' : 'WAITING';
    const completed = await callCommerce(options, 'completeExternalOrder', { orderId: record.orderId, providerRef, session, state: status, db });
    return { status: status === 'COMPLETED' ? 201 : 202, order: safeOrder(completed?.order || reservation.order, { ...record, state: status, orderId: record.orderId }), session: safeSession(session) };
  } catch (error) {
    // NO_BALANCE is a definitive rejection, not an uncertain allocation.
    // Refund the reserved customer payment. If refunding fails, retain the
    // order for manual reconciliation; never repeat the provider purchase.
    if (provider === 2 && error?.code === 'smsbower_no_balance') {
      let refundSucceeded = false;
      try {
        await callCommerce(options, 'refundOrder', {
          orderId: record.orderId,
          actorId: 'provider-coordinator',
          reason: 'SMSBower rejected number allocation with NO_BALANCE',
          providerRefundConfirmed: true,
          trustedCoordinator: true,
          db,
        });
        refundSucceeded = true;
      } catch (refundError) {
        console.error('[SMSBower]', JSON.stringify({
          event: 'smsbower_no_balance_refund_failed',
          orderId: record.orderId,
          errorCode: refundError?.code || 'refund_failed',
        }));
      }

      if (refundSucceeded) {
        console.warn('[SMSBower]', JSON.stringify({
          event: 'smsbower_order_refunded_after_no_balance',
          orderId: record.orderId,
        }));
        throw httpError(402, 'provider_insufficient_balance', 'SMSBower has insufficient provider balance. Your order payment has been refunded to your wallet.');
      }

      await callCommerce(options, 'markExternalUncertain', {
        orderId: record.orderId,
        code: 'smsbower_no_balance_refund_failed',
        db,
      }).catch(() => {});
      return {
        status: 202,
        order: safeOrder(reservation.order, { ...record, state: 'RECONCILIATION', orderId: record.orderId }),
        session: null,
      };
    }

    // If SMSBower returned an activation ID but omitted another field, persist
    // that ID and partial session immediately. Refresh can then query the same
    // activation instead of leaving the order without a provider reference.
    if (error.providerRef) {
      const partialSession = {
        id: String(error.providerRef),
        phone: error.session?.phone || null,
        number: error.session?.number || error.session?.phone || null,
        service: selection.service,
        country: selection.country,
        serviceName: selection.name,
        status: 'waiting',
        code: null,
        messages: [],
        expiresAt: error.session?.activationTime || null,
      };
      await callCommerce(options, 'completeExternalOrder', {
        orderId: record.orderId,
        providerRef: String(error.providerRef),
        session: partialSession,
        state: 'WAITING',
        db,
      }).catch(async () => callCommerce(options, 'markExternalUncertain', {
        orderId: record.orderId,
        code: error.code || 'provider_unknown_outcome',
        providerRef: String(error.providerRef),
        db,
      }).catch(() => {}));
      return {
        status: 202,
        order: safeOrder(reservation.order, { ...record, state: 'WAITING', orderId: record.orderId }),
        session: safeSession(partialSession),
      };
    }
    await callCommerce(options, 'markExternalUncertain', { orderId: record.orderId, code: error.code || 'provider_unknown_outcome', providerRef: error.providerRef, db }).catch(() => {});
    if (error instanceof ProviderTransportError && !error.unknownOutcome && error.status >= 400 && error.status < 500) throw httpError(422, 'provider_rejected', errorMessage(error));
    return { status: 202, order: safeOrder(reservation.order, { ...record, state: 'RECONCILIATION', orderId: record.orderId }), session: null };
  }
}
async function dispatchLogs({ req, db, options, cfg, adapters, quote, quantity, expected }) {
  const key = idempotency(req); if (!cfg.don.enabled || !cfg.don.purchasesEnabled) throw httpError(503, 'don_purchases_disabled', 'Donmarketplace Logs purchases are disabled');
  if (expected !== undefined && String(expected) !== String(quote.retailMinor)) throw httpError(409, 'price_mismatch', 'The confirmed price has changed');
  const selection = quote.selection || {}; const maxQty = Number(selection.maxQty || 100000); const minQty = Number(selection.minQty || 1); if (quantity < minQty || quantity > maxQty) throw httpError(409, 'quantity_unavailable', 'The requested quantity is unavailable');
  const fresh = await verifyFreshDonQuote(db, quote, adapters.don, quantity);
  const reservation = await callCommerce(options, 'reserveExternalOrder', { userId: req.user.id, idempotencyKey: key, supplierKey: key, productId: quote.productId, productName: selection.name || quote.productId, categorySlug: 'logs', retailMinor: String(quote.retailMinor), costMinor: String(quote.costMinor), currency: 'NGN', provider: 'DONMARKETPLACE', source: 'DONMARKETPLACE', requestPayload: requestPayloadForLogs(quote.productId, fresh.id, quantity, quote.quoteId), quantity, db });
  const reservationRecord = normalizeRecord(reservation?.record);
  if (reservation?.replayed) {
    const recovered = await recoverKnownDonOrder({ record: reservationRecord, quantity, adapters, options, db, fallbackOrder: reservation.order });
    return recovered || { status: 200, order: safeOrder(reservation.order, reservationRecord) };
  }
  const record = reservationRecord || {}; const claimed = await callCommerce(options, 'claimExternalDispatch', { orderId: record.orderId, db }); const claimedRecord = normalizeRecord(claimed?.record);
  if (!claimed?.claimed) {
    const replayRecord = claimedRecord || record;
    const recovered = await recoverKnownDonOrder({ record: replayRecord, quantity, adapters, options, db, fallbackOrder: reservation.order });
    if (recovered) return recovered;
    return { status: 202, order: safeOrder(reservation.order, replayRecord) };
  }
  try {
    const response = await adapters.don.placeOrder({ productId: fresh.id, quantity, idempotencyKey: record.supplierKey || key, maxPrice: quote.costMinor });
    const supplierOrder = response?.order || response; const supplierRef = supplierOrder?.number || response?.number;
    let delivery = response?.delivery?.lines;
    if ((!Array.isArray(delivery) || delivery.length !== quantity) && supplierRef) {
      try { const recovered = await adapters.don.getOrder(String(supplierRef)); if (Array.isArray(recovered?.delivery?.lines)) delivery = recovered.delivery.lines; } catch {}
    }
    if (String(supplierOrder?.status || '').toLowerCase() === 'completed' && Array.isArray(delivery) && delivery.length === quantity) {
      const completed = await callCommerce(options, 'completeExternalOrder', { orderId: record.orderId, providerRef: String(supplierRef || ''), delivery: delivery.map((line) => String(line)), state: 'COMPLETED', db });
      return { status: 201, order: safeOrder(completed?.order || reservation.order, record) };
    }
    await callCommerce(options, 'markExternalUncertain', { orderId: record.orderId, code: 'delivery_unavailable_or_count_mismatch', providerRef: supplierRef, db });
    return { status: 202, order: safeOrder(reservation.order, { ...record, state: 'RECONCILIATION', orderId: record.orderId }) };
  } catch (error) {
    await callCommerce(options, 'markExternalUncertain', { orderId: record.orderId, code: error.code || 'don_unknown_outcome', providerRef: error.providerRef, db }).catch(() => {});
    if (error instanceof ProviderTransportError && !error.unknownOutcome && error.status >= 400 && error.status < 500) throw httpError(422, 'provider_rejected', errorMessage(error));
    return { status: 202, order: safeOrder(reservation.order, { ...record, state: 'RECONCILIATION', orderId: record.orderId }) };
  }
}
function createProviderRouter(options = {}) {
  const router = express.Router(); const db = options.db; const cfg = config(options.env || process.env); const adapters = adaptersFor(cfg, options);
  const donCatalogRequests = new Map(); let nextDonCatalogPrune = 0;
  router.use(cookieParser()); router.use(express.json({ limit: '100kb', strict: true })); router.use(requireAuth);
  router.get('/status', use(async (_req, res) => res.json(statusBody(cfg))));
  router.get('/numbers/catalog', use(async (req, res) => {
    const number = safeProvider(req.query.provider); const item = providerReady(cfg, number); const result = await buildNumberQuotes(db, req.user.id, number, adapters[number], item, { country: req.query.country, service: req.query.service });
    // List every ready provider so the provider dropdown can offer all of them, not just the one requested.
    res.json({ providers: Object.values(cfg.providers).filter((p) => p.ready).map((p) => ({ provider: p.number, providerLabel: p.label })), countries: result.countries, services: result.services, quotes: result.quotes });
  }));
  router.post('/numbers/orders', use(async (req, res) => {
    const key = idempotency(req); const replay = await existingExternalReplay(dbOf(db), req.user.id, key);
    if (replay) { assertReplayMatches(replay, 'NUMBER', { quoteId: req.body?.quoteId }); return res.status(200).json({ order: safeOrder(replay.order, replay.record), ...(replay.record?.session ? { session: safeSession(replay.record.session) } : {}) }); }
    const quote = await findQuote(db, req.body?.quoteId, req.user.id, 'NUMBER'); if (!quote) throw httpError(410, 'quote_expired', 'The quote is expired or unavailable');
    const result = await dispatchNumber({ req, db, options, cfg, adapters, quote }); res.status(result.status).json({ order: result.order, ...(result.session ? { session: result.session } : {}) });
  }));
  router.get('/numbers/orders/:orderId', use(async (req, res) => {
    const record = normalizeRecord(await callCommerce(options, 'getExternalOrder', { orderId: req.params.orderId, userId: req.user.id, db })); if (!record || record.source !== 'NUMBER') throw httpError(404, 'not_found', 'Order not found');
    let session = safeSession(record.session); let state = record.state;
    if (numberStatusMayPoll(record)) {
      try {
        const provider = record.provider === '5SIM' ? 1 : 2; const status = await adapters[provider].status(record.providerRef);
        let current;
        if (provider === 1) {
          current = { id: record.providerRef, phone: status.phone ?? status.number ?? null, number: status.phone ?? status.number ?? null, status: status.status, code: status.sms?.[0]?.code || null, messages: status.sms || [], expiresAt: status.expires };
        } else {
          let statusPayload = status;
          if (typeof status === 'string' && /^[\s]*\{/.test(status)) {
            try { statusPayload = JSON.parse(status); } catch { statusPayload = status; }
          }
          const statusText = typeof statusPayload === 'string'
            ? statusPayload
            : String(statusPayload?.status ?? statusPayload?.raw ?? '');
          const statusPhone = typeof statusPayload === 'object' && statusPayload
            ? (statusPayload.phone ?? statusPayload.phoneNumber ?? statusPayload.number ?? null)
            : null;
          const statusCode = (typeof statusPayload === 'object' && statusPayload
            ? (statusPayload.code ?? statusPayload.smsCode ?? null)
            : null) ?? (statusText.startsWith('STATUS_OK:') ? statusText.slice('STATUS_OK:'.length) : null);
          current = {
            id: record.providerRef,
            phone: statusPhone,
            number: statusPhone,
            status: statusText.startsWith('STATUS_OK:') ? 'received' : statusText.replace(/:.*/, '').toLowerCase(),
            code: statusCode,
            messages: Array.isArray(statusPayload?.messages) ? statusPayload.messages : [],
            expiresAt: statusPayload?.activationTime ?? statusPayload?.expiresAt ?? null,
          };
        }
        const merged = mergeSession(record.session, current); session = safeSession(merged);
        const received = provider === 1 ? Boolean(current.code) || ['RECEIVED', 'FINISHED'].includes(String(current.status || '').toUpperCase()) : Boolean(current.code) || String(current.status || '').toUpperCase() === 'RECEIVED';
        await callCommerce(options, 'completeExternalOrder', { orderId: record.orderId, providerRef: record.providerRef, session: merged, state: received ? 'COMPLETED' : 'WAITING', db });
        state = received ? 'COMPLETED' : 'WAITING';
      } catch {}
    }
    res.json({ orderId: record.orderId || req.params.orderId, state: state || 'PROCESSING', session });
  }));
  router.post('/numbers/orders/:orderId/finish', use(async (req, res) => { const result = await finishOrCancelNumber({ req, db, options, cfg, adapters, finish: true }); res.status(result.status).json(result.body); }));
  router.post('/numbers/orders/:orderId/cancel', use(async (req, res) => { const result = await finishOrCancelNumber({ req, db, options, cfg, adapters, finish: false }); res.status(result.status).json(result.body); }));
  router.get('/logs/catalog', use(async (req, res) => {
    if (!cfg.don.enabled) return res.json({ providers: [], quotes: [], mode: cfg.don.mode });
    const now = Date.now();
    if (now >= nextDonCatalogPrune) {
      for (const [userId, lastRequest] of donCatalogRequests) if (now - lastRequest > 5 * 60 * 1000) donCatalogRequests.delete(userId);
      nextDonCatalogPrune = now + 60 * 1000;
    }
    const userId = String(req.user.id || '');
    const lastRequest = donCatalogRequests.get(userId) || 0;
    if (now - lastRequest < 30 * 1000) throw httpError(429, 'catalog_rate_limited', 'Please wait before refreshing supplier listings.');
    donCatalogRequests.set(userId, now);
    await dbOf(db).query('DELETE FROM ej_provider_quotes WHERE expires_at <= CURRENT_TIMESTAMP(3)');
    const quotes = await buildDonQuotes(db, req.user.id, adapters.don);
    res.json({ providers: [{ provider: 'DONMARKETPLACE', providerLabel: 'Donmarketplace Logs' }], quotes, mode: cfg.don.mode });
  }));
  router.post('/logs/orders', use(async (req, res) => {
    const key = idempotency(req); const quantity = requirePositiveInt(req.body?.quantity, 'quantity', 100000); const replay = await existingExternalReplay(dbOf(db), req.user.id, key);
    if (replay) {
      assertReplayMatches(replay, 'DONMARKETPLACE', { quoteId: req.body?.quoteId, quantity });
      const recovered = await recoverKnownDonOrder({ record: replay.record, quantity, adapters, options, db, fallbackOrder: replay.order });
      if (recovered) return res.status(recovered.status).json({ order: recovered.order });
      return res.status(200).json({ order: safeOrder(replay.order, replay.record) });
    }
    const quote = await findQuote(db, req.body?.quoteId, req.user.id, 'LOGS'); if (!quote) throw httpError(410, 'quote_expired', 'The quote is expired or unavailable');
    const result = await dispatchLogs({ req, db, options, cfg, adapters, quote, quantity, expected: req.body?.expectedUnitPriceMinor }); res.status(result.status).json({ order: result.order });
  }));
  router.get('/logs/orders/:orderId', use(async (req, res) => { const record = normalizeRecord(await callCommerce(options, 'getExternalOrder', { orderId: req.params.orderId, userId: req.user.id, db })); if (!record) throw httpError(404, 'not_found', 'Order not found'); res.json({ orderId: record.orderId || req.params.orderId, state: record.state || 'PROCESSING', status: record.state || 'PROCESSING' }); }));
  router.use((error, _req, res, _next) => sendError(res, error));
  return router;
}
async function finishOrCancelNumber({ req, db, options, cfg, adapters, finish }) {
  const record = normalizeRecord(await callCommerce(options, 'getExternalOrder', { orderId: req.params.orderId, userId: req.user.id, db })); if (!record || record.source !== 'NUMBER') throw httpError(404, 'not_found', 'Order not found');
  if (['REFUNDED', 'CANCELED', 'CANCELLED', 'COMPLETED'].includes(String(record.state || '').toUpperCase())) throw httpError(409, 'order_terminal', 'This activation is already terminal');
  if (!record.providerRef) throw httpError(409, 'reconciliation_required', 'The activation is awaiting provider reconciliation');
  const provider = record.provider === '5SIM' ? 1 : record.provider === 'SMSBOWER' ? 2 : 0; if (!provider) throw httpError(409, 'invalid_provider_state', 'This order has no number provider');
  try {
    const current = await adapters[provider].status(record.providerRef); const text = typeof current === 'string' ? current : String(current.status || ''); const hasCode = provider === 1 ? Boolean(current.sms?.length) || Boolean(current.sms?.[0]?.code) || ['RECEIVED', 'FINISHED'].includes(text.toUpperCase()) : text.startsWith('STATUS_OK:');
    if (finish && !hasCode) throw httpError(409, 'activation_not_ready', 'The activation is not ready to finish');
    if (!finish && hasCode) throw httpError(409, 'activation_already_received', 'An activation with a code cannot be canceled');
    const result = finish ? await adapters[provider].finish(record.providerRef) : await adapters[provider].cancel(record.providerRef);
    if (finish) { const completed = await callCommerce(options, 'completeExternalOrder', { orderId: record.orderId, providerRef: record.providerRef, session: provider === 1 ? result : { id: record.providerRef, status: String(result) }, state: 'COMPLETED', db }); return { status: 200, body: { order: safeOrder(completed?.order, record), session: safeSession(provider === 1 ? result : { id: record.providerRef, status: String(result) }) } }; }
    if (provider === 1 && String(result?.status || '').toUpperCase() === 'CANCELED' && !result.sms?.length) { await callCommerce(options, 'refundOrder', { orderId: record.orderId, actorId: 'provider-coordinator', reason: '5SIM authoritative CANCELED with no SMS', providerRefundConfirmed: true, trustedCoordinator: true, db }); return { status: 200, body: { orderId: record.orderId, state: 'CANCELED', session: safeSession(result) } }; }
    await callCommerce(options, 'markExternalUncertain', { orderId: record.orderId, code: provider === 2 ? 'smsbower_cancel_refund_unconfirmed' : 'fivesim_cancel_not_authoritative', providerRef: record.providerRef, db }); return { status: 202, body: { orderId: record.orderId, state: 'RECONCILIATION', session: safeSession(provider === 1 ? result : { id: record.providerRef, status: String(result) }) } };
  } catch (error) { if (error instanceof ProviderTransportError) { await callCommerce(options, 'markExternalUncertain', { orderId: record.orderId, code: error.code, providerRef: record.providerRef, db }).catch(() => {}); return { status: 202, body: { orderId: record.orderId, state: 'RECONCILIATION', session: null } }; } throw error; }
}
function createProviderAdminRouter(options = {}) {
  const router = express.Router(); const cfg = config(options.env || process.env); const db = options.db; const adapters = adaptersFor(cfg, options);
  router.use(express.json({ limit: '100kb', strict: true }));
  router.get('/status', (_req, res) => res.json(statusBody(cfg)));
  router.post('/logs/sync', use(async (req, res) => {
    if (!cfg.don.enabled) throw httpError(503, 'don_disabled', 'Donmarketplace is disabled');
    const catalog = await adapters.don.catalog(); const synced = [];
    for (const raw of catalog.products || []) {
      const product = normalizeDonProduct(raw); if (!product) continue;
      const existing = (await rows(db, 'SELECT id, name, platform, status, acquisition_cost_minor, min_qty, max_qty, supplier_product_id FROM ej_admin_products WHERE source = \'DONMARKETPLACE\' AND supplier_product_id = ? LIMIT 1', [product.id]))[0];
      const platform = ['Instagram', 'TikTok', 'Facebook', 'X', 'Telegram', 'YouTube'].includes(product.category) ? product.category : 'Other';
      let status = 'DRAFT';
      if (existing) {
        const changed = String(existing.name) !== product.name || String(existing.platform) !== platform || String(existing.acquisition_cost_minor) !== String(product.costMinor) || Number(existing.min_qty) !== product.minQty || Number(existing.max_qty) !== product.maxQty || String(existing.supplier_product_id) !== product.id;
        status = existing.status === 'ACTIVE' && !changed ? 'ACTIVE' : 'DRAFT';
        await dbOf(db).query('UPDATE ej_admin_products SET name=?, platform=?, acquisition_cost_minor=?, min_qty=?, max_qty=?, status=? WHERE id=?', [product.name, platform, product.costMinor, product.minQty, product.maxQty, status, existing.id]);
      } else {
        await dbOf(db).query('INSERT INTO ej_admin_products (id, name, platform, description, terms, source, status, acquisition_cost_minor, min_qty, max_qty, supplier_product_id) VALUES (?, ?, ?, ?, ?, \'DONMARKETPLACE\', \'DRAFT\', ?, ?, ?, ?)', [`ejp_${crypto.randomBytes(14).toString('base64url')}`, product.name, platform, '', '', product.costMinor, product.minQty, product.maxQty, product.id]);
      }
      await dbOf(db).query('INSERT INTO ej_admin_audit_events (action, actor_id, actor_email, target_id, detail_json) VALUES (?, ?, ?, ?, ?)', ['PROVIDER_CATALOG_SYNC', req.admin?.id || null, req.admin?.email || null, existing?.id || null, JSON.stringify({ provider: 'DONMARKETPLACE', supplierProductId: product.id, status, changed: Boolean(existing) && status !== existing.status })]);
      synced.push({ supplierProductId: product.id, name: product.name, costMinor: product.costMinor, status });
    }
    res.json({ mode: cfg.don.mode, synced });
  }));
  router.post('/logs/activate-all', use(async (req, res) => {
    const pool = dbOf(db);
    const connection = await pool.getConnection();
    let transactionOpen = false;
    try {
      await connection.beginTransaction();
      transactionOpen = true;
      const products = await rows(connection, "SELECT id, name, platform, status, acquisition_cost_minor, supplier_product_id FROM ej_admin_products WHERE source = 'DONMARKETPLACE' AND status IN ('DRAFT', 'ACTIVE') ORDER BY id FOR UPDATE");
      if (!products.length) {
        await connection.commit();
        transactionOpen = false;
        return res.json({ activated: 0, total: 0, message: 'No synced Donmarketplace listings were found.' });
      }

      const updatedIds = [];
      for (const product of products) {
        const supplierId = String(product.supplier_product_id || '');
        if (!supplierId || product.acquisition_cost_minor == null || !/^\d+$/.test(String(product.acquisition_cost_minor)) || BigInt(product.acquisition_cost_minor) <= 0n) continue;
        await connection.query("UPDATE ej_admin_products SET status = 'ACTIVE' WHERE id = ?", [product.id]);
        const pricing = await adminRetail(connection, supplierId, product.platform, String(product.acquisition_cost_minor));
        if (pricing) updatedIds.push(product.id);
      }

      if (updatedIds.length !== products.length) {
        const error = httpError(422, 'bulk_activation_blocked', `Could not activate all listings: ${products.length - updatedIds.length} listing(s) need a valid supplier mapping, positive cost, and retail pricing rule. No listings were changed.`);
        throw error;
      }

      await connection.query('INSERT INTO ej_admin_audit_events (action, actor_id, actor_email, target_id, detail_json) VALUES (?, ?, ?, ?, ?)', ['DONMARKETPLACE_BULK_ACTIVATE', req.admin?.id || null, req.admin?.email || null, null, JSON.stringify({ activatedCount: products.length })]);
      await connection.commit();
      transactionOpen = false;
      res.json({ activated: products.length, total: products.length, supplierPurchasesEnabled: Boolean(cfg.don.purchasesEnabled), message: 'All synced Donmarketplace listings passed server pricing checks and were activated. Supplier purchases are controlled separately.' });
    } catch (error) {
      if (transactionOpen) { try { await connection.rollback(); } catch {} }
      throw error;
    } finally {
      connection.release();
    }
  }));
  return router;
}
module.exports = { createProviderRouter, createProviderAdminRouter, statusBody, safeOrder, safeSession, dispatchNumber, dispatchLogs, adminRetail, buildDonQuotes, existingExternalReplay, assertReplayMatches };
