'use strict';

const { URL } = require('node:url');

class ProviderTransportError extends Error {
  constructor(message, { code = 'provider_transport_error', status = 0, unknownOutcome = false } = {}) {
    super(message);
    this.name = 'ProviderTransportError';
    this.code = code;
    this.status = status;
    this.unknownOutcome = unknownOutcome;
  }
}

function safeUrl(input) {
  try {
    const url = new URL(String(input));
    url.search = '';
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return '[invalid-url]';
  }
}

function safeHeaders(headers = {}) {
  const secret = /authorization|api[-_]?key|token|cookie|secret/i;
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, secret.test(key) ? '[redacted]' : String(value).slice(0, 120)]));
}

async function readBounded(response, maxBytes) {
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          try { await reader.cancel(); } catch {}
          throw new ProviderTransportError('Provider response exceeded the size limit', { code: 'provider_response_too_large' });
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      try { reader.releaseLock(); } catch {}
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new ProviderTransportError('Provider response exceeded the size limit', { code: 'provider_response_too_large' });
  return text;
}

function parseResponse(raw, parse, status) {
  if (parse === 'text') return raw;
  if (!raw.trim()) return null;
  try { return JSON.parse(raw); } catch (error) {
    if (parse === 'json') throw new ProviderTransportError('Provider returned invalid JSON', { code: 'provider_invalid_json', status });
    return raw;
  }
}

async function request({
  url,
  method = 'GET',
  headers = {},
  body,
  timeoutMs = 15000,
  maxBytes = 1024 * 1024,
  parse = 'auto',
  fetchImpl = globalThis.fetch,
}) {
  if (typeof fetchImpl !== 'function') throw new ProviderTransportError('HTTP transport is unavailable', { code: 'provider_transport_unavailable' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(100, Math.min(Number(timeoutMs) || 15000, 120000)));
  let response;
  try {
    response = await fetchImpl(String(url), {
      method: String(method).toUpperCase(),
      headers: { ...headers },
      body,
      signal: controller.signal,
      redirect: 'error',
    });
  } catch (error) {
    const timeout = error?.name === 'AbortError';
    throw new ProviderTransportError(timeout ? 'Provider request timed out' : 'Provider request failed', {
      code: timeout ? 'provider_timeout' : 'provider_network_error',
      unknownOutcome: String(method).toUpperCase() !== 'GET',
    });
  } finally {
    clearTimeout(timer);
  }
  const raw = await readBounded(response, maxBytes);
  const parsed = parseResponse(raw, parse, response.status);
  return {
    status: response.status,
    ok: response.status >= 200 && response.status < 300,
    headers: response.headers,
    body: parsed,
    raw,
    redacted: { url: safeUrl(url), method: String(method).toUpperCase(), headers: safeHeaders(headers) },
  };
}

module.exports = { request, ProviderTransportError, safeUrl, safeHeaders };
