import { beginLoading } from './loading.js';

const API_KEY = 'emmyjosh.apiBase';
const CUSTOMER_SESSION_MARKER = 'emmyjosh.customerSessionActive';
const IDEMPOTENCY_STORAGE_PREFIX = 'emmyjosh.idempotency.v1:';
const csrfState = { token: null, promise: null };
const logicalIdempotency = new Map();
const activeRequests = new Set();
let authGeneration = 0;
let currentCustomerId = null;

function hasConfirmedSessionMarker() {
  try { return sessionStorage.getItem(CUSTOMER_SESSION_MARKER) === '1'; }
  catch { return false; }
}

function setConfirmedSessionMarker(active) {
  try {
    if (active) sessionStorage.setItem(CUSTOMER_SESSION_MARKER, '1');
    else sessionStorage.removeItem(CUSTOMER_SESSION_MARKER);
  } catch { /* session continuity is best-effort when browser storage is unavailable */ }
}

function resetAuthContext() {
  authGeneration += 1;
  for (const controller of activeRequests) controller.abort();
  activeRequests.clear();
  invalidateCsrf();
  clearIdempotencyKeys();
  currentCustomerId = null;
  setConfirmedSessionMarker(false);
}

export class ApiError extends Error {
  constructor(message, status = 0, code = 'API_ERROR') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

function friendlyApiMessage(status, code, serverMessage, path, payload) {
  const normalized = String(code || '').toUpperCase();
  if (['ACCOUNT_CONFLICT', 'P2002'].includes(normalized) || status === 409) {
    return 'Those details are already in use. Sign in or choose a different username, email, or phone number.';
  }
  if (path === '/auth/login' && status === 401) {
    return 'We could not sign you in. Check your username, email or phone, and password, then try again.';
  }
  if (status === 401) return 'Your session has ended. Please sign in again.';
  if (status === 403) return 'You do not have permission to do that.';
  if (status === 429) return 'There have been too many attempts. Please wait a little and try again.';
  if ([400, 422].includes(status)) {
    const details = Array.isArray(payload?.details) ? payload.details : [];
    const messages = details.map((item) => item?.message).filter((message) => typeof message === 'string' && message.trim());
    if (messages.length === 1 && !/\b(?:P\d{4}|REQUEST_FAILED|INTERNAL_SERVER_ERROR)\b/i.test(messages[0])) return messages[0];
    return 'Please check the information you entered and try again.';
  }
  if (status >= 500) return 'Something went wrong on our side. Please try again shortly.';
  if (serverMessage && !/\b(?:P\d{4}|REQUEST_FAILED|INTERNAL_SERVER_ERROR|HTTP_ERROR)\b/i.test(serverMessage)) return serverMessage;
  return 'We could not complete that request. Please try again.';
}

function normalizeBase(value) {
  const normalized = String(value || '').trim().replace(/\/+$/, '');
  if (!normalized) return '';
  if (normalized.startsWith('//') || (!/^https?:\/\//i.test(normalized) && !normalized.startsWith('/'))) {
    throw new ApiError('Use an http(s) URL or a same-origin path.', 0, 'INVALID_API_URL');
  }
  let parsed;
  try { parsed = new URL(normalized, window.location.origin); }
  catch { throw new ApiError('Enter a valid API URL.', 0, 'INVALID_API_URL'); }
  const sameOrigin = parsed.origin === window.location.origin;
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new ApiError('Use a valid http(s) API base without credentials, query, or hash.', 0, 'INVALID_API_URL');
  }
  if (!sameOrigin && !/^https?:\/\//i.test(normalized)) throw new ApiError('Use a same-origin API path or an explicit https URL.', 0, 'INVALID_API_URL');
  return normalized;
}

export function getApiBase() {
  const configured = window.EMMYJOSH_CONFIG?.apiBase;
  const saved = (() => { try { return localStorage.getItem(API_KEY); } catch { return ''; } })();
  return normalizeBase(saved || configured || '/api/v1');
}

export function setApiBase(value) {
  const normalized = normalizeBase(value);
  try {
    if (!normalized) localStorage.removeItem(API_KEY);
    else localStorage.setItem(API_KEY, normalized);
  } catch { /* a blocked storage implementation should not break same-origin API use */ }
  resetAuthContext();
  return normalized;
}

export function invalidateCsrf() {
  csrfState.token = null;
  csrfState.promise = null;
}

export function clearIdempotencyKeys() { logicalIdempotency.clear(); }

async function rawRequest(path, options = {}) {
  const base = options.baseOverride || getApiBase();
  if (!base) throw new ApiError('API URL is not configured.', 0, 'NOT_CONFIGURED');
  const headers = new Headers(options.headers || {});
  if (options.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const end = beginLoading(options.loadingLabel || 'Loading verified data…');
  const generation = authGeneration;
  const controller = new AbortController();
  activeRequests.add(controller);
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    let response;
    try {
      response = await fetch(`${base}${path}`, {
        ...options,
        headers,
        signal: controller.signal,
        credentials: 'include',
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch {
      if (generation !== authGeneration) throw new ApiError('The account session changed.', 0, 'SESSION_CHANGED');
      throw new ApiError('The API did not confirm this request. For a purchase, check Orders or retry the same request—not a new purchase.', 0, 'NETWORK_ERROR');
    }
    let payload;
    try { payload = await response.json(); }
    catch { throw new ApiError('We could not complete that request. Please try again.', 0, 'INVALID_RESPONSE'); }
    if (generation !== authGeneration) throw new ApiError('The account session changed.', 0, 'SESSION_CHANGED');
    if (!response.ok) {
      const error = payload.error && typeof payload.error === 'object' ? payload.error : payload;
      const code = error.code || payload.code || 'HTTP_ERROR';
      const serverMessage = error.message || error.error || '';
      const wrapped = new ApiError(friendlyApiMessage(response.status, code, serverMessage, path, payload), response.status, code);
      wrapped.payload = payload;
      if (wrapped.status === 401 && !['/auth/login', '/auth/register'].includes(path)) {
        const hadSession = Boolean(currentCustomerId || hasConfirmedSessionMarker());
        resetAuthContext();
        if (hadSession && typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(new CustomEvent('emmyjosh:session-expired', { detail: { hadSession: true } }));
        }
      }
      throw wrapped;
    }
    return payload;
  } finally { clearTimeout(timeout); activeRequests.delete(controller); end(); }
}

async function csrfToken() {
  if (csrfState.token) return csrfState.token;
  if (!csrfState.promise) {
    let pending;
    pending = rawRequest('/auth/csrf', { loadingLabel: 'Preparing secure request…' })
      .then((result) => {
        const token = result.csrfToken || result.data?.csrfToken;
        if (!token) throw new ApiError('The API did not provide a CSRF token.', 0, 'CSRF_UNAVAILABLE');
        csrfState.token = String(token);
        return csrfState.token;
      })
      .finally(() => { if (csrfState.promise === pending) csrfState.promise = null; });
    csrfState.promise = pending;
  }
  return csrfState.promise;
}

async function request(path, options = {}, retry = true) {
  const requestGeneration = authGeneration;
  const method = String(options.method || 'GET').toUpperCase();
  const write = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const headers = new Headers(options.headers || {});
  if (write) {
    const token = await csrfToken();
    if (requestGeneration !== authGeneration) throw new ApiError('The account session changed before this request was sent.', 0, 'SESSION_CHANGED');
    headers.set('X-CSRF-Token', token);
  }
  if (requestGeneration !== authGeneration) throw new ApiError('The account session changed before this request was sent.', 0, 'SESSION_CHANGED');
  try {
    return await rawRequest(path, { ...options, headers });
  } catch (error) {
    if (write && retry && [403, 419].includes(error.status) && ['CSRF_INVALID', 'CSRF_TOKEN_EXPIRED'].includes(error.code)) {
      invalidateCsrf();
      return request(path, options, false);
    }
    throw error;
  }
}

function encoded(value) { return encodeURIComponent(value); }
function idempotencyScope(logicalPurchase) {
  return `${getApiBase()}|${currentCustomerId || 'unresolved'}|${logicalPurchase}`;
}
function idempotencyStorageKey(scope) { return `${IDEMPOTENCY_STORAGE_PREFIX}${encodeURIComponent(scope)}`; }
function stableIdempotencyKey(logicalPurchase) {
  const key = String(logicalPurchase || '').trim();
  if (!key) throw new ApiError('A logical purchase key is required.', 0, 'IDEMPOTENCY_KEY_REQUIRED');
  const scope = idempotencyScope(key);
  if (logicalIdempotency.has(scope)) return logicalIdempotency.get(scope);
  const storageKey = idempotencyStorageKey(scope);
  let saved;
  try { saved = localStorage.getItem(storageKey); }
  catch { throw new ApiError('This browser cannot retain a pending order key safely. Enable local storage before retrying checkout.', 0, 'IDEMPOTENCY_STORAGE_UNAVAILABLE'); }
  if (typeof saved === 'string' && /^ejc_[a-f0-9]{32}$/.test(saved)) {
    logicalIdempotency.set(scope, saved);
    return saved;
  }
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  const idempotencyKey = `ejc_${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`;
  try { localStorage.setItem(storageKey, idempotencyKey); }
  catch { throw new ApiError('This browser cannot retain a pending order key safely. Enable local storage before retrying checkout.', 0, 'IDEMPOTENCY_STORAGE_UNAVAILABLE'); }
  logicalIdempotency.set(scope, idempotencyKey);
  return idempotencyKey;
}
function completeIdempotencyKey(logicalPurchase) {
  const scope = idempotencyScope(logicalPurchase);
  logicalIdempotency.delete(scope);
  try { localStorage.removeItem(idempotencyStorageKey(scope)); } catch { /* keep the server-safe key if local storage is unavailable */ }
}
function setCustomerContext(result) {
  const user = result?.user || result?.data?.user || result?.profile || result?.data?.profile;
  currentCustomerId = user?.id === undefined || user?.id === null ? null : String(user.id);
  setConfirmedSessionMarker(Boolean(currentCustomerId));
}
async function authenticate(path, data) {
  resetAuthContext();
  try {
    const result = await request(path, { method: 'POST', body: data });
    setCustomerContext(result);
    return result;
  } finally { invalidateCsrf(); }
}

export const api = {
  request,
  health() {
    const base = getApiBase();
    const root = base.replace(/\/api\/v1\/?$/i, '');
    return rawRequest('/health', { baseOverride: root || window.location.origin, loadingLabel: 'Checking API…' });
  },
  csrf() { return csrfToken(); },
  register(data) { return authenticate('/auth/register', data); },
  login(data) { return authenticate('/auth/login', data); },
  async logout() { resetAuthContext(); try { return await request('/auth/logout', { method: 'POST', body: {} }); } finally { invalidateCsrf(); clearIdempotencyKeys(); } },
  async me() { const result = await request('/auth/me'); setCustomerContext(result); return result; },
  profile() { return request('/users/me'); },
  updateProfile(data) { return request('/users/me', { method: 'PATCH', body: data }); },
  updatePassword(data) { return request('/users/me/password', { method: 'PATCH', body: data }); },
  dashboard() { return request('/dashboard/summary'); },
  categories() { return request('/categories'); },
  products(params = {}) { const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== '')); return request(`/products${query.size ? `?${query}` : ''}`); },
  product(id) { return request(`/products/${encoded(id)}`); },
  wallet() { return request('/wallet'); },
  virtualAccount() { return request('/wallet/virtual-account'); },
  createVirtualAccount(phoneNumber) { return request('/wallet/virtual-account', { method: 'POST', body: { phoneNumber } }); },
  walletTransactions() { return request('/wallet/transactions'); },
  orders() { return request('/orders'); },
  order(id) { return request(`/orders/${encoded(id)}`); },
  delivery(id) { return request(`/orders/${encoded(id)}/delivery`); },
  createOrder(productId, quantity = 1, expectedUnitPriceMinor) {
    const body = { productId, quantity };
    if (expectedUnitPriceMinor !== undefined && expectedUnitPriceMinor !== null && /^\d+$/.test(String(expectedUnitPriceMinor))) body.expectedUnitPriceMinor = String(expectedUnitPriceMinor);
    const logical = `order:${productId}:${quantity}`;
    const key = stableIdempotencyKey(logical);
    return request('/orders', { method: 'POST', headers: { 'Idempotency-Key': key }, body }).then(result => {
      const terminal = String(result.order?.state || result.order?.status || '').toUpperCase();
      if (['COMPLETED', 'FAILED', 'REFUNDED', 'CANCELED', 'CANCELLED'].includes(terminal)) completeIdempotencyKey(logical);
      return result;
    });
  },
  transactions() { return request('/transactions'); },
  notifications() { return request('/notifications'); },
  markNotificationRead(id) { return request(`/notifications/${encoded(id)}/read`, { method: 'PATCH', body: {} }); },
  markAllNotificationsRead() { return request('/notifications/read-all', { method: 'POST', body: {} }); },
  supportTickets() { return request('/support/tickets'); },
  createSupportTicket(subject, body) { return request('/support/tickets', { method: 'POST', body: { subject, body } }); },
  providerStatus() { return request('/providers/status'); },
  supplierLogsCatalog() { return request('/providers/logs/catalog'); },
  supplierLogsOrder(id) { return request(`/providers/logs/orders/${encoded(id)}`); },
  createSupplierLogsOrder(quoteId, quantity, expectedUnitPriceMinor) {
    const logical = `don:${quoteId}:${quantity}`;
    const key = stableIdempotencyKey(logical);
    return request('/providers/logs/orders', { method: 'POST', headers: { 'Idempotency-Key': key }, body: { quoteId, quantity, expectedUnitPriceMinor: String(expectedUnitPriceMinor) } }).then(result => {
      const terminal = String(result.order?.state || result.order?.status || '').toUpperCase();
      if (['COMPLETED', 'FAILED', 'REFUNDED', 'CANCELED', 'CANCELLED'].includes(terminal)) completeIdempotencyKey(logical);
      return result;
    });
  },
  numberCatalog(params = {}) { const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== '')); return request(`/providers/numbers/catalog${query.size ? `?${query}` : ''}`); },
  createNumberOrder(quoteId) {
    const logical = `number:${quoteId}`; const key = stableIdempotencyKey(logical);
    return request('/providers/numbers/orders', { method: 'POST', headers: { 'Idempotency-Key': key }, body: { quoteId } }).then(result => {
      const terminal = String(result.order?.state || result.order?.status || '').toUpperCase();
      if (['COMPLETED', 'FAILED', 'REFUNDED', 'CANCELED', 'CANCELLED'].includes(terminal)) completeIdempotencyKey(logical);
      return result;
    });
  },
  numberOrder(id) { return request(`/providers/numbers/orders/${encoded(id)}`); },
  finishNumberOrder(id) { return request(`/providers/numbers/orders/${encoded(id)}/finish`, { method: 'POST', body: {} }); },
  cancelNumberOrder(id) { return request(`/providers/numbers/orders/${encoded(id)}/cancel`, { method: 'POST', body: {} }); },
  adminSummary() { return request('/admin/summary'); },
  adminCustomers() { return request('/admin/customers'); },
  adminOrders() { return request('/admin/orders'); },
  adminTransactions() { return request('/admin/transactions'); },
  adminVirtualAccounts() { return request('/admin/virtual-accounts'); },
  adminAuditLogs() { return request('/admin/audit-logs'); },
  adminSupportTickets() { return request('/admin/support/tickets'); },
};

export { stableIdempotencyKey };
