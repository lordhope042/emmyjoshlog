'use strict';

const { request, ProviderTransportError } = require('./transport');
const { opaqueSelection } = require('./money');

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// Used only when SMSBower's service list has no readable name for a code.
const FALLBACK_NAMES = {
  wa: 'WhatsApp', tg: 'Telegram', fb: 'Facebook', ig: 'Instagram', go: 'Google', tw: 'Twitter / X',
  ds: 'Discord', lf: 'TikTok', am: 'Amazon', mm: 'Microsoft', vi: 'Viber', wb: 'WeChat',
  oi: 'Tinder', nf: 'Netflix', ub: 'Uber', ot: 'Any other',
};

function ensureValue(value, field, max = 100) {
  const text = String(value ?? '');
  if (!text || text.length > max || !/^[A-Za-z0-9._:-]+$/.test(text)) throw new Error(`${field} is invalid`);
  return text;
}

function ensureOk(response) {
  if (!response.ok) {
    const body = response.body;
    const message = isRecord(body)
      ? String(body.message || body.error || 'SMSBower request failed')
      : String(body || 'SMSBower request failed').slice(0, 250);
    const error = new ProviderTransportError(message, {
      status: response.status,
      code: `smsbower_http_${response.status}`,
      unknownOutcome: response.status >= 500,
    });
    error.body = body;
    throw error;
  }
  return response.body;
}

// SMSBower's handler_api.php is a GET API: every parameter goes in the query string.
function query(values) {
  return new URLSearchParams(
    Object.entries(values)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => [key, String(value)]),
  ).toString();
}

function safeResponsePreview(value) {
  let preview = String(value ?? '').slice(0, 500);
  // Provider error bodies are useful for diagnosis, but must never expose credentials
  // or long phone-like identifiers in application logs.
  preview = preview
    .replace(/(api[_-]?key|token|authorization|password|secret)(\s*[=:]\s*)[^&\s,;"']+/gi, '$1$2[REDACTED]')
    .replace(/(\+?\d[\d\s().-]{7,}\d)/g, '[REDACTED_NUMBER]');
  return preview;
}

function logProviderResponse(action, body, status = 200) {
  const raw = String(body ?? '');
  const entry = {
    event: 'smsbower_unexpected_response',
    action,
    httpStatus: status,
    bodyType: isRecord(body) ? 'object' : Array.isArray(body) ? 'array' : typeof body,
    bodyLength: raw.length,
    preview: safeResponsePreview(raw),
  };
  console.error('[SMSBower]', JSON.stringify(entry));
}

function parseJson(body, action) {
  if (isRecord(body) || Array.isArray(body)) return body;
  const raw = String(body ?? '').trim();

  // SMSBower can return this plain-text rejection with HTTP 200. It means
  // getNumberV2 rejected the allocation before creating an activation.
  if (action === 'getNumberV2' && /^NO_BALANCE$/i.test(raw)) {
    console.error('[SMSBower]', JSON.stringify({
      event: 'smsbower_provider_rejection',
      action,
      providerCode: 'NO_BALANCE',
      httpStatus: 200,
    }));
    throw new ProviderTransportError('SMSBower account has insufficient balance to allocate a number.', {
      status: 402,
      code: 'smsbower_no_balance',
      unknownOutcome: false,
    });
  }

  try {
    return JSON.parse(raw);
  } catch {
    logProviderResponse(action, body, 200);
    throw new ProviderTransportError(`SMSBower returned an unexpected response for ${action}`, {
      status: 200,
      code: 'smsbower_non_json',
      // Unknown getNumberV2 text may still follow a successful allocation.
      unknownOutcome: action === 'getNumberV2',
    });
  }
}

// Accepts every list shape SMSBower returns:
//   [ {...} ]  |  { countries|services|data: [ ... ] }  |  { "1": {...} }  |  { "1": "Name" }
function extractItems(parsed, listKeys, keyField) {
  if (Array.isArray(parsed)) return parsed.filter(isRecord);
  if (!isRecord(parsed)) return [];
  for (const listKey of listKeys) {
    if (Array.isArray(parsed[listKey])) return parsed[listKey].filter(isRecord);
  }
  return Object.entries(parsed).map(([key, value]) => (
    isRecord(value) ? { [keyField]: key, ...value } : { [keyField]: key, name: value }
  ));
}

function firstText(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value) !== '') return String(value);
  }
  return undefined;
}

function normalizeCountries(parsed) {
  const rows = [];
  for (const item of extractItems(parsed, ['countries', 'data'], 'id')) {
    const id = firstText(item.id, item.country, item.countryId, item.country_id);
    if (!id) continue;
    // SMSBower names are { rus, eng, chn }: prefer English, never drop a country for a missing name.
    const name = firstText(item.eng, item.name, item.countryName, item.country_name, item.title, item.rus, item.chn) || id;
    rows.push({ ...item, id, name });
  }
  return rows;
}

function normalizeServices(parsed) {
  const rows = [];
  for (const item of extractItems(parsed, ['services', 'data'], 'code')) {
    const code = firstText(item.code, item.service, item.serviceCode, item.service_code);
    if (!code) continue;
    const name = firstText(item.name, item.serviceName, item.service_name, item.title, item.eng, item.rus) || code;
    rows.push({ ...item, code, name });
  }
  return rows;
}

function serviceName(code, names) {
  const apiName = names.get(code);
  if (apiName && apiName !== code) return apiName;
  return FALLBACK_NAMES[code] || code;
}

// One service entry from getPricesV2 -> its price tiers ("grades"), cheapest first.
// Documented shape: { "<price1>": stock1, "<price2>": stock2 }; { cost, count } is handled as a single tier.
function tiersOf(info) {
  if (!isRecord(info)) return [];
  const named = 'cost' in info || 'price' in info || 'count' in info || 'qty' in info;
  if (!named) {
    return Object.entries(info)
      .map(([key, value]) => ({
        key,
        price: Number(key),
        count: isRecord(value) ? Number(value.count ?? value.qty) : Number(value),
      }))
      .filter((tier) => Number.isFinite(tier.price) && tier.price > 0 && Number.isFinite(tier.count))
      .sort((a, b) => a.price - b.price);
  }
  const price = Number(info.cost ?? info.price ?? info.retail_price ?? info.real_price);
  const count = Number(info.count ?? info.qty ?? info.quantity ?? info.available ?? info.stock ?? 0);
  return Number.isFinite(price) && price > 0 ? [{ key: String(price), price, count: Number.isFinite(count) ? count : 0 }] : [];
}

function createSMSBowerAdapter({ envConfig, fetchImpl, timeoutMs = 15000 } = {}) {
  const cfg = envConfig;
  const base = String(cfg.base || 'https://smsbower.page/stubs/handler_api.php').replace(/\/+$/, '');

  // Always fetched as text and parsed here, so provider text errors (NO_NUMBERS,
  // NO_BALANCE, BAD_KEY...) surface as readable messages instead of JSON parse crashes.
  const call = async (values, timeout = timeoutMs) => {
    const response = await request({
      url: `${base}?${query({ api_key: cfg.token, ...values })}`,
      method: 'GET',
      headers: { Accept: 'application/json, text/plain' },
      timeoutMs: timeout,
      fetchImpl,
      parse: 'text',
    });
    if (!response.ok) {
      const body = response.body;
      console.error('[SMSBower]', JSON.stringify({
        event: 'smsbower_http_error',
        action: String(values.action || 'unknown'),
        httpStatus: response.status,
        bodyType: isRecord(body) ? 'object' : Array.isArray(body) ? 'array' : typeof body,
        bodyLength: String(body ?? '').length,
        preview: safeResponsePreview(isRecord(body) ? JSON.stringify(body) : body),
      }));
    }
    return ensureOk(response);
  };

  return {
    async catalog({ country, service } = {}) {
      const [servicesRaw, countriesRaw] = await Promise.all([
        call({ action: 'getServicesList' }),
        call({ action: 'getCountries' }),
      ]);
      const allServices = normalizeServices(parseJson(servicesRaw, 'getServicesList'));
      const countries = normalizeCountries(parseJson(countriesRaw, 'getCountries')).slice(0, 250);
      const names = new Map(allServices.map((item) => [item.code, item.name]));

      // An unfiltered price call covers every country and service and can exceed the
      // transport's response limit, so prices are only fetched once a filter is chosen.
      if (!country && !service) return { countries, services: allServices.slice(0, 250), quotes: [] };

      // getPricesV2 lists every price tier, not just one price per country.
      const prices = parseJson(await call({ action: 'getPricesV2', country, service }), 'getPricesV2');
      const byCountry = {};
      if (country) {
        const nested = isRecord(prices) ? prices[String(country)] : undefined;
        byCountry[String(country)] = isRecord(nested) ? nested : (isRecord(prices) ? prices : {});
      } else if (isRecord(prices)) {
        Object.assign(byCountry, prices);
      }

      const quotes = [];
      const available = new Map();
      outer:
      for (const [countryKey, serviceRows] of Object.entries(byCountry)) {
        if (!isRecord(serviceRows)) continue;
        for (const [serviceKey, info] of Object.entries(serviceRows)) {
          if (service && serviceKey !== String(service)) continue;
          // Only tiers with stock are offered, cheapest first: "Grade 1" is the cheapest.
          const inStock = tiersOf(info).filter((tier) => tier.count > 0);
          if (inStock.length === 0) continue;
          const name = serviceName(serviceKey, names);
          available.set(serviceKey, name);
          inStock.forEach((tier, index) => {
            quotes.push({
              country: countryKey,
              service: serviceKey,
              // The tier's price key is the operator: buy() caps the provider cost (maxPrice)
              // at the tier the user was quoted, so a pricier tier is never bought at a cheaper price.
              operator: tier.key,
              name: `${name} · Grade ${index + 1}`,
              amount: String(tier.price),
              available: true,
              count: tier.count,
            });
          });
          if (quotes.length >= 2000) break outer;
        }
      }

      // With a country chosen, the service list is the services available in that country.
      // If the country has nothing in stock (or the id was not one SMSBower knows), fall back to
      // the full list so the service dropdown is never left empty.
      const services = service || available.size === 0
        ? allServices.slice(0, 250)
        : [...available.entries()].map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name));
      return { countries, services, quotes: quotes.slice(0, 2000) };
    },

    async buy({ country, service, maxPrice }) {
      if (maxPrice !== undefined && (!Number.isFinite(Number(maxPrice)) || Number(maxPrice) <= 0)) throw new Error('maxPrice is invalid');
      const raw = await call({
        action: 'getNumberV2',
        country: ensureValue(country, 'country'),
        service: ensureValue(service, 'service'),
        maxPrice, // SMSBower expects camelCase here, not max_price
      }, 60000);

      const result = parseJson(raw, 'getNumberV2');
      const activationId = isRecord(result) ? firstText(result.activationId, result.id, result.activation_id) : undefined;
      const phoneNumber = isRecord(result) ? firstText(result.phoneNumber, result.phone, result.number, result.msisdn) : undefined;

      // Keep the activation reference even when the provider omits the phone
      // field. The caller can persist the reference and reconcile this order
      // without ever issuing a second purchase request.
      if (!activationId || !phoneNumber) {
        const message = isRecord(result) ? (result.message ?? result.error ?? result.status) : undefined;
        const error = new ProviderTransportError(`SMSBower returned an incomplete allocation response: ${String(message || (!activationId ? 'Activation reference missing' : 'Phone number missing')).slice(0, 250)}`, {
          status: 200,
          code: !activationId ? 'smsbower_missing_activation_reference' : 'smsbower_missing_phone',
          // An incomplete success-shaped response may still represent a real
          // provider allocation. Never treat it as safe to purchase again.
          unknownOutcome: true,
        });
        if (activationId) {
          error.providerRef = activationId;
          error.session = {
            id: activationId,
            phone: phoneNumber || null,
            number: phoneNumber || null,
            status: 'waiting',
            code: null,
            messages: [],
            activationTime: firstText(result.activationTime),
          };
        }
        throw error;
      }

      const activationCost = result.activationCost !== undefined && result.activationCost !== null
        ? Number(result.activationCost)
        : undefined;
      const countryCode = firstText(result.countryCode);
      return {
        ...result,
        id: activationId,
        activationId,
        phone: phoneNumber,
        phoneNumber,
        number: phoneNumber,
        activationCost: Number.isFinite(activationCost) ? activationCost : undefined,
        countryCode,
        activationTime: firstText(result.activationTime),
        activationOperator: firstText(result.activationOperator),
        canGetAnotherSms: typeof result.canGetAnotherSms === 'boolean'
          ? result.canGetAnotherSms
          : typeof result.canGetAnotherSms === 'string'
            ? result.canGetAnotherSms.toLowerCase() === 'true'
            : undefined,
      };
    },

    async status(providerId) {
      return call({ action: 'getStatus', id: ensureValue(providerId, 'provider id') });
    },
    async finish(providerId) {
      return call({ action: 'setStatus', status: 6, id: ensureValue(providerId, 'provider id') });
    },
    async cancel(providerId) {
      return call({ action: 'setStatus', status: 8, id: ensureValue(providerId, 'provider id') });
    },
    safeSelection(selection) {
      return opaqueSelection(selection);
    },
  };
}

// `form` is kept as an alias so existing imports keep working.
module.exports = { createSMSBowerAdapter, ensureValue, form: query, query };
