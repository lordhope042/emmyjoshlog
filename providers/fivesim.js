'use strict';

const { request, ProviderTransportError } = require('./transport');
const { opaqueSelection } = require('./money');

function ensureSegment(value, field) {
  const text = String(value || '');
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(text)) throw new Error(`${field} is invalid`);
  return text;
}

// 5SIM answers errors as plain text ("no free phones", "not enough user balance"),
// so the body is fetched as text and parsed here instead of letting a JSON parse crash hide it.
function readBody(response) {
  const body = response.body;
  if (body !== null && typeof body === 'object') return body;
  const text = String(body ?? '').trim();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return text; }
}

function ensureOk(response) {
  const body = readBody(response);
  if (!response.ok) {
    const message = body && typeof body === 'object'
      ? String(body.message || body.error || '5SIM request failed')
      : String(body || '5SIM request failed').slice(0, 250);
    const error = new ProviderTransportError(message, {
      status: response.status,
      code: `fivesim_http_${response.status}`,
      unknownOutcome: response.status >= 500,
    });
    error.body = body;
    throw error;
  }
  // A 200 that is not JSON may still mean a purchase went through, so treat it as unknown.
  if (typeof body === 'string') {
    throw new ProviderTransportError(`5SIM returned an unexpected response: ${body.slice(0, 250)}`, {
      status: response.status,
      code: 'fivesim_non_json',
      unknownOutcome: true,
    });
  }
  return body;
}

function create5SimAdapter({ envConfig, fetchImpl, timeoutMs = 15000 } = {}) {
  const cfg = envConfig;
  const auth = () => ({ Accept: 'application/json', Authorization: `Bearer ${cfg.token}` });
  const call = async (method, path, { authorized = true } = {}) => {
    const response = await request({
      url: `${cfg.base}${path}`,
      method,
      headers: authorized ? auth() : { Accept: 'application/json' },
      timeoutMs,
      fetchImpl,
      parse: 'text',
    });
    return ensureOk(response);
  };

  return {
    async catalog({ country, service } = {}) {
      const countries = await call('GET', '/v1/guest/countries', { authorized: false });
      const countryRows = Object.entries(countries && typeof countries === 'object' ? countries : {})
        .slice(0, 250)
        .map(([slug, value]) => ({ id: slug, name: value?.text_en || slug, iso: value?.iso || null }));

      // The unfiltered price list covers every country, product and operator and is
      // far too large for the transport's response limit. Return just the country
      // list until the user picks a country or service.
      if (!country && !service) {
        // Product names only (a small response) so the service dropdown is filled.
        // Prices are fetched once a country or service is chosen.
        // Try countries 5SIM itself lists (a hard-coded slug can be rejected with "bad country").
        let services = [];
        const listed = countryRows.map((row) => row.id);
        const candidates = [...new Set(['england', 'usa', 'gabon', ...listed])].filter((id) => listed.includes(id)).slice(0, 4);
        for (const candidate of candidates) {
          try {
            const products = await call('GET', `/v1/guest/products/${encodeURIComponent(ensureSegment(candidate, 'country'))}/any`, { authorized: false });
            services = Object.keys(products && typeof products === 'object' ? products : {}).slice(0, 250);
            if (services.length > 0) break;
          } catch (error) {
            console.warn(`[5sim] products lookup failed for ${candidate}:`, error?.code || '', error?.status || '', String(error?.message || '').slice(0, 200));
          }
        }
        return { countries: countryRows, services, quotes: [] };
      }

      const query = [];
      if (country) query.push(`country=${encodeURIComponent(ensureSegment(country, 'country'))}`);
      if (service) query.push(`product=${encodeURIComponent(ensureSegment(service, 'service'))}`);
      const prices = await call('GET', `/v1/guest/prices${query.length ? `?${query.join('&')}` : ''}`, { authorized: false });

      const quotes = [];
      for (const [countryKey, products] of Object.entries(prices && typeof prices === 'object' ? prices : {})) {
        for (const [productKey, operators] of Object.entries(products && typeof products === 'object' ? products : {})) {
          for (const [operatorKey, value] of Object.entries(operators && typeof operators === 'object' ? operators : {})) {
            if (!value || value.cost === undefined) continue;
            const count = Number(value.count || 0);
            if (!Number.isFinite(Number(value.cost)) || Number(value.cost) < 0 || !Number.isSafeInteger(count) || count < 0) continue;
            quotes.push({
              country: countryKey,
              service: productKey,
              operator: operatorKey,
              name: `${productKey} · ${countryKey}`,
              amount: String(value.cost),
              available: count > 0,
              count,
            });
            if (quotes.length >= 2000) break;
          }
          if (quotes.length >= 2000) break;
        }
        if (quotes.length >= 2000) break;
      }
      // The operator is chosen automatically: keep only the cheapest in-stock operator
      // (most stock on a tie) for each country and service.
      const cheapest = new Map();
      for (const quote of quotes) {
        if (!quote.available) continue;
        const key = `${quote.country}|${quote.service}`;
        const current = cheapest.get(key);
        const price = Number(quote.amount);
        if (!current || price < Number(current.amount) || (price === Number(current.amount) && quote.count > current.count)) cheapest.set(key, quote);
      }
      return { countries: countryRows, services: [...new Set(quotes.map((q) => q.service))], quotes: [...cheapest.values()] };
    },

    async buy({ country, operator = 'any', service, maxPrice }) {
      const path = `/v1/user/buy/activation/${encodeURIComponent(ensureSegment(country, 'country'))}/${encodeURIComponent(ensureSegment(operator, 'operator'))}/${encodeURIComponent(ensureSegment(service, 'service'))}${maxPrice === undefined ? '' : `?maxPrice=${encodeURIComponent(String(maxPrice))}`}`;
      return call('GET', path);
    },
    async status(providerId) {
      return call('GET', `/v1/user/check/${encodeURIComponent(ensureSegment(providerId, 'provider id'))}`);
    },
    async finish(providerId) {
      return call('GET', `/v1/user/finish/${encodeURIComponent(ensureSegment(providerId, 'provider id'))}`);
    },
    async cancel(providerId) {
      return call('GET', `/v1/user/cancel/${encodeURIComponent(ensureSegment(providerId, 'provider id'))}`);
    },
    safeSelection(selection) {
      return opaqueSelection(selection);
    },
  };
}

module.exports = { create5SimAdapter, ensureSegment };