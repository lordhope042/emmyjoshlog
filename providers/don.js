'use strict';

const { request, ProviderTransportError } = require('./transport');
const { opaqueSelection } = require('./money');

function messageOf(body) { return body && typeof body === 'object' ? String(body.message || body.error || 'Donmarketplace request failed') : 'Donmarketplace request failed'; }
function ensureOk(response) { if (!response.ok) { const error = new ProviderTransportError(messageOf(response.body), { status: response.status, code: `don_http_${response.status}` }); error.body = response.body; throw error; } return response.body; }
function idValue(value) { if (typeof value === 'number' && Number.isSafeInteger(value)) return value; if (typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value)) return value; throw new Error('Don product id is invalid'); }

function createDonAdapter({ envConfig, fetchImpl, timeoutMs = 15000 } = {}) {
  const cfg = envConfig;
  const headers = () => ({ Accept: 'application/json', Authorization: `Bearer ${cfg.key}` });
  const call = async (method, path, body, extra = {}) => {
    const response = await request({ url: `${cfg.base}${path}`, method, headers: { ...headers(), ...(body ? { 'Content-Type': 'application/json' } : {}), ...(extra.idempotencyKey ? { 'Idempotency-Key': extra.idempotencyKey } : {}) }, body: body ? JSON.stringify(body) : undefined, timeoutMs, fetchImpl, parse: 'json' });
    return ensureOk(response);
  };
  return {
    async catalog() {
      if (!cfg.enabled || !cfg.modeValid || !cfg.key) return { products: [], categories: [], servers: [], disabled: true };
      const result = await call('GET', '/catalog/logs');
      return { products: Array.isArray(result?.products) ? result.products.slice(0, 1000) : [], categories: Array.isArray(result?.categories) ? result.categories.slice(0, 100) : [], servers: Array.isArray(result?.servers) ? result.servers.slice(0, 100) : [], mode: result?.mode || cfg.mode };
    },
    async placeOrder({ productId, quantity, idempotencyKey, maxPrice }) {
      if (!cfg.purchasesEnabled || !cfg.enabled || cfg.mode !== 'sandbox') throw new ProviderTransportError('Donmarketplace purchases are disabled', { code: 'don_purchases_disabled' });
      return call('POST', '/orders', { type: 'logs', product_id: idValue(productId), quantity, ...(maxPrice === undefined ? {} : { max_price: String(maxPrice) }) }, { idempotencyKey });
    },
    async getOrder(number) {
      if (!cfg.key || typeof number !== 'string' || !/^MC[A-Za-z0-9_-]{4,160}$/.test(number)) throw new Error('Supplier order reference is invalid');
      return call('GET', `/orders/${encodeURIComponent(number)}`);
    },
    safeSelection(selection) { return opaqueSelection(selection); },
  };
}
module.exports = { createDonAdapter, idValue };
