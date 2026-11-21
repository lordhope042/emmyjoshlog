import { beginLoading } from './loading.js';
import { confirmDialog, promptDialog } from './ui.js';

const DEFAULT_LOGO = '/manus-storage/emmyjosh-logo-original-crop_1be053b9.png';
const ADMIN_ROOT = '/api/admin-tools';
const PLATFORMS = ['Instagram', 'TikTok', 'Facebook', 'X', 'Telegram', 'YouTube', 'Other', 'OTHER'];
const PRODUCT_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'];
const INVENTORY_STATUSES = ['AVAILABLE', 'RESERVED', 'SOLD', 'QUARANTINED'];
const SCOPES = ['DEFAULT', 'PLATFORM', 'PRODUCT'];
const MODES = ['FIXED', 'PERCENT', 'MANUAL'];

const fallbackIcons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  box: '<path d="m4 7 8-4 8 4-8 4-8-4Z"/><path d="M4 7v10l8 4 8-4V7M12 11v10"/>',
  tag: '<path d="M4 5v6l9 9 7-7-9-9H4Z"/><circle cx="7.5" cy="8.5" r="1"/>',
  warehouse: '<path d="m3 10 9-6 9 6M5 10v9h14v-9M3 20h18M9 19v-5h6v5"/>',
  upload: '<path d="M12 16V4m0 0L7 9m5-5 5 5M5 14v5h14v-5"/>',
  orders: '<path d="M5 5h14v16H5zM8 3h8v4H8zM8 11h8M8 15h5"/>',
  audit: '<path d="M5 4h14v17H5zM8 8h8M8 12h8M8 16h5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.6.9l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.6-.9l-1.7.6-1.4-2.4L5.5 15a8 8 0 0 1 0-1.9l-1.4-1.2 1.4-2.4 1.7.6a8 8 0 0 1 1.6-.9l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.6.9l1.7-.6 1.4 2.4-1.4 1.2a8 8 0 0 1-.1 1.9Z" transform="translate(1 -1) scale(.92)"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  logout: '<path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.8-4L3 10m0-5v5h5M4 13a8 8 0 0 0 14.8 4L21 14m0 5v-5h-5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  warning: '<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v4m0 4h.01"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  chart: '<path d="M4 19V5M4 19h17"/><path d="m7 15 4-4 3 2 6-7"/>',
  calculator: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h2m4 0h2M8 15h2m4 0h2M8 18h2m4 0h2"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/>',
};

function localEscape(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function localIcon(name, size = 19) {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${fallbackIcons[name] || fallbackIcons.grid}</svg>`;
}
function routePath(route) {
  if (typeof route === 'string') return route.split('?')[0] || '/admin';
  return String(route?.path || route?.pathname || window.location.pathname || '/admin').split('?')[0] || '/admin';
}
function cleanPath(path) {
  const value = String(path || '/admin').replace(/\/+$/, '');
  return value || '/admin';
}
function optionList(values, selected) {
  return values.map((value) => `<option value="${localEscape(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${localEscape(value)}</option>`).join('');
}
function dateLabel(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? localEscape(value) : date.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' });
}
function moneyLabel(value) {
  if (value === null || value === undefined || value === '') return 'Unknown cost';
  const raw = String(value);
  const [whole, fraction] = raw.split('.');
  const formattedWhole = whole.replace(/^(-?\d+)(?=\d{3})/, '$1').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `₦${formattedWhole}${fraction ? `.${fraction}` : ''}`;
}
function minorMoneyLabel(value) {
  if (value === null || value === undefined || value === '') return 'Unknown';
  try {
    const minor = BigInt(String(value));
    const sign = minor < 0n ? '-' : '';
    const absolute = minor < 0n ? -minor : minor;
    const naira = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const kobo = (absolute % 100n).toString().padStart(2, '0');
    return `₦${sign}${naira}.${kobo}`;
  } catch {
    return 'Price unavailable';
  }
}
function statusClass(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
}
function socialIcon(platform) {
  const slug = String(platform || '').toLowerCase();
  const localAssets = new Set(['instagram', 'tiktok', 'facebook', 'telegram', 'youtube']);
  return localAssets.has(slug)
    ? `<img src="/assets/social/${localEscape(slug)}.svg" alt="" width="22" height="22">`
    : localIcon('file', 21);
}
function platformBadge(platform) {
  return `<span class="ej-platform-badge">${socialIcon(platform)}<b>${localEscape(platform || 'Other')}</b></span>`;
}
function safeBackendMessage(value) {
  const message = typeof value === 'string' ? value.trim() : '';
  if (!message || message.length > 240 || /password|secret|cipher|credential|payload|stock content|raw input/i.test(message)) return '';
  return message;
}
function controlledError(error, fallback = 'The request could not be completed. Try again.') {
  const status = Number(error?.status);
  if (status === 401 || status === 403) return 'Your admin session is no longer valid. Sign in again.';
  if (status === 409) return 'This record changed or conflicts with another record. Refresh and try again.';
  if (status === 413) return 'The submitted content is too large for this operation.';
  if (status === 429) return 'Too many attempts. Wait briefly and try again.';
  if (status >= 500) return 'The admin service is temporarily unavailable. Try again.';
  if (status === 400 || status === 422) {
    const detail = safeBackendMessage(error?.backendMessage);
    const fields = Array.isArray(error?.validationFields) ? error.validationFields.map(safeBackendMessage).filter(Boolean).slice(0, 4) : [];
    if (detail) return fields.length ? `${detail} (${fields.join('; ')})` : detail;
    if (fields.length) return `Validation failed: ${fields.join('; ')}`;
    return fallback;
  }
  return fallback;
}

// Admin sign-in page styling, matched to the customer login. Injected once; selectors are prefixed ejl- so
// nothing in admin-tools.css is affected.
const ADMIN_LOGIN_CSS = `
.ejl-page{--ink:#17110d;--muted:#8a7e74;--o:#e8650a;--line:#f0e3d4;min-height:100vh;display:grid;grid-template-columns:1fr 1fr;background:#faf5ee;color:var(--ink)}
.ejl-brand{position:relative;overflow:hidden;min-height:100vh;display:flex;flex-direction:column;justify-content:space-between;gap:32px;padding:48px clamp(24px,5vw,64px);color:#fff;background:linear-gradient(135deg,#ffb067 0%,#f47a1f 38%,#d9560a 72%,#a93f05 100%)}
.ejl-brand::before,.ejl-brand::after{content:"";position:absolute;border-radius:50%;filter:blur(60px);pointer-events:none}
.ejl-brand::before{width:520px;height:520px;left:-140px;top:-160px;background:rgba(255,255,255,.45);animation:ejl-drift 14s ease-in-out infinite alternate}
.ejl-brand::after{width:560px;height:560px;right:-180px;bottom:-220px;background:rgba(110,26,0,.55);animation:ejl-drift 17s ease-in-out infinite alternate-reverse}
.ejl-brand>*{position:relative;z-index:1}
.ejl-deco{position:absolute!important;inset:0;z-index:0!important;pointer-events:none}
.ejl-ring{position:absolute;border-radius:50%;border:1.5px solid rgba(255,255,255,.3)}
.ejl-dots{position:absolute;left:40px;bottom:40px;width:150px;height:150px;opacity:.75;background-image:radial-gradient(rgba(255,255,255,.6) 1.6px,transparent 1.9px);background-size:20px 20px}
.ejl-chip{position:absolute;display:inline-flex;align-items:center;gap:10px;padding:12px 18px;border-radius:999px;background:rgba(255,255,255,.22);border:1px solid rgba(255,255,255,.5);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);font-weight:600;font-size:.9rem;color:#fff;box-shadow:0 20px 40px -22px rgba(70,20,0,.6)}
.ejl-chip svg{flex:none}
.ejl-float{animation:ejl-floatY 7s ease-in-out infinite}
.ejl-float-b{animation-duration:9s;animation-delay:-3s}
.ejl-badge{align-self:flex-start;display:inline-flex;background:#fff;border-radius:16px;padding:10px 18px;box-shadow:0 18px 40px -20px rgba(70,20,0,.6)}
.ejl-badge .brand-logo{display:block;height:48px;width:auto;max-width:none}
.ejl-brand-copy h2{margin:0 0 12px;font-size:clamp(2.6rem,4.6vw,4.2rem);line-height:1.02;letter-spacing:-.04em;font-weight:500;color:#fff}
.ejl-brand-copy p{margin:0;max-width:24em;font-size:1.0625rem;line-height:1.6;color:rgba(255,255,255,.9)}
.ejl-formside{position:relative;display:flex;flex-direction:column;justify-content:center;padding:72px clamp(24px,5vw,72px)}
.ejl-inner{width:min(100%,460px);margin:0 auto}
.ejl-back{position:absolute;top:28px;right:clamp(24px,5vw,72px);display:inline-flex;align-items:center;gap:8px;color:var(--muted);font-weight:600;font-size:.9rem;text-decoration:none}
.ejl-back svg{transform:rotate(180deg)}
.ejl-back:hover{color:var(--o)}
.ejl-eyebrow{display:block;margin:0 0 10px;font-size:.75rem;font-weight:700;letter-spacing:.12em;color:var(--o)}
.ejl-inner h1{margin:0 0 10px;font-size:clamp(2rem,3.4vw,2.7rem);line-height:1.08;letter-spacing:-.035em;font-weight:500}
.ejl-sub{margin:0 0 22px;color:#6e6055;line-height:1.55}
.ejl-form{display:grid;gap:16px;margin-top:20px}
.ejl-field{display:grid;gap:6px;font-size:.875rem;font-weight:600}
.ejl-field input{width:100%;box-sizing:border-box;padding:13px 16px;border-radius:14px;border:1.5px solid var(--line);background:#fff;color:var(--ink);font:inherit;font-weight:400;transition:border-color .2s ease,box-shadow .2s ease}
.ejl-field input::placeholder{color:#b3a79b}
.ejl-field input:focus{outline:none;border-color:var(--o);box-shadow:0 0 0 4px rgba(232,101,10,.16)}
.ejl-submit{display:inline-flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:13px 24px;border-radius:999px;border:1.5px solid var(--o);background:var(--o);color:#fff;font:inherit;font-weight:600;cursor:pointer;transition:transform .2s ease,background .2s ease}
.ejl-submit:hover{transform:translateY(-2px);background:#d4570a}
.ejl-submit:disabled{opacity:.55;cursor:not-allowed;transform:none}
.ejl-submit:focus-visible,.ejl-field input:focus-visible,.ejl-back:focus-visible{outline:3px solid var(--o);outline-offset:3px}
.ejl-note{margin:22px 0 0;font-size:.8125rem;line-height:1.5;color:var(--muted)}
@keyframes ejl-floatY{0%,100%{transform:translateY(0)}50%{transform:translateY(-12px)}}
@keyframes ejl-drift{from{transform:translate(0,0) scale(1)}to{transform:translate(60px,40px) scale(1.12)}}
@media (max-width:1000px){
  .ejl-page{grid-template-columns:1fr}
  .ejl-brand{min-height:0;gap:24px;padding:28px 24px 32px}
  .ejl-deco{display:none}
  .ejl-brand-copy h2{font-size:2.2rem}
  .ejl-formside{padding:56px 24px 40px}
  .ejl-back{top:20px;right:24px}
}
@media (prefers-reduced-motion:reduce){.ejl-brand::before,.ejl-brand::after,.ejl-float{animation:none!important}.ejl-submit{transition:none}}
`;

function ensureLoginStyles() {
  if (typeof document === 'undefined' || document.getElementById('ejl-login-styles')) return;
  const style = document.createElement('style');
  style.id = 'ejl-login-styles';
  style.textContent = ADMIN_LOGIN_CSS;
  document.head.appendChild(style);
}

// The admin shell (sidebar, top bar, tables, drawers) is styled by admin-tools.css. If the page did
// not link that file, or the link failed to load, add it from here. Candidates are tried in order:
// next to this script first, then common site folders. A server that answers a missing file with
// the HTML page is treated as a failure, so the next candidate is tried.
function ensureAdminStyles() {
  if (typeof document === 'undefined') return Promise.resolve();
  const alreadyLoaded = [...document.styleSheets].some((sheet) => sheet.href && sheet.href.includes('admin-tools'));
  if (alreadyLoaded || document.getElementById('ej-admin-tools-css')) return Promise.resolve();

  const candidates = [
    new URL('./admin-tools.css', import.meta.url).href,
    '/admin-tools.css',
    '/css/admin-tools.css',
    '/assets/admin-tools.css',
    '/styles/admin-tools.css',
  ];

  return new Promise((resolve) => {
    let index = 0;
    const timer = setTimeout(resolve, 4000); // never block the page on a slow stylesheet
    const finish = () => { clearTimeout(timer); resolve(); };
    const tryNext = () => {
      if (index >= candidates.length) { finish(); return; }
      const link = document.createElement('link');
      link.id = 'ej-admin-tools-css';
      link.rel = 'stylesheet';
      link.href = candidates[index];
      index += 1;
      link.onload = finish;
      link.onerror = () => { link.remove(); tryNext(); };
      document.head.appendChild(link);
    };
    tryNext();
  });
}

export async function mountAdminTools(root, options = {}) {
  if (!root) return;
  await ensureAdminStyles();
  const mountMarker = {};
  root.__adminToolsMount = mountMarker;
  const escapeHTML = options.escapeHTML || localEscape;
  const icon = (name, size = 19) => fallbackIcons[name] ? localIcon(name, size) : options.icon ? options.icon(name, size) : localIcon(name, size);
  const logo = options.logo || ((className = '') => `<img class="brand-logo ${className}" src="${DEFAULT_LOGO}" alt="Emmyjosh Logs" width="142" height="80">`);
  const toast = options.toast || ((message, tone = 'info') => {
    const slot = root.querySelector('[data-admin-toast]') || document.body;
    const item = document.createElement('div');
    item.className = `toast ${tone === 'error' ? 'error' : tone === 'success' ? 'success' : ''}`;
    item.textContent = message;
    slot.appendChild(item);
    setTimeout(() => item.remove(), 5000);
  });
  let currentRoute = cleanPath(routePath(options.route));
  let session = null;
  let csrfToken = null;
  let setupReady = true;
  let revision = 0;
  let busy = false;
  let logoutRetry = false;
  const state = {
    summary: null, products: [], rules: [], imports: [], units: [], audits: [], supplier: null, checkoutOrders: [], recentOrders: [], recentAudits: [], orderFilter: 'All', supplierStatus: null, productTab: 'DONMARKETPLACE', selectedDonProduct: null,
    error: '', pageError: '', loading: false, drawer: null, editingProduct: null,
    productForm: emptyProduct(), socialStep: 1, socialGroup: '', pricingForm: emptyRule(), calculator: { cost: '', platform: '', productId: '', mode: 'FIXED', value: '', result: null, error: '' },
    inventory: { productId: '', status: '', query: '' }, upload: emptyUpload(), uploadResult: null,
    inventoryError: '', productsError: '', rulesError: '', importsError: '', auditError: '', unitsError: '',
  };

  function go(path) {
    if (typeof options.navigate === 'function') {
      options.navigate(path);
      return;
    }
    window.history.pushState({}, '', path);
    currentRoute = cleanPath(path);
    revision += 1;
    if (!(cleanPath(path) === '/admin/login' && logoutRetry)) state.pageError = '';
    state.drawer = null; state.selectedDonProduct = null;
    render();
    void loadRouteData(revision, currentRoute);
  }
  function isCurrent(token, path = currentRoute) { return token === revision && path === currentRoute; }
  function emptyProduct(product = {}) {
    return {
      name: product.name || '', platform: product.platform || 'Instagram', description: product.description || '', terms: product.terms || '', sellingPrice: product.pricing?.retailMinor != null ? (Number(product.pricing.retailMinor) / 100).toFixed(2) : '',
      source: product.source || 'OWN', status: product.status || 'DRAFT', acquisitionCost: product.acquisitionCost ?? '',
      minQty: product.minQty ?? 1, maxQty: product.maxQty ?? 1, supplierProductId: product.supplierProductId || '',
    };
  }
  function emptyRule(rule = {}) {
    return { id: rule.id || '', scope: rule.scope || 'DEFAULT', scopeKey: rule.scopeKey || 'logs', mode: rule.mode || 'FIXED', value: rule.value ?? '' };
  }
  function emptyUpload() {
    return { productId: '', format: 'jsonl', content: '', source: 'text', authorizationConfirmed: false, single: { username: '', email: '', password: '', recoveryEmail: '', recoveryPassword: '', twoFactorSecret: '', notes: '', sourceRef: '' }, validating: false, committing: false, error: '' };
  }
  function clearPrivateAdminState() {
    state.summary = null; state.products = []; state.rules = []; state.imports = []; state.units = []; state.audits = [];
    state.supplier = null; state.checkoutOrders = []; state.recentOrders = []; state.recentAudits = []; state.orderFilter = 'All'; state.supplierStatus = null;
    state.error = ''; state.pageError = ''; state.loading = false; state.drawer = null; state.editingProduct = null; state.selectedDonProduct = null;
    state.productForm = emptyProduct(); state.socialStep = 1; state.socialGroup = ''; state.pricingForm = emptyRule();
    state.calculator = { cost: '', platform: '', productId: '', mode: 'FIXED', value: '', result: null, error: '' };
    state.inventory = { productId: '', status: '', query: '' };
    state.upload = emptyUpload(); state.uploadResult = null;
    state.inventoryError = ''; state.productsError = ''; state.rulesError = ''; state.importsError = ''; state.auditError = ''; state.unitsError = '';
  }
  async function request(path, init = {}) {
    const headers = new Headers(init.headers || {});
    headers.set('X-EJ-Request', '1');
    headers.set('Accept', 'application/json');
    if (init.body !== undefined) headers.set('Content-Type', 'application/json');
    if (csrfToken && init.method && init.method !== 'GET') headers.set('X-Admin-CSRF', csrfToken);
    let response;
    const endLoading = beginLoading(init.loadingLabel || 'Loading verified admin data…');
    try {
      response = await fetch(`${ADMIN_ROOT}${path}`, { ...init, headers, credentials: 'include' });
    } catch (error) {
      const wrapped = new Error('network'); wrapped.status = 0; throw wrapped;
    } finally { endLoading(); }
    let body = null;
    try { body = await response.json(); } catch { /* controlled below */ }
    if (!response.ok) {
      const envelope = body?.error && typeof body.error === 'object' ? body.error : body || {};
      const error = new Error('request');
      error.status = response.status;
      error.code = envelope.code || body?.code;
      error.backendMessage = envelope.message || body?.message;
      const issues = envelope.issues || envelope.errors || body?.issues || body?.errors;
      error.validationFields = Array.isArray(issues) ? issues.map((issue) => {
        if (typeof issue === 'string') return issue;
        const path = Array.isArray(issue?.path) ? issue.path.join('.') : (issue?.path || issue?.field || '');
        const message = issue?.message || issue?.code || '';
        return path && message ? `${path}: ${message}` : message || path;
      }) : [];
      throw error;
    }
    return body || {};
  }
  async function loadSession(token = revision) {
    try {
      const result = await request('/session');
      if (!isCurrent(token)) return;
      session = result.user || null; csrfToken = result.csrfToken || null; setupReady = result.setupReady !== false;
      state.error = '';
    } catch (error) {
      if (!isCurrent(token)) return;
      session = null; csrfToken = null; state.error = controlledError(error, 'Could not reach the admin service. Check the service and retry.');
    }
  }
  async function loadRouteData(token, path) {
    if (!session || path === '/admin/login') return;
    state.loading = true; render();
    try {
      if (path === '/admin' || path === '/admin/') {
        const [result, , extras] = await Promise.all([
          request('/summary'),
          loadProducts(token),
          Promise.allSettled([request('/commerce/orders'), request('/audit')]),
        ]);
        if (!isCurrent(token)) return; state.summary = result; state.supplier = result.supplier || null;
        // Orders and audit feeds are optional extras: a failure here must never break the overview.
        const [ordersResult, auditResult] = extras;
        state.recentOrders = ordersResult.status === 'fulfilled' && Array.isArray(ordersResult.value?.orders) ? ordersResult.value.orders : [];
        state.recentAudits = auditResult.status === 'fulfilled' && Array.isArray(auditResult.value?.events) ? auditResult.value.events : [];
      } else if (path === '/admin/products' || path === '/admin/pricing' || path === '/admin/inventory') {
        const result = await request('/products'); if (!isCurrent(token)) return; state.products = Array.isArray(result.products) ? result.products : [];
      } else if (path === '/admin/uploads') {
        await loadProducts(token); const result = await request('/imports'); if (!isCurrent(token)) return; state.imports = Array.isArray(result.imports) ? result.imports : [];
      } else if (path === '/admin/orders' || path === '/admin/checkout') {
        const result = await request('/commerce/orders'); if (!isCurrent(token)) return; state.checkoutOrders = Array.isArray(result.orders) ? result.orders : [];
      } else if (path === '/admin/supplier') {
        const result = await request('/providers/status'); if (!isCurrent(token)) return; state.supplierStatus = result;
      } else if (path === '/admin/audit-logs') {
        const result = await request('/audit'); if (!isCurrent(token)) return; state.audits = Array.isArray(result.events) ? result.events : [];
      }
      if (isCurrent(token)) { state.pageError = ''; state.loading = false; render(); }
    } catch (error) {
      if (!isCurrent(token)) return;
      state.loading = false; state.pageError = controlledError(error, 'Could not load this admin view.'); render();
    }
  }
  async function loadProducts(token = revision) {
    const result = await request('/products'); if (!isCurrent(token)) return;
    state.products = Array.isArray(result.products) ? result.products : [];
  }
  async function loadUnits(token = revision) {
    const params = new URLSearchParams(); if (state.inventory.productId) params.set('productId', state.inventory.productId); if (state.inventory.status) params.set('status', state.inventory.status);
    const result = await request(`/inventory${params.toString() ? `?${params}` : ''}`); if (!isCurrent(token)) return;
    state.units = Array.isArray(result.units) ? result.units : [];
  }
  function navItems() {
    return [
      ['Overview', '/admin', 'home'], ['Products', '/admin/products', 'box'], ['Uploads', '/admin/uploads', 'upload'], ['Orders', '/admin/orders', 'orders'], ['Checkout', '/admin/checkout', 'wallet'], ['Supplier', '/admin/supplier', 'refresh'], ['Audit logs', '/admin/audit-logs', 'audit'],
    ];
  }
  function adminLink(path, label, glyph) { return `<a class="ej-admin-nav-link ${currentRoute === path ? 'active' : ''}" href="${path}" data-admin-link="${path}">${icon(glyph, 18)}<span>${label}</span></a>`; }
  function shell(content) {
    const email = session?.email || '';
    return `<div class="ej-admin-shell"><aside class="ej-admin-sidebar" data-admin-sidebar><div class="ej-admin-brand"><a href="/" data-admin-link="/" aria-label="Emmyjosh Logs home">${logo('ej-admin-logo')}</a><button class="ej-admin-icon-button ej-admin-close-mobile" type="button" data-admin-action="menu" aria-label="Close menu">${icon('close', 19)}</button></div><div class="ej-admin-sidebar-kicker">ADMIN WORKSPACE</div><nav class="ej-admin-nav" aria-label="Admin navigation">${navItems().map(([label, path, glyph]) => adminLink(path, label, glyph)).join('')}</nav><div class="ej-admin-sidebar-foot"><a class="ej-admin-market-link" href="/marketplace" data-admin-link="/marketplace">${icon('external', 16)} <span>Customer marketplace</span></a><div class="ej-admin-legacy-note">Legacy admin sections remain preview-only.</div><button class="ej-admin-nav-link" type="button" data-admin-action="logout">${icon('logout', 18)}<span>Sign out</span></button></div></aside><div class="ej-admin-main"><header class="ej-admin-topbar"><button class="ej-admin-icon-button ej-admin-menu-button" type="button" data-admin-action="menu" aria-label="Open admin menu">${icon('menu', 20)}</button><div class="ej-admin-breadcrumb"><span>Workspace</span><b>/</b><strong>${escapeHTML(pageTitle(currentRoute))}</strong></div><div class="ej-admin-top-actions"><span class="ej-admin-session-pill">${icon('lock', 14)} Secure session</span><span class="ej-admin-avatar">${escapeHTML((email[0] || 'A').toUpperCase())}</span><span class="ej-admin-email">${escapeHTML(email)}</span><button class="button button-small ej-admin-top-logout" type="button" data-admin-action="logout">Sign out</button></div></header><main class="ej-admin-content">${content}</main></div></div><div class="ej-admin-toast-slot" data-admin-toast aria-live="polite"></div>`;
  }
  function pageTitle(path) { return ({ '/admin': 'Overview', '/admin/products': 'Products', '/admin/pricing': 'Products', '/admin/inventory': 'Products', '/admin/uploads': 'Uploads', '/admin/orders': 'Orders', '/admin/checkout': 'Checkout', '/admin/supplier': 'Supplier', '/admin/audit-logs': 'Audit logs' })[path] || 'Admin'; }
  function authGate() {
    if (currentRoute === '/admin/login') return loginPage();
    if (!session) return shell(`<section class="ej-admin-empty ej-admin-gate"><div class="ej-admin-empty-icon">${icon('lock', 28)}</div><span class="ej-admin-eyebrow">ROLE-PROTECTED WORKSPACE</span><h1>Admin sign-in required</h1><p>No public or assumed admin access is available. Sign in with a server-confirmed admin account to continue.</p><a class="button" href="/admin/login" data-admin-link="/admin/login">Sign in securely ${icon('arrow', 16)}</a>${state.error ? `<div class="ej-admin-alert error" role="alert">${icon('warning', 17)}<span>${escapeHTML(state.error)}</span><button type="button" class="link-button" data-admin-action="retry-session">Retry</button></div>` : ''}</section>`);
    return null;
  }
  function loginPage() {
    ensureLoginStyles();
    const feedback = state.pageError || state.error;
    const chips = [
      ['box', 'Catalog & pricing', 'top:17%;right:7%', 'ejl-float'],
      ['upload', 'Stock imports', 'top:37%;right:26%', 'ejl-float ejl-float-b'],
      ['audit', 'Audit trail', 'top:56%;right:8%', 'ejl-float'],
    ].map(([glyph, label, pos, cls]) => `<span class="ejl-chip ${cls}" style="${pos}">${icon(glyph, 18)}${escapeHTML(label)}</span>`).join('');
    return `<div class="ejl-page"><aside class="ejl-brand"><div class="ejl-deco" aria-hidden="true"><i class="ejl-ring" style="width:560px;height:560px;right:-200px;top:60px"></i><i class="ejl-ring" style="width:380px;height:380px;right:-110px;top:150px"></i><i class="ejl-ring" style="width:200px;height:200px;right:-20px;top:240px"></i><i class="ejl-dots"></i>${chips}</div><a class="ejl-badge" href="/" data-admin-link="/" aria-label="Emmyjosh Logs home">${logo('ejl-logo')}</a><div class="ejl-brand-copy"><h2>Welcome back</h2><p>Secure catalog, pricing, stock and import controls for the admin team.</p></div></aside><section class="ejl-formside"><a class="ejl-back" href="/" data-admin-link="/">${icon('arrow', 16)} Back to marketplace</a><div class="ejl-inner"><span class="ejl-eyebrow">SECURE ADMIN ACCESS</span><h1>Admin sign in</h1><p class="ejl-sub">Use your configured admin credentials. This form never stores passwords in the browser.</p>${!setupReady ? `<div class="ej-admin-alert warning">${icon('warning', 17)}<span>Admin setup is not ready on the server. Bootstrap the backend before attempting login.</span></div>` : ''}${feedback ? `<div class="ej-admin-alert error" role="alert">${icon('warning', 17)}<span>${escapeHTML(feedback)}</span><button type="button" class="link-button" data-admin-action="${logoutRetry ? 'retry-logout' : 'retry-session'}">Retry</button></div>` : ''}<form data-admin-form="login" class="ejl-form"><label class="ejl-field">Email address<input name="email" type="email" required autocomplete="username" placeholder="admin@example.com"></label><label class="ejl-field">Password<input name="password" type="password" required autocomplete="current-password" minlength="12" placeholder="Your admin password"></label><button class="ejl-submit" type="submit" ${!setupReady ? 'disabled' : ''}>Sign in to admin ${icon('arrow', 16)}</button></form><p class="ejl-note">Session cookies and CSRF tokens are supplied by the admin service. Do not use this form on shared computers.</p></div></section></div><div class="ej-admin-toast-slot" data-admin-toast aria-live="polite"></div>`;
  }
  function header(kicker, title, description, action = '') { return `<div class="ej-admin-page-head"><div><span class="ej-admin-eyebrow">${escapeHTML(kicker)}</span><h1>${title}</h1>${description ? `<p>${escapeHTML(description)}</p>` : ''}</div>${action}</div>`; }
  function alertBox(message, tone = 'error', retry = false) { return `<div class="ej-admin-alert ${tone}" role="alert">${icon(tone === 'error' ? 'warning' : 'check', 17)}<span>${escapeHTML(message)}</span>${retry ? '<button type="button" class="link-button" data-admin-action="retry-page">Retry</button>' : ''}</div>`; }
  function loadingBox() { return `<div class="ej-admin-loading" aria-busy="true"><span class="loader"></span><span>Loading verified admin data…</span></div><div class="ej-admin-skeleton" aria-hidden="true"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div>`; }
  function metric(label, value, helper, glyph, tone = '') { return `<article class="ej-admin-metric ${tone}"><span class="ej-admin-metric-icon">${icon(glyph, 21)}</span><span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong><small>${escapeHTML(helper)}</small></article>`; }
  function emptyState(title, message, glyph = 'file') { return `<div class="ej-admin-empty"><div class="ej-admin-empty-icon">${icon(glyph, 26)}</div><b>${escapeHTML(title)}</b><p>${escapeHTML(message)}</p></div>`; }
  function insightsMarkup() {
    const orders = state.recentOrders || [];
    const audits = state.recentAudits || [];
    const upper = (value) => String(value || '').toUpperCase();
    const needsReview = orders.filter((order) => ['RECONCILIATION', 'FAILED'].includes(upper(order.status))).length;
    const inProgress = orders.filter((order) => ['PENDING', 'PROCESSING'].includes(upper(order.status))).length;
    const attention = [];
    if (needsReview) attention.push(['warning', `${needsReview} order${needsReview === 1 ? '' : 's'} need review`, 'Reconciliation or failed status', '/admin/checkout']);
    if (inProgress) attention.push(['refresh', `${inProgress} order${inProgress === 1 ? '' : 's'} in progress`, 'Waiting on confirmation', '/admin/checkout']);
    if (state.summary && Number(state.summary.available) === 0) attention.push(['box', 'No stock available', 'Import units to sell your own logs', '/admin/uploads']);
    const attentionList = attention.length
      ? attention.map(([glyph, title, note, href]) => `<a class="ej-admin-attention-item" href="${href}" data-admin-link="${href}">${icon(glyph, 18)}<span><b>${escapeHTML(title)}</b><small>${escapeHTML(note)}</small></span>${icon('arrow', 15)}</a>`).join('')
      : `<div class="ej-admin-attention-ok">${icon('check', 18)}<span><b>All clear</b><small>Nothing needs your attention right now.</small></span></div>`;
    const recentOrders = orders.slice(0, 5);
    const recentAudits = audits.slice(0, 5);
    return `<section class="ej-admin-insights"><article class="ej-admin-panel"><div class="ej-admin-panel-head"><div><span class="ej-admin-eyebrow">NEEDS ATTENTION</span><h2>Today</h2></div></div><div class="ej-admin-attention">${attentionList}</div></article><article class="ej-admin-panel"><div class="ej-admin-panel-head"><div><span class="ej-admin-eyebrow">SALES</span><h2>Recent orders</h2></div><a class="link-button" href="/admin/checkout" data-admin-link="/admin/checkout">View all</a></div>${recentOrders.length ? `<ul class="ej-admin-feed">${recentOrders.map((order) => `<li><span><b><code>${escapeHTML(order.id || order.orderReference || '—')}</code></b><small>${dateLabel(order.updatedAt || order.createdAt)}</small></span><span class="ej-admin-feed-end"><span class="ej-admin-status ${statusClass(order.status)}">${escapeHTML(order.status || '—')}</span><small>${minorMoneyLabel(order.totalMinor ?? order.amountMinor ?? order.total ?? '')}</small></span></li>`).join('')}</ul>` : `<p class="ej-admin-muted">No orders returned yet.</p>`}</article><article class="ej-admin-panel"><div class="ej-admin-panel-head"><div><span class="ej-admin-eyebrow">ACTIVITY</span><h2>Latest events</h2></div><a class="link-button" href="/admin/audit-logs" data-admin-link="/admin/audit-logs">Audit trail</a></div>${recentAudits.length ? `<ul class="ej-admin-feed">${recentAudits.map((event) => `<li><span><b>${escapeHTML(event.action || 'Event')}</b><small>${escapeHTML(event.actorEmail || '—')}</small></span><span class="ej-admin-feed-end"><small>${dateLabel(event.createdAt)}</small></span></li>`).join('')}</ul>` : `<p class="ej-admin-muted">No recent events returned.</p>`}</article></section>`;
  }
  function overviewPage() {
    const summary = state.summary || {};
    const supplier = summary.supplier || state.supplier || { enabled: false, mode: 'sandbox', message: 'Supplier purchasing is intentionally locked until stock is approved.' };
    return shell(`${header('CONTROL CENTER', `${new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening'}, admin.`, 'A live operational view of your product catalogue, imports and orders.', `<a class="button button-small" href="/admin/products" data-admin-link="/admin/products">${icon('plus', 15)} New product</a>`)}${state.pageError ? alertBox(state.pageError, 'error', true) : ''}${state.loading && !state.summary ? loadingBox() : `<section class="ej-admin-metrics">${metric('Products', String(summary.products ?? '—'), 'Catalog records', 'box', 'orange')}${metric('Available stock', String(summary.available ?? '—'), 'Units ready to sell', 'warehouse', 'green')}${metric('Imports', String(summary.imports ?? '—'), 'Validated and committed batches', 'upload', 'brown')}${metric('Don Logs', String(state.products.filter((p) => p.source === 'DONMARKETPLACE').length || '—'), 'Supplier catalogue listings', 'refresh', 'yellow')}</section>${insightsMarkup()}<section class="ej-admin-overview-grid"><article class="ej-admin-panel ej-admin-feature-panel"><div><span class="ej-admin-eyebrow light">OPERATIONS LEDGER</span><h2>Build a catalog<br>you can trust.</h2><p>Every price is calculated by the server, every stock action is audited, and credentials stay encrypted.</p><a class="button button-light" href="/admin/audit-logs" data-admin-link="/admin/audit-logs">Review audit trail ${icon('arrow', 15)}</a></div><div class="ej-admin-orbit-art">${icon('shield', 48)}<span></span><span></span></div></article><article class="ej-admin-panel"><div class="ej-admin-panel-head"><div><span class="ej-admin-eyebrow">SUPPLIER CONNECTION</span><h2>Stock source</h2></div><span class="ej-admin-lock-pill">${icon('lock', 13)} Locked</span></div><div class="ej-admin-supplier-lock">${icon('lock', 22)}<div><b>${escapeHTML(supplier.mode || 'Sandbox')} mode</b><p>${escapeHTML(supplier.message || 'Supplier purchasing is not enabled.')}</p></div></div><p class="ej-admin-muted">Only manually imported OWN products can receive inventory in this workspace.</p></article></section><section class="ej-admin-quick-grid"><a href="/admin/uploads" data-admin-link="/admin/uploads" class="ej-admin-quick-card"><span>${icon('upload', 20)}</span><b>Import stock</b><small>Validate credentials safely</small>${icon('arrow', 16)}</a><a href="/admin/products" data-admin-link="/admin/products" class="ej-admin-quick-card"><span>${icon('box', 20)}</span><b>Manage products</b><small>Open Don Logs or My SocialLogs</small>${icon('arrow', 16)}</a></section>`}`);
  }
  function pricingMarkup(pricing, compact = false) {
    if (!pricing) return '<span class="ej-admin-unknown">Pricing unavailable</span>';
    const cost = pricing.costMinor === null || pricing.costMinor === undefined ? 'Unknown' : minorMoneyLabel(pricing.costMinor);
    const retail = pricing.retailMinor === null || pricing.retailMinor === undefined ? 'Unknown' : minorMoneyLabel(pricing.retailMinor);
    const gross = pricing.grossMinor === null || pricing.grossMinor === undefined ? 'Unknown' : minorMoneyLabel(pricing.grossMinor);
    const scope = pricing.scope || 'Unknown scope';
    const version = pricing.version === null || pricing.version === undefined ? '—' : `v${pricing.version}`;
    return `<span class="ej-admin-pricing-meta ${compact ? 'compact' : ''}"><b>Retail ${escapeHTML(retail)}</b><small>Cost ${escapeHTML(cost)} · Gross ${escapeHTML(gross)}</small><small>${escapeHTML(scope)} · ${escapeHTML(version)}${gross === 'Unknown' ? ' · Margin unknown' : ''}</small></span>`;
  }
  function productCountMarkup(product) {
    const counts = product.counts || {};
    return `<span class="ej-admin-counts">A ${escapeHTML(String(counts.AVAILABLE ?? product.availableCount ?? 0))} · R ${escapeHTML(String(counts.RESERVED ?? 0))} · S ${escapeHTML(String(counts.SOLD ?? 0))} · Q ${escapeHTML(String(counts.QUARANTINED ?? 0))}</span>`;
  }
  function productRows() {
    const visible = state.products.filter((product) => product.source === state.productTab);
    if (!visible.length) {
      const own = state.productTab === 'OWN';
      return `<tr><td colspan="5">${emptyState(own ? 'No SocialLogs yet' : 'No Don Logs synced yet', own ? 'Create your first Emmyjosh-owned SocialLog.' : 'Sync the Donmarketplace catalogue to see supplier logs here.', 'box')}</td></tr>`;
    }
    return visible.map((product) => {
      const isDon = product.source === 'DONMARKETPLACE';
      const apiPrice = product.acquisitionCost ? moneyLabel(product.acquisitionCost) : 'Unavailable';
      const sellingPrice = product.pricing?.retailMinor != null ? minorMoneyLabel(product.pricing.retailMinor) : 'Not set';
      return `<tr><td><span class="ej-admin-table-product">${platformBadge(product.platform)}<span><b>${escapeHTML(product.name)}</b><small>${escapeHTML(product.id)}</small></span></span></td><td><span class="ej-admin-status ${statusClass(product.status)}">${escapeHTML(product.status || '—')}</span></td>${isDon ? `<td>${escapeHTML(apiPrice)}</td><td><b>${escapeHTML(sellingPrice)}</b></td><td><button class="button button-small button-outline" type="button" data-admin-action="open-don-product" data-id="${escapeHTML(product.id)}">${product.status === 'ACTIVE' ? 'View / Edit price' : 'Set price & activate'}</button></td>` : `<td>${escapeHTML(sellingPrice)}</td><td>${productCountMarkup(product)}</td><td><button class="button button-small button-outline" type="button" data-admin-action="edit-product" data-id="${escapeHTML(product.id)}">Edit</button></td>`}</tr>`;
    }).join('');
  }
  function productsPage() {
    const ownTab = state.productTab === 'OWN';
    const tabCount = state.products.filter((product) => product.source === state.productTab).length;
    const action = ownTab
      ? `<button class="button button-small" type="button" data-admin-action="new-product">${icon('plus', 15)} Create SocialLog</button>`
      : `<button class="button button-small" type="button" data-admin-action="supplier-sync">${icon('refresh', 15)} Sync Don Logs</button>`;
    return shell(`${header('CATALOG', 'Products', 'Manage supplier-sourced Don Logs and your own SocialLogs separately.', action)}${state.pageError ? alertBox(state.pageError, 'error', true) : ''}<section class="ej-admin-panel ej-admin-table-panel"><div class="ej-admin-product-tabs" role="tablist" aria-label="Product sources"><button type="button" role="tab" aria-selected="${!ownTab}" class="ej-admin-product-tab ${!ownTab ? 'active' : ''}" data-admin-action="product-tab" data-tab="DONMARKETPLACE">Don Logs <span>${state.products.filter((p) => p.source === 'DONMARKETPLACE').length}</span></button><button type="button" role="tab" aria-selected="${ownTab}" class="ej-admin-product-tab ${ownTab ? 'active' : ''}" data-admin-action="product-tab" data-tab="OWN">My SocialLogs <span>${state.products.filter((p) => p.source === 'OWN').length}</span></button></div><div class="ej-admin-panel-head"><div><span class="ej-admin-eyebrow">${ownTab ? 'EMMYJOSH INVENTORY' : 'SUPPLIER CATALOGUE'}</span><h2>${tabCount} ${ownTab ? 'SocialLog' : 'Don Log'}${tabCount === 1 ? '' : 's'}</h2></div><button class="button button-small button-outline" type="button" data-admin-action="refresh-page">${icon('refresh', 14)} Refresh</button></div>${state.loading ? loadingBox() : `<div class="ej-admin-table-wrap"><table class="ej-admin-table"><thead><tr><th>Product</th><th>Status</th>${ownTab ? '<th>Selling price</th><th>Stock counts</th>' : '<th>Supplier price</th><th>Your selling price</th>'}<th></th></tr></thead><tbody>${productRows()}</tbody></table></div>`}</section>${state.drawer === 'social' ? socialWizardDrawer() : state.drawer ? productDrawer() : ''}${state.selectedDonProduct ? donProductDrawer(state.selectedDonProduct) : ''}`);
  }
  function donProductDrawer(product) {
    const apiPrice = product.acquisitionCost || '';
    const sellingPrice = product.pricing?.retailMinor != null ? (Number(product.pricing.retailMinor) / 100).toFixed(2) : '';
    return `<div class="ej-admin-drawer-backdrop" data-admin-action="close-don-product"><aside class="ej-admin-drawer" data-admin-drawer role="dialog" aria-modal="true" aria-labelledby="don-product-title"><div class="ej-admin-drawer-head"><div><span class="ej-admin-eyebrow">DONMARKETPLACE LISTING</span><h2 id="don-product-title">${escapeHTML(product.name)}</h2></div><button class="ej-admin-icon-button" type="button" data-admin-action="close-don-product" aria-label="Close">${icon('close', 20)}</button></div><div class="ej-admin-don-product-meta">${platformBadge(product.platform)}<span class="ej-admin-status ${statusClass(product.status)}">${escapeHTML(product.status)}</span></div><div class="ej-admin-don-price-card"><span>Supplier price</span><strong>${apiPrice ? moneyLabel(apiPrice) : 'Unavailable'}</strong><small>Supplier product ID: ${escapeHTML(product.supplierProductId || 'Not mapped')}</small></div><form class="ej-admin-form" data-admin-form="don-price"><label>Your selling price (₦)<input name="sellingPrice" inputmode="decimal" required min="0.01" step="0.01" placeholder="Enter your selling price" value="${escapeHTML(sellingPrice)}"></label><p class="ej-admin-field-help">Your selling price must be at least the supplier price. Customers will see your selling price, not the supplier cost.</p><div class="ej-admin-drawer-actions"><button type="button" class="button button-outline" data-admin-action="close-don-product">Cancel</button><button type="submit" class="button" ${busy || !apiPrice ? 'disabled' : ''}>${product.status === 'ACTIVE' ? 'Save selling price' : 'Save price & Activate'} ${icon('check', 15)}</button></div></form>${product.status === 'ACTIVE' ? `<div class="ej-admin-drawer-actions"><button type="button" class="button button-outline ej-admin-danger-link" data-admin-action="deactivate-don-product" data-id="${escapeHTML(product.id)}">Deactivate listing</button></div>` : ''}</aside></div>`;
  }
  const SOCIAL_GROUPS = [
    ['FACEBOOK','Facebook Pages'],['TIKTOK','TikTok'],['ICLOUD','iCloud'],['INSTAGRAM','Instagram'],['VPN','VPN'],['TWITTER','X / Twitter Followers'],['TUTORIAL','Ads Tutorials'],['WEBSITE','Website Services'],['WORKING_TOOLS','Working Tools'],['TEXTING','TextPlus / NextPlus'],['TELEGRAM','Telegram Accounts'],['MAIL','Gmail / Outlook / Mail'],['OTHER','Other Social Account'],['FORMAT','Format']
  ];
  function socialChoices(name, values, multiple = false) {
    return `<div class="ej-social-choice-grid">${values.map(([value,label]) => `<label class="ej-social-choice"><input type="${multiple ? 'checkbox' : 'radio'}" name="${name}" value="${value}" ${multiple ? '' : 'required'}><span>${escapeHTML(label)}</span></label>`).join('')}</div>`;
  }
  function socialVariantFields(group) {
    if (group === 'FACEBOOK') return `<label>Facebook page types</label>${socialChoices('pageTypes',[['CREATE_PAGE','Create Page'],['CREATED_PAGE','Created Page'],['MULTI_PAGE','2 Created Pages'],['PAGE_WITH_FOLLOWERS','Page with 1K+ Followers']],true)}<label>Followers for page-with-followers (default 1000)<input name="followers" type="number" min="1" placeholder="1000"></label>`;
    if (group === 'TIKTOK') return `<label class="check-label"><input type="checkbox" name="includeFollowerTier" value="1"><span>Include a TikTok follower listing</span></label><label>Follower tier</label><select name="followers"><option value="200">200+</option><option value="500">500+</option><option value="1000">1K+</option></select><label>TikTok countries</label>${socialChoices('countries',[['USA','USA'],['UK','UK'],['CANADA','Canada'],['GERMANY','Germany'],['RANDOM','Random Country']],true)}`;
    if (group === 'ICLOUD') return `<p class="ej-admin-field-help">iCloud listings are fixed to the USA.</p>`;
    if (group === 'INSTAGRAM') return `<label>Instagram types</label>${socialChoices('subTypes',[['MONTHS_OLD','Months Old'],['EMPTY_AGED','Empty Aged'],['AGED_500','Aged with 500+']],true)}`;
    if (group === 'VPN') return `<label>VPN variants</label>${socialChoices('subTypes',[['PIA_7D','7 Days PIA VPN'],['EXPRESS_1M','Express VPN · 1 Month'],['HMA_1M','HMA VPN · 1 Month'],['NORD_1M','Nord VPN · 1 Month']],true)}`;
    if (group === 'TUTORIAL') return `<label>Tutorial types</label>${socialChoices('subTypes',[['FACEBOOK_ADS','Facebook Ads'],['INSTAGRAM_ADS','Instagram Ads'],['TIKTOK_ADS','TikTok Ads'],['TWITTER_ADS','Twitter Ads']],true)}`;
    if (group === 'WEBSITE') return `<label>Website services</label>${socialChoices('subTypes',[['LOGS_WEBSITE','Logs Website'],['SMS_WEBSITE','SMS Website'],['BOTH_WEBSITE','Logs + SMS Website'],['BOOSTING_WEBSITE','Boosting Website']],true)}`;
    if (group === 'WORKING_TOOLS') return `<label>Tool boxes</label>${socialChoices('subTypes',[['TOOL_1','Tool Box 1'],['TOOL_2','Tool Box 2'],['TOOL_3','Tool Box 3']],true)}<label>Tool link<input name="toolLink" type="url" placeholder="https://..."></label>`;
    if (group === 'TEXTING') return `<label>Platforms</label>${socialChoices('platforms',[['TEXTPLUS','TextPlus'],['NEXTPLUS','NextPlus']],true)}`;
    if (group === 'MAIL') return `<label>Mail platforms</label>${socialChoices('platforms',[['GMAIL','Gmail'],['OUTLOOK','Outlook'],['MAIL','Mail']],true)}`;
    if (group === 'TWITTER') return `<label>Follower tier</label><select name="followers"><option value="0">Empty Aged</option><option value="100">100+</option><option value="200">200+</option><option value="500">500+</option></select>`;
    if (group === 'OTHER') return `<div class="ej-admin-form-grid"><label>Platform<select name="platform" required>${optionList(['OTHER','SNAPCHAT','DISCORD','REDDIT','LINKEDIN','YOUTUBE','INSTAGRAM','FACEBOOK','TIKTOK','X','TELEGRAM'])}</select></label><label>Category<select name="category" required>${optionList(['TELEGRAM_ACCOUNT','FACEBOOK_COUNTRY'])}</select></label></div>`;
    if (group === 'FORMAT') return `<div class="ej-format-config"><div class="ej-admin-form-grid"><label>Platform<select name="formatPlatform" required>${optionList(['OTHER','INSTAGRAM','FACEBOOK','TIKTOK','X','SNAPCHAT','TELEGRAM','DISCORD','REDDIT','LINKEDIN','YOUTUBE','GMAIL','OUTLOOK','MAIL','VPN','TEXTPLUS','NEXTPLUS','ICLOUD','TOOL'])}</select><small>Choose the closest platform, or OTHER for a general format.</small></label><label>Format name<input name="formatName" required maxlength=160 placeholder="e.g. Facebook Ads Account Format"></label></div><div class="ej-format-type-wrap"><span class="ej-format-label">What are you submitting?</span><div class="ej-format-type-grid"><label class="ej-format-type-card selected"><input type="radio" name="formatType" value="WRITEUP" checked><span class="ej-format-type-icon">Aa</span><span><b>Write-up</b><small>Text content, instructions or a format description</small></span></label><label class="ej-format-type-card"><input type="radio" name="formatType" value="CREDENTIALS"><span class="ej-format-type-icon">•••</span><span><b>Credentials</b><small>Private login details or sensitive account data</small></span></label></div></div><div class="ej-format-content" data-format-panel="WRITEUP"><label>Write-up content<textarea name="formatWriteup" rows="7" maxlength="20000" required placeholder="Write the format content customers should receive..."></textarea><small>Private buyer-only content. Customers receive it only after a successful purchase.</small></label></div><div class="ej-format-content" data-format-panel="CREDENTIALS" hidden><label>Credential details<textarea name="formatCredentials" rows="7" maxlength="20000" placeholder="Enter the private format or account details..." autocomplete="off"></textarea><small class="ej-format-security-note">Private buyer-only content. Encrypted and released only after a successful purchase.</small></label></div></div>`;
    return `<p class="ej-admin-field-help">Telegram account listing.</p>`;
  }
  function socialWizardDrawer() {
    const group = state.socialGroup;
    const formatMode = group === 'FORMAT';
    const title = SOCIAL_GROUPS.find(x => x[0] === group)?.[1] || 'SocialLog details';
    if (state.socialStep === 1) return `<div class="ej-admin-drawer-backdrop" data-admin-action="close-drawer"><aside class="ej-admin-drawer ej-social-wizard" data-admin-drawer role="dialog" aria-modal="true" aria-labelledby="social-title"><div class="ej-social-wizard-top"><div><span class="ej-admin-eyebrow">MY SOCIALLOGS · CREATE LISTING</span><h2 id="social-title">What are you adding?</h2><p class="ej-admin-muted">Choose a category to load the right listing fields. You can create up to 25 variants in one submission.</p></div><button class="ej-admin-icon-button" type="button" data-admin-action="close-drawer" aria-label="Close">${icon('close',20)}</button></div><div class="ej-social-step-track"><span class="active">01 <b>Category</b></span><i></i><span>02 <b>Details</b></span></div><div class="ej-social-group-grid">${SOCIAL_GROUPS.map(([value,label]) => `<button type="button" class="ej-social-group-card ${group===value?'selected':''}" data-admin-action="social-group" data-group="${value}" aria-pressed="${group===value}"><span class="ej-social-card-mark">${value==='FORMAT'?'Aa':value.slice(0,2)}</span><span class="ej-social-card-copy"><b>${escapeHTML(label)}</b><small>${value==='FORMAT'?'Custom write-ups or secure credential formats':value==='OTHER'?'Other supported social account listings':'Create a '+label+' listing'}</small></span><span class="ej-social-card-arrow">${icon('arrow',15)}</span></button>`).join('')}</div><div class="ej-admin-drawer-actions ej-social-actions"><button type="button" class="button button-outline" data-admin-action="close-drawer">Cancel</button><button type="button" class="button" data-admin-action="social-next" ${group?'':'disabled'}>Continue ${icon('arrow',15)}</button></div></aside></div>`;
    return `<div class="ej-admin-drawer-backdrop" data-admin-action="close-drawer"><aside class="ej-admin-drawer ej-social-wizard ej-social-wizard-details" data-admin-drawer role="dialog" aria-modal="true" aria-labelledby="social-title"><div class="ej-social-wizard-top"><div><span class="ej-admin-eyebrow">MY SOCIALLOGS · CREATE LISTING</span><h2 id="social-title">${escapeHTML(title)}</h2><p class="ej-admin-muted">Add the listing information and set your own selling price.</p></div><button class="ej-admin-icon-button" type="button" data-admin-action="close-drawer" aria-label="Close">${icon('close',20)}</button></div><div class="ej-social-step-track"><span class="complete">01 <b>Category</b></span><i class="complete"></i><span class="active">02 <b>Details</b></span></div><form class="ej-admin-form ej-social-form" data-admin-form="social">${formatMode ? `<section class="ej-social-section ej-social-format-section"><div class="ej-social-section-heading"><div><span class="ej-admin-eyebrow">CUSTOM FORMAT</span><h3>Format setup</h3><p>Define the format and decide whether its content is public or private.</p></div><span class="ej-social-section-index">01</span></div>${socialVariantFields(group)}</section>` : `<section class="ej-social-section"><div class="ej-social-section-heading"><div><span class="ej-admin-eyebrow">01 · CONFIGURATION</span><h3>Listing options</h3></div></div>${socialVariantFields(group)}</section>`}<section class="ej-social-section"><div class="ej-social-section-heading"><div><span class="ej-admin-eyebrow">02 · LISTING</span><h3>${formatMode?'Pricing & presentation':'Product details'}</h3><p>${formatMode?'Set the customer-facing price and optional listing image.':'Add the listing label, age, price and customer-facing details.'}</p></div><span class="ej-social-section-index">02</span></div><div class="ej-admin-form-grid"><label>${formatMode?'Listing label':'Username / listing label'}<input name="username" ${formatMode?'':'required'} maxlength="160" placeholder="${formatMode?'Optional short display label':'Enter username or listing label'}"></label>${formatMode?'':`<label>Age (months)<input name="age" type="number" min="1" max="1200" ${group==='WORKING_TOOLS'?'disabled value="0"':'required'} placeholder="e.g. 6"></label>`}<label>Your selling price (₦)<input name="price" required inputmode="decimal" placeholder="Enter selling price"></label>${formatMode?'':`<label>Country<input name="country" maxlength="80" placeholder="Required for TikTok country"></label>`}<label>Image URL<input name="image" type="url" placeholder="https://..."></label></div>${formatMode?`<p class="ej-admin-field-help">The format name becomes the product title. The selected content type determines where its text is stored.</p>`:`<label>Description<textarea name="description" rows="3" maxlength="2000" placeholder="Add a short customer-facing description..."></textarea></label><div class="ej-social-flags">${[['emailAttached','Email attached'],['phoneAttached','Phone attached'],['twoFactor','2FA enabled'],['ogEmail','Original email'],['verified','Verified']].map(([n,l])=>`<label class="check-label"><input type="checkbox" name="${n}"><span>${l}</span></label>`).join('')}</div>`}</section>${formatMode?'':`<section class="ej-social-section"><div class="ej-social-section-heading"><div><span class="ej-admin-eyebrow">03 · FULFILMENT</span><h3>Private account details</h3><p>These fields are encrypted and only used when fulfilling an order.</p></div><span class="ej-social-section-index">03</span></div><div class="ej-admin-form-grid"><label>Login username<input name="loginUsername" autocomplete="off"></label><label>Login email<input name="loginEmail" type="email" autocomplete="off"></label><label>Email password<input name="emailPassword" type="password" autocomplete="new-password"></label><label>Account password<input name="accountPassword" type="password" autocomplete="new-password"></label><label>2FA secret<input name="twoFactorSecret" autocomplete="off"></label><label>Recovery email<input name="recoveryEmail" type="email" autocomplete="off"></label><label>Recovery password<input name="recoveryPassword" type="password" autocomplete="new-password"></label></div><label>Backup codes <small>Separate with commas</small><textarea name="backupCodes" rows="2"></textarea></label><label>Cookies JSON<textarea name="cookies" rows="3" spellcheck="false" placeholder='{"session":"..."}'></textarea></label><label>Private notes <small>Admin-only; not included in buyer delivery</small><textarea name="notes" rows="2"></textarea></label></section>`}<div class="ej-admin-drawer-actions ej-social-actions"><button type="button" class="button button-outline" data-admin-action="social-back">Back</button><button type="submit" class="button" ${busy?'disabled':''}>Create SocialLog ${icon('check',15)}</button></div></form></aside></div>`;
  }

  function productDrawer() {
    const product = state.editingProduct;
    const form = state.productForm;
    return `<div class="ej-admin-drawer-backdrop" data-admin-action="close-drawer"><aside class="ej-admin-drawer" data-admin-drawer role="dialog" aria-modal="true" aria-labelledby="product-drawer-title"><div class="ej-admin-drawer-head"><div><span class="ej-admin-eyebrow">${product ? 'EDIT SOCIALLOG' : 'NEW SOCIALLOG'}</span><h2 id="product-drawer-title">${product ? 'Edit SocialLog' : 'Create SocialLog'}</h2></div><button class="ej-admin-icon-button" type="button" data-admin-action="close-drawer" aria-label="Close">${icon('close', 20)}</button></div><form class="ej-admin-form ej-admin-product-form" data-admin-form="product"><label>Name<input name="name" required maxlength="160" value="${escapeHTML(form.name)}"></label><div class="ej-admin-form-grid"><label>Platform<select name="platform">${optionList(PLATFORMS, form.platform)}</select></label><input type="hidden" name="source" value="OWN"><p class="ej-admin-field-help">Stored separately as your own SocialLog.</p></div><label>Description<textarea name="description" rows="3" maxlength="2000">${escapeHTML(form.description)}</textarea></label><label>Terms<textarea name="terms" rows="3" maxlength="4000">${escapeHTML(form.terms)}</textarea></label><div class="ej-admin-form-grid"><label>Your selling price (₦)<input name="sellingPrice" inputmode="decimal" required placeholder="Enter your price" value="${escapeHTML(form.sellingPrice)}"></label><label>Acquisition cost (₦)<input name="acquisitionCost" inputmode="decimal" placeholder="Optional" value="${escapeHTML(form.acquisitionCost)}"></label></div><label>Status<select name="status">${optionList(PRODUCT_STATUSES, form.status)}</select></label><div class="ej-admin-form-grid"><label>Minimum quantity<input name="minQty" type="number" min="1" max="100000" value="${escapeHTML(form.minQty)}"></label><label>Maximum quantity<input name="maxQty" type="number" min="1" max="100000" value="${escapeHTML(form.maxQty)}"></label></div><div class="ej-admin-drawer-actions"><button type="button" class="button button-outline" data-admin-action="close-drawer">Cancel</button><button type="submit" class="button" ${busy ? 'disabled' : ''}>${product ? 'Save changes' : 'Create SocialLog'} ${icon('check', 15)}</button>${product ? `<button type="button" class="link-button ej-admin-danger-link" data-admin-action="archive-product" data-id="${escapeHTML(product.id)}">Archive SocialLog</button>` : ''}</div></form></aside></div>`;
  }
  function modeUnit(mode) { return mode === 'SAVED' ? 'not used: saved rule' : mode === 'PERCENT' ? 'percent' : 'Naira'; }
  function scopeKeyField(form) {
    if (form.scope === 'DEFAULT') return `<input type="hidden" name="scopeKey" value="logs"><p class="ej-admin-field-help">Default scope key is fixed to <b>logs</b>.</p>`;
    const values = form.scope === 'PLATFORM' ? PLATFORMS : state.products.map((product) => product.id);
    return `<label>Scope key<select name="scopeKey" required>${values.length ? optionList(values, form.scopeKey) : '<option value="">No products available</option>'}</select></label>`;
  }
  function pricingPage() {
    const calcPricing = state.calculator.result?.pricing;
    const calcKnownMargin = calcPricing && calcPricing.grossMinor !== null && calcPricing.grossMinor !== undefined;
    return shell(`${header('REVENUE CONTROL', 'Pricing', 'Server-calculated Naira pricing with one winning rule per product.', `<button class="button button-small" type="button" data-admin-action="new-rule">${icon('plus', 15)} New rule</button>`)}${state.pageError ? alertBox(state.pageError, 'error', true) : ''}<section class="ej-admin-pricing-grid"><article class="ej-admin-panel"><div class="ej-admin-panel-head"><div><span class="ej-admin-eyebrow">RULE PRIORITY</span><h2>Scoped pricing rules</h2></div></div><p class="ej-admin-muted">Product rules win over platform rules, which win over the default rule. The server enforces the final result.</p>${state.loading && !state.rules.length ? loadingBox() : state.rules.length ? `<div class="ej-admin-rule-list">${state.rules.map((rule) => `<div class="ej-admin-rule"><span class="ej-admin-scope-dot ${rule.scope.toLowerCase()}">${rule.scope === 'DEFAULT' ? 'D' : rule.scope === 'PLATFORM' ? 'P' : 'R'}</span><div><b>${escapeHTML(rule.scope)} · ${escapeHTML(rule.scopeKey)}</b><small>${escapeHTML(rule.mode)} · ${escapeHTML(rule.value)} ${modeUnit(rule.mode)} · v${escapeHTML(rule.version)}</small></div><div class="ej-admin-rule-actions"><button type="button" class="link-button" data-admin-action="edit-rule" data-id="${escapeHTML(rule.id)}">Edit</button><button type="button" class="link-button ej-admin-danger-link" data-admin-action="delete-rule" data-id="${escapeHTML(rule.id)}">Delete</button></div></div>`).join('')}</div>` : emptyState('No pricing rules', 'No default rule is seeded. Add a rule or use the calculator before publishing.', 'tag')}</article><article class="ej-admin-panel"><div class="ej-admin-panel-head"><div><span class="ej-admin-eyebrow">SERVER CALCULATOR</span><h2>Preview a retail price</h2></div>${icon('calculator', 22)}</div><form class="ej-admin-form" data-admin-form="calculator"><label>Product <select name="productId"><option value="">No specific product</option>${state.products.map((p) => `<option value="${escapeHTML(p.id)}" ${p.id === state.calculator.productId ? 'selected' : ''}>${escapeHTML(p.name)}</option>`).join('')}</select></label><div class="ej-admin-form-grid"><label>Cost (₦)<input name="cost" inputmode="decimal" value="${escapeHTML(state.calculator.cost)}" placeholder="Unknown allowed for Manual"></label><label>Platform<select name="platform"><option value="">Use product/default</option>${optionList(PLATFORMS, state.calculator.platform)}</select></label></div><div class="ej-admin-form-grid"><label>Mode<select name="mode">${optionList(['SAVED', ...MODES], state.calculator.mode)}</select></label><label>Value (${modeUnit(state.calculator.mode)})<input name="value" inputmode="decimal" value="${escapeHTML(state.calculator.value)}" ${state.calculator.mode === 'SAVED' ? 'disabled' : ''} placeholder="${state.calculator.mode === 'PERCENT' ? 'Percent' : 'Naira'}"></label></div><button class="button button-small" type="submit" ${busy || state.upload.validating || state.upload.committing ? 'disabled' : ''}>Calculate on server ${icon('arrow', 15)}</button></form>${state.calculator.error ? alertBox(state.calculator.error, 'error') : ''}${state.calculator.result ? `<div class="ej-admin-calc-result ${calcPricing ? (calcKnownMargin ? 'positive' : 'neutral') : 'negative'}">${calcPricing ? `<span>${icon(calcKnownMargin ? 'check' : 'warning', 18)}</span><div><small>Server result · ${escapeHTML(calcPricing.scope || 'Unknown scope')} · ${calcPricing.version === undefined ? 'Version unknown' : `v${escapeHTML(calcPricing.version)}`}</small>${pricingMarkup(calcPricing)}<p>${escapeHTML(state.calculator.result.reason || (calcKnownMargin ? 'Price is above cost.' : 'Margin unknown.'))}</p></div>` : `<span>${icon('warning', 18)}</span><div><small>Not publishable · Margin unknown</small><b>${escapeHTML(state.calculator.result.reason || 'The server rejected this price.')}</b></div>`}</div>` : ''}</article></section>${state.drawer === 'rule' ? ruleDrawer() : ''}`);
  }
  function ruleDrawer() {
    const form = state.pricingForm;
    return `<div class="ej-admin-drawer-backdrop" data-admin-action="close-drawer"><aside class="ej-admin-drawer" data-admin-drawer role="dialog" aria-modal="true"><div class="ej-admin-drawer-head"><div><span class="ej-admin-eyebrow">${form.id ? 'EDIT RULE' : 'NEW RULE'}</span><h2>${form.id ? 'Edit pricing rule' : 'Create pricing rule'}</h2></div><button class="ej-admin-icon-button" type="button" data-admin-action="close-drawer">${icon('close', 20)}</button></div><form class="ej-admin-form" data-admin-form="rule"><label>Scope<select name="scope">${optionList(SCOPES, form.scope)}</select></label>${scopeKeyField(form)}<label>Mode<select name="mode">${optionList(MODES, form.mode)}</select></label><label>Value (${modeUnit(form.mode)})<input name="value" required inputmode="decimal" value="${escapeHTML(form.value)}" placeholder="${form.mode === 'PERCENT' ? 'Percent' : 'Naira'}"></label><p class="ej-admin-field-help">Values are sent as decimal strings: Naira for Fixed/Manual and percent for Percent. The server validates finite, nonnegative, bounded amounts and increments rule versions.</p><div class="ej-admin-drawer-actions"><button class="button button-outline" type="button" data-admin-action="close-drawer">Cancel</button><button class="button" type="submit" ${busy || state.upload.validating || state.upload.committing ? 'disabled' : ''}>Save rule ${icon('check', 15)}</button></div></form></aside></div>`;
  }
  function inventoryPage() {
    const visible = state.inventory.query ? state.units.filter((unit) => `${unit.productName} ${unit.platform} ${unit.id} ${unit.sourceRef || ''}`.toLowerCase().includes(state.inventory.query.toLowerCase())) : state.units;
    return shell(`${header('STOCK CONTROL', 'Inventory', 'All inventory states are visible. Only AVAILABLE and QUARANTINED units can be changed; RESERVED and SOLD units are read-only.', `<button class="button button-small" type="button" data-admin-action="refresh-page">${icon('refresh', 15)} Refresh</button>`)}${state.pageError ? alertBox(state.pageError, 'error', true) : ''}<section class="ej-admin-panel"><div class="ej-admin-filter-bar"><label class="ej-admin-search">${icon('search', 16)}<input data-admin-field="inventory-query" type="search" value="${escapeHTML(state.inventory.query)}" placeholder="Search safe IDs or source refs"></label><label>Product<select data-admin-field="inventory-product"><option value="">All products</option>${state.products.map((p) => `<option value="${escapeHTML(p.id)}" ${p.id === state.inventory.productId ? 'selected' : ''}>${escapeHTML(p.name)}</option>`).join('')}</select></label><label>Status<select data-admin-field="inventory-status"><option value="">All statuses</option>${optionList(INVENTORY_STATUSES, state.inventory.status)}</select></label></div>${state.unitsError ? alertBox(state.unitsError, 'error', true) : ''}${state.loading ? loadingBox() : visible.length ? `<div class="ej-admin-table-wrap"><table class="ej-admin-table"><thead><tr><th>Unit</th><th>Product</th><th>Platform</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>${visible.map((unit) => `<tr><td><code>${escapeHTML(unit.id)}</code></td><td>${escapeHTML(unit.productName)}</td><td>${platformBadge(unit.platform)}</td><td><span class="ej-admin-status ${statusClass(unit.status)}">${escapeHTML(unit.status)}</span></td><td>${dateLabel(unit.createdAt)}</td><td>${unit.status === 'AVAILABLE' || unit.status === 'QUARANTINED' ? `<button type="button" class="button button-small button-outline" data-admin-action="toggle-unit" data-id="${escapeHTML(unit.id)}" data-status="${escapeHTML(unit.status)}">${unit.status === 'AVAILABLE' ? 'Quarantine' : 'Restock'}</button>` : '—'}</td></tr>`).join('')}</tbody></table></div>` : emptyState('No matching inventory', 'Only safe metadata is returned; encrypted credential payloads are never shown.', 'warehouse')}</section>`);
  }
  function uploadsPage() {
    const products = state.products.filter((p) => p.source === 'OWN' && p.status !== 'ARCHIVED');
    const result = state.uploadResult;
    return shell(`${header('SECURE STOCK INTAKE', 'Uploads', 'Validate credential records on the server, review masked diagnostics, then confirm an all-or-nothing commit.', '')}${state.pageError ? alertBox(state.pageError, 'error', true) : ''}<section class="ej-admin-upload-grid"><article class="ej-admin-panel"><div class="ej-admin-panel-head"><div><span class="ej-admin-eyebrow">NEW IMPORT</span><h2>Prepare a JSONL batch</h2></div><span class="ej-admin-lock-pill">${icon('lock', 13)} Encrypted staging</span></div><div class="ej-admin-alert warning">${icon('warning', 17)}<span>Use only inventory you are authorized to manage. Raw fields are cleared from this page after validation.</span></div><form class="ej-admin-form" data-admin-form="upload"><label>OWN product<select name="productId" required><option value="">Choose a product</option>${products.map((p) => `<option value="${escapeHTML(p.id)}" ${p.id === state.upload.productId ? 'selected' : ''}>${escapeHTML(p.name)} · ${escapeHTML(p.platform)}</option>`).join('')}</select></label><div class="ej-admin-upload-tabs"><button type="button" class="${state.upload.source === 'single' ? 'active' : ''}" data-admin-action="upload-mode" data-mode="single">Single unit</button><button type="button" class="${state.upload.source === 'text' ? 'active' : ''}" data-admin-action="upload-mode" data-mode="text">Paste JSONL</button><button type="button" class="${state.upload.source === 'file' ? 'active' : ''}" data-admin-action="upload-mode" data-mode="file">Choose file</button></div>${state.upload.source === 'single' ? singleUnitForm() : state.upload.source === 'file' ? `<label>JSONL file<input type="file" accept=".jsonl,.txt,application/json" data-admin-file="jsonl"></label><p class="ej-admin-field-help">Files are read only after authentication and only held in memory for this validation request.</p>` : `<label>JSONL content<textarea name="content" rows="11" spellcheck="false" placeholder='{"payload":{"username":"user@example.invalid","password":"synthetic-password"},"sourceRef":"synthetic.invalid"}'>${escapeHTML(state.upload.content)}</textarea></label>`}<label class="check-label ej-admin-upload-authorization"><input type="checkbox" name="authorizationConfirmed" data-admin-field="upload-authorization" ${state.upload.authorizationConfirmed ? 'checked' : ''}><span>I confirm I am authorized to import these records. This confirmation is required before validation.</span></label><div class="ej-admin-upload-actions"><button type="button" class="button button-outline" data-admin-action="download-template">${icon('file', 15)} Download template</button><button type="button" class="button button-outline" data-admin-action="paste-template">Paste synthetic template</button><button type="submit" class="button" ${state.upload.validating || busy ? 'disabled' : ''}>Validate securely ${icon('check', 15)}</button></div></form>${state.upload.error ? alertBox(state.upload.error, 'error') : ''}</article><article class="ej-admin-panel"><div class="ej-admin-panel-head"><div><span class="ej-admin-eyebrow">IMPORT HISTORY</span><h2>Recent batches</h2></div></div>${state.importsError ? alertBox(state.importsError, 'error', true) : state.loading && !state.imports.length ? loadingBox() : state.imports.length ? `<div class="ej-admin-history-list">${state.imports.map((item) => `<div class="ej-admin-history-row"><div><b>${escapeHTML(item.productName || item.productId)}</b><small>${escapeHTML(item.status)} · ${escapeHTML(String(item.added ?? 0))} added · ${dateLabel(item.createdAt)}</small></div><span class="ej-admin-status ${statusClass(item.status)}">${escapeHTML(item.status)}</span></div>`).join('')}</div>` : emptyState('No imports yet', 'Validated and committed batches will appear here.', 'upload')}</article></section>${result ? importResult(result) : ''}`);
  }
  function singleUnitForm() {
    const form = state.upload.single;
    return `<div class="ej-admin-single-grid"><label>Username <span class="ej-admin-optional">or email</span><input name="username" value="${escapeHTML(form.username)}" autocomplete="off"></label><label>Email<input name="email" type="email" value="${escapeHTML(form.email)}" autocomplete="off"></label><label>Password<input name="password" type="password" required autocomplete="new-password" value="${escapeHTML(form.password)}"></label><label>Recovery email<input name="recoveryEmail" type="email" value="${escapeHTML(form.recoveryEmail)}" autocomplete="off"></label><label>Recovery password<input name="recoveryPassword" type="password" value="${escapeHTML(form.recoveryPassword)}" autocomplete="new-password"></label><label>2FA secret<input name="twoFactorSecret" value="${escapeHTML(form.twoFactorSecret)}" autocomplete="off"></label><label>Source reference<input name="sourceRef" value="${escapeHTML(form.sourceRef)}" placeholder="Optional safe reference"></label><label class="ej-admin-full-field">Notes<textarea name="notes" rows="2">${escapeHTML(form.notes)}</textarea></label></div>`;
  }
  function importResult(result) {
    const diagnostics = Array.isArray(result.diagnostics) ? result.diagnostics : [];
    const canCommit = result.status === 'VALIDATED' && result.canCommit && result.commitToken;
    return `<section class="ej-admin-panel ej-admin-validation-panel"><div class="ej-admin-panel-head"><div><span class="ej-admin-eyebrow">MASKED VALIDATION RESULT</span><h2>${escapeHTML(result.status || 'Result')}</h2></div><span class="ej-admin-status ${statusClass(result.status)}">${escapeHTML(result.status || '—')}</span></div><div class="ej-admin-validation-stats"><b>${escapeHTML(String(result.totalRows ?? 0))}<small>Total rows</small></b><b>${escapeHTML(String(result.validRows ?? 0))}<small>Valid rows</small></b><b>${escapeHTML(String(result.invalidRows ?? 0))}<small>Invalid rows</small></b><b>${escapeHTML(String(result.duplicateRows ?? 0))}<small>Duplicates</small></b></div>${diagnostics.length ? `<div class="ej-admin-diagnostics">${diagnostics.slice(0, 50).map((item) => `<div><span class="ej-admin-status ${statusClass(item.status)}">${escapeHTML(item.status)}</span><b>Line ${escapeHTML(item.line)}</b><small>${escapeHTML(item.code || 'Review returned diagnostic')}</small></div>`).join('')}</div>` : '<p class="ej-admin-muted">No row-level issues were returned. Credentials remain masked and are not displayed.</p>'}${canCommit ? `<div class="ej-admin-confirm-row"><label class="check-label"><input type="checkbox" data-admin-field="commit-authorization-confirmed"><span>I confirm I am authorized to import these records and want to commit ${escapeHTML(String(result.validRows))} encrypted unit(s).</span></label><button class="button" type="button" data-admin-action="commit-import" data-id="${escapeHTML(result.id)}">Confirm &amp; commit</button></div>` : ''}</section>`;
  }
  function ordersPage() {
    const allRows = state.checkoutOrders;
    const filterKey = state.orderFilter || 'All';
    const groups = { All: () => true, Active: (o) => ['PENDING', 'PROCESSING'].includes(String(o.status).toUpperCase()), Completed: (o) => ['COMPLETED', 'FULFILLED', 'DELIVERED'].includes(String(o.status).toUpperCase()), 'Needs review': (o) => ['RECONCILIATION', 'FAILED'].includes(String(o.status).toUpperCase()), Refunded: (o) => String(o.status).toUpperCase() === 'REFUNDED' };
    const rows = allRows.filter(groups[filterKey] || groups.All);
    const orderFilters = `<div class="ej-admin-filter-row" role="group" aria-label="Filter orders">${Object.keys(groups).map((name) => `<button type="button" class="ej-admin-filter ${filterKey === name ? 'active' : ''}" aria-pressed="${filterKey === name}" data-admin-action="order-filter" data-filter="${name}">${name}<span>${allRows.filter(groups[name]).length}</span></button>`).join('')}</div>`;
    return shell(`${header('CHECKOUT', 'Checkout and refunds', 'Live commerce records with private details hidden. Refunds credit the customer wallet for the full original purchase amount; they are not bank refunds.', `<button class="button button-small button-outline" type="button" data-admin-action="refresh-page">${icon('refresh', 14)} Refresh</button>`)}${state.pageError ? alertBox(state.pageError, 'error', true) : ''}${allRows.length ? orderFilters : ''}<section class="ej-admin-panel ej-admin-table-panel">${state.loading ? loadingBox() : rows.length ? `<div class="ej-admin-table-wrap"><table class="ej-admin-table"><thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Amount</th><th>Updated</th><th></th></tr></thead><tbody>${rows.map((order) => `<tr><td><code>${escapeHTML(order.id || order.orderReference || '—')}</code></td><td>${escapeHTML(order.customerEmail || order.userEmail || 'Redacted')}</td><td><span class="ej-admin-status ${statusClass(order.status)}">${escapeHTML(order.status || '—')}</span></td><td>${minorMoneyLabel(order.totalMinor ?? order.amountMinor ?? order.total ?? '')}</td><td>${dateLabel(order.updatedAt || order.createdAt)}</td><td><button class="button button-small button-outline" type="button" data-admin-action="refund-order" data-id="${escapeHTML(order.id || '')}" ${['REFUNDED', 'CANCELLED'].includes(String(order.status).toUpperCase()) ? 'disabled' : ''}>Full wallet refund</button></td></tr>`).join('')}</tbody></table></div>` : emptyState('No commerce orders returned', 'No orders were returned. No demo balances or order counts are shown.', 'orders')}</section>`);
  }

  // Reads the real shape returned by GET /providers/status:
  //   { don: { enabled, configured, mode, modeValid, deliveryContractConfirmed, purchasesEnabled },
  //     providers: [{ provider, providerLabel, enabled, configured, quotesEnabled, purchasesEnabled, currency }] }
  function supplierPage() {
    const status = state.supplierStatus || {};
    const providers = Array.isArray(status.providers) ? status.providers : [];
    const don = status.don && typeof status.don === 'object' ? status.don : null;
    const action = `<button class="button button-small" type="button" data-admin-action="supplier-sync">${icon('refresh', 14)} Sync catalog</button>`;

    const check = (ok, text) => `<li style="list-style:none;display:flex;align-items:center;gap:6px;margin:3px 0;color:${ok ? '#1a7f37' : '#b42318'}">${icon(ok ? 'check' : 'close', 14)}<span>${escapeHTML(text)}</span></li>`;
    const card = (title, badge, tone, checks, hints, note) => `<article class="ej-admin-provider-card"><b>${escapeHTML(title)}</b><span class="ej-admin-status ${statusClass(tone)}">${escapeHTML(badge)}</span><ul style="margin:10px 0 0;padding:0">${checks.join('')}</ul>${hints.length ? `<small style="display:block;margin-top:8px">${hints.map((hint) => escapeHTML(hint)).join('<br>')}</small>` : ''}${note ? `<small style="display:block;margin-top:6px">${escapeHTML(note)}</small>` : ''}</article>`;

    const providerCards = providers.map((provider) => {
      const number = provider.provider ?? '';
      const label = provider.providerLabel || provider.label || provider.name || `Provider ${number}`;
      const enabled = Boolean(provider.enabled);
      const configured = Boolean(provider.configured);
      const quotes = Boolean(provider.quotesEnabled);
      const purchases = Boolean(provider.purchasesEnabled);
      const badge = purchases ? 'Ready to sell' : quotes ? 'Quotes only' : enabled ? 'Not configured' : 'Disabled';
      const tone = purchases ? 'completed' : quotes ? 'pending' : 'failed';
      const hints = [];
      if (!enabled) hints.push(`Set PROVIDER${number}_ENABLED to true.`);
      if (!configured) hints.push('Set the API key, currency, NGN rate, and retail markup mode and value.');
      if (enabled && configured && !purchases) hints.push(`Set PROVIDER${number}_PURCHASES_ENABLED to true to allow orders.`);
      return card(
        label,
        badge,
        tone,
        [
          check(enabled, 'Enabled'),
          check(configured, 'Key, currency, rate and markup set'),
          check(quotes, 'Quotes available to customers'),
          check(purchases, 'Purchases enabled'),
        ],
        hints,
        provider.currency ? `Provider currency: ${provider.currency}` : '',
      );
    });

    const donCard = don
      ? [card(
        'Donmarketplace Logs',
        don.purchasesEnabled ? 'Purchases on' : don.enabled ? 'Catalogue only' : 'Disabled',
        don.purchasesEnabled ? 'completed' : don.enabled ? 'pending' : 'failed',
        [
          check(Boolean(don.enabled), 'Enabled'),
          check(Boolean(don.configured), 'API key configured'),
          check(Boolean(don.modeValid), `Mode: ${don.mode || 'unknown'}`),
          check(Boolean(don.deliveryContractConfirmed), 'Delivery contract confirmed'),
          check(Boolean(don.purchasesEnabled), 'Purchases enabled'),
        ],
        [],
        'Live mode is catalogue-only. Supplier checkout runs in sandbox mode only.',
      )]
      : [];

    const cards = [...providerCards, ...donCard];
    const providerContent = state.loading && !state.supplierStatus
      ? loadingBox()
      : cards.length
        ? `<div class="ej-admin-provider-grid">${cards.join('')}</div>`
        : emptyState('Provider status unavailable', 'Provider keys or native currency/rate configuration may be missing. The frontend does not fabricate availability, prices, or supplier product counts.', 'warning');

    const body = `<section class="ej-admin-panel"><div class="ej-admin-panel-head"><div><span class="ej-admin-eyebrow">LIVE PROVIDER STATUS</span><h2>${cards.length ? 'Provider readiness' : 'No provider status returned'}</h2></div><span class="ej-admin-lock-pill">${icon('lock', 13)} No invented counts</span></div>${providerContent}<p class="ej-admin-muted">A provider shows customer quotes only when it is Enabled and fully configured. Orders also need Purchases enabled. Sync imports supplier catalogue details only. Choose a Don Log in Products to set its selling price and activate it individually. Supplier checkout remains separately controlled by the server.</p></section>`;
    return shell(header('SUPPLIER OPERATIONS', 'Provider status', 'Inspect each provider connection and sync Don Logs. Set each product selling price and activate it directly from Products.', action) + (state.pageError ? alertBox(state.pageError, 'error', true) : '') + body);
  }
  function auditPage() {
    return shell(`${header('ACCOUNTABILITY', 'Audit logs', 'Redacted operational events from the admin service. Credential values and ciphertext are never returned.', `<button class="button button-small button-outline" type="button" data-admin-action="refresh-page">${icon('refresh', 15)} Refresh</button>`)}${state.pageError ? alertBox(state.pageError, 'error', true) : ''}<section class="ej-admin-panel ej-admin-table-panel">${state.loading ? loadingBox() : state.audits.length ? `<div class="ej-admin-table-wrap"><table class="ej-admin-table"><thead><tr><th>Time</th><th>Action</th><th>Actor</th><th>Target</th><th>Safe detail</th></tr></thead><tbody>${state.audits.map((event) => `<tr><td>${dateLabel(event.createdAt)}</td><td><span class="ej-admin-status">${escapeHTML(event.action)}</span></td><td>${escapeHTML(event.actorEmail || '—')}</td><td><code>${escapeHTML(event.targetId || '—')}</code></td><td>${escapeHTML(typeof event.detail === 'string' ? event.detail : JSON.stringify(event.detail || {}))}</td></tr>`).join('')}</tbody></table></div>` : emptyState('No audit events returned', 'The server has not returned any redacted events for this account.', 'audit')}</section>`);
  }
  function page() {
    const gate = authGate(); if (gate) return gate;
    if (currentRoute === '/admin/products') return productsPage();
    if (currentRoute === '/admin/pricing' || currentRoute === '/admin/inventory') return productsPage();
    if (currentRoute === '/admin/uploads') return uploadsPage();
    if (currentRoute === '/admin/orders') return ordersPage();
    if (currentRoute === '/admin/checkout') return ordersPage();
    if (currentRoute === '/admin/supplier') return supplierPage();
    if (currentRoute === '/admin/audit-logs') return auditPage();
    return overviewPage();
  }
  function render() {
    if (!root.isConnected || root.__adminToolsMount !== mountMarker) return;
    root.innerHTML = page();
    bind();
  }
  function syncForm(form, target) {
    if (!form || !target) return;
    [...form.elements].forEach((element) => { if (element.name && target[element.name] !== undefined) target[element.name] = element.type === 'checkbox' ? element.checked : element.value; });
  }
  function syncUploadForm(form) {
    syncForm(form, state.upload);
    if (state.upload.source === 'single') syncForm(form, state.upload.single);
  }
  async function goWithConfirm(message, action, options = {}) {
    const destructive = /^(Archive|Delete)\b/.exec(message);
    const defaults = destructive ? { title: destructive[1] === 'Archive' ? 'Archive product' : 'Delete pricing rule', confirmLabel: destructive[1], tone: 'danger' } : { title: 'Please confirm' };
    if (await confirmDialog(message, { ...defaults, ...options })) return action();
    return undefined;
  }
  async function login(form) {
    if (busy) return;
    const data = new FormData(form); const email = String(data.get('email') || '').trim(); const password = String(data.get('password') || '');
    form.reset(); busy = true; state.pageError = ''; render();
    try {
      const result = await request('/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      const sessionResult = await request('/session');
      session = sessionResult.user || result.user || null; csrfToken = sessionResult.csrfToken || result.csrfToken || null; setupReady = sessionResult.setupReady !== false;
      if (!session) throw Object.assign(new Error('no-session'), { status: 401 });
      logoutRetry = false; state.pageError = ''; state.error = ''; toast('Signed in to the admin workspace.', 'success'); go('/admin');
    } catch (error) { state.pageError = controlledError(error, 'Sign-in failed. Verify your credentials and try again.'); render(); }
    finally { busy = false; if (typeof options.navigate !== 'function' || !session) render(); }
  }
  async function saveSocialLog(form) {
    if (busy) return;
    const data = new FormData(form);
    const group = state.socialGroup;
    const get = (key) => String(data.get(key) || '').trim();
    const all = (key) => data.getAll(key).map(String);
    const details = {
      username: group === 'FORMAT' ? get('formatName') : get('username'), age: ['WORKING_TOOLS','FORMAT'].includes(group) ? 0 : Number(get('age')), price: get('price'), country: get('country'),
      formatName: get('formatName'), formatType: get('formatType'), formatCredentials: get('formatCredentials'), formatWriteup: get('formatWriteup'),
      image: get('image'), description: group === 'FORMAT' ? '' : get('description'),
      emailAttached: data.has('emailAttached'), phoneAttached: data.has('phoneAttached'), twoFactor: data.has('twoFactor'), ogEmail: data.has('ogEmail'), verified: data.has('verified'),
      loginUsername: get('loginUsername'), loginEmail: get('loginEmail'), emailPassword: get('emailPassword'), accountPassword: get('accountPassword'),
      twoFactorSecret: get('twoFactorSecret'), recoveryEmail: get('recoveryEmail'), recoveryPassword: get('recoveryPassword'), backupCodes: get('backupCodes') ? get('backupCodes').split(',').map(v => v.trim()).filter(Boolean) : [], cookies: get('cookies') || undefined, notes: get('notes'), toolLink: get('toolLink'),
    };
    if (!details.username || !details.price || Number(details.price) <= 0) { state.pageError = 'Username / label and a valid selling price are required.'; render(); return; }
    const listings = [];
    const push = (platform, category, extra = {}, label = '') => listings.push({ platform, category, ...extra, label: label || details.username });
    if (group === 'FACEBOOK') all('pageTypes').forEach(v => push('FACEBOOK','FACEBOOK_PAGE',{pageType:v,followers:v==='PAGE_WITH_FOLLOWERS'?(Number(get('followers'))||1000):undefined},v.replaceAll('_',' ')));
    else if (group === 'TIKTOK') { if (data.has('includeFollowerTier')) push('TIKTOK','TIKTOK_FOLLOWERS',{followers:Number(get('followers'))||200},'TikTok Followers'); all('countries').forEach(c=>push('TIKTOK','TIKTOK_COUNTRY',{country:c},`${c} Aged TikTok`)); }
    else if (group === 'ICLOUD') push('ICLOUD','ICLOUD',{country:'USA'},'USA iCloud');
    else if (group === 'INSTAGRAM') all('subTypes').forEach(st=>push('INSTAGRAM','INSTAGRAM_FOLLOWERS',{instagramSubType:st,followers:st==='AGED_500'?500:0},st.replaceAll('_',' ')));
    else if (group === 'VPN') all('subTypes').forEach(st=>push('VPN','VPN',{vpnType:st},st.replaceAll('_',' ')));
    else if (group === 'TUTORIAL') all('subTypes').forEach(st=>push(({FACEBOOK_ADS:'FACEBOOK',INSTAGRAM_ADS:'INSTAGRAM',TIKTOK_ADS:'TIKTOK',TWITTER_ADS:'X'})[st],'TUTORIAL',{tutorialType:st},st.replaceAll('_',' ')));
    else if (group === 'WEBSITE') all('subTypes').forEach(st=>push('VPN','WEBSITE_CREATION',{websiteType:st},st.replaceAll('_',' ')));
    else if (group === 'WORKING_TOOLS') all('subTypes').forEach(st=>push('TOOL','ALL_WORKING_TOOLS',{workingToolType:st},st.replaceAll('_',' ')));
    else if (group === 'TEXTING') all('platforms').forEach(pl=>push(pl,'TEXTPLUS_NEXTPLUS',{},pl));
    else if (group === 'MAIL') all('platforms').forEach(pl=>push(pl,'MAIL',{},pl));
    else if (group === 'TWITTER') push('X','TWITTER_FOLLOWERS',{followers:Number(get('followers'))},'X Followers');
    else if (group === 'TELEGRAM') push('TELEGRAM','TELEGRAM_ACCOUNT',{},'Telegram Account');
    else if (group === 'OTHER') { const pl=get('platform'); const cat=get('category'); if(pl && cat) push(pl,cat,{country:get('country') || undefined},pl); }
    else if (group === 'FORMAT') { const platform=get('formatPlatform'); const formatName=get('formatName'); const formatType=get('formatType'); if(platform && formatName && ['WRITEUP','CREDENTIALS'].includes(formatType)) push(platform,'FORMAT',{formatName,formatType},formatName); }
    if (!listings.length) { state.pageError = 'Select at least one listing option before continuing.'; render(); return; }
    if (!['WORKING_TOOLS','FORMAT'].includes(group) && (!Number.isFinite(details.age) || details.age <= 0)) { state.pageError = 'Enter the account age in months.'; render(); return; }
    if (group === 'FORMAT' && details.formatType === 'WRITEUP' && !details.formatWriteup) { state.pageError = 'Enter the write-up content.'; render(); return; }
    if (group === 'FORMAT' && details.formatType === 'CREDENTIALS' && !details.formatCredentials) { state.pageError = 'Enter the private credential details.'; render(); return; }
    if (group === 'WORKING_TOOLS' && !/^https?:\/\//i.test(details.toolLink)) { state.pageError = 'Working tools require a valid tool link.'; render(); return; }
    if (details.image && !/^https?:\/\//i.test(details.image)) { state.pageError = 'Image URL must start with http:// or https://.'; render(); return; }
    if (details.cookies) { try { JSON.parse(details.cookies); } catch { state.pageError = 'Cookies must be valid JSON.'; render(); return; } }
    busy = true; state.pageError = ''; render();
    try {
      const result = await request('/social-logs', { method:'POST', body:JSON.stringify({listings,details}) });
      state.drawer = null; state.socialStep = 1; state.socialGroup = ''; await loadProducts(revision);
      toast(`${result.count || listings.length} SocialLog listing(s) created successfully.`, 'success');
    } catch (error) { state.pageError = controlledError(error, 'SocialLog could not be created. Review the required fields and try again.'); }
    finally { busy = false; render(); }
  }

  async function saveProduct(form) {
    if (busy) return;
    syncForm(form, state.productForm);
    const values = { ...state.productForm };
    const minQty = Number(values.minQty); const maxQty = Number(values.maxQty);
    if (!Number.isInteger(minQty) || !Number.isInteger(maxQty) || minQty < 1 || maxQty < 1 || minQty > 100000 || maxQty > 100000 || minQty > maxQty) {
      state.pageError = 'Minimum and maximum quantity must be whole numbers from 1 to 100,000, with minimum no greater than maximum.'; render(); return;
    }
    values.minQty = minQty; values.maxQty = maxQty;
    if (!values.acquisitionCost) values.acquisitionCost = null;
    values.source = 'OWN';
    busy = true; render();
    try {
      const path = state.editingProduct ? `/products/${encodeURIComponent(state.editingProduct.id)}` : '/products';
      await request(path, { method: state.editingProduct ? 'PATCH' : 'POST', body: JSON.stringify(values) });
      const wasEditing = Boolean(state.editingProduct); state.drawer = null; state.editingProduct = null; state.productForm = emptyProduct(); toast(wasEditing ? 'Product updated.' : 'Product created.', 'success'); await loadProducts(revision); state.pageError = '';
    } catch (error) { state.pageError = controlledError(error, 'Product was not saved. Your form values are still here.'); }
    finally { busy = false; render(); }
  }
  async function saveRule(form) {
    if (busy) return;
    syncForm(form, state.pricingForm); const values = { scope: state.pricingForm.scope, scopeKey: state.pricingForm.scope === 'DEFAULT' ? 'logs' : state.pricingForm.scopeKey, mode: state.pricingForm.mode, value: state.pricingForm.value };
    busy = true; render();
    try { await request('/pricing-rules', { method: 'POST', body: JSON.stringify(values) }); state.drawer = null; state.pricingForm = emptyRule(); await loadPricing(); toast('Pricing rule saved with a new server version.', 'success'); }
    catch (error) { state.pageError = controlledError(error, 'Pricing rule was not saved. Your values are still here.'); }
    finally { busy = false; render(); }
  }
  async function loadPricing() { const result = await request('/pricing-rules'); state.rules = Array.isArray(result.rules) ? result.rules : []; state.pageError = ''; render(); }
  async function calculate(form) {
    if (busy) return;
    syncForm(form, state.calculator); state.calculator.error = ''; state.calculator.result = null; busy = true; render();
    try {
      const payload = { cost: state.calculator.cost.trim() || null, platform: state.calculator.platform || undefined, productId: state.calculator.productId || undefined };
      if (state.calculator.mode !== 'SAVED') payload.rule = { mode: state.calculator.mode, value: state.calculator.value };
      state.calculator.result = await request('/pricing/preview', { method: 'POST', body: JSON.stringify(payload) });
    } catch (error) { state.calculator.error = controlledError(error, 'The server could not calculate this price. Check the decimal string and rule.'); }
    finally { busy = false; render(); }
  }
  function buildSingleContent() {
    const item = state.upload.single; const payload = {};
    ['username', 'email', 'password', 'recoveryEmail', 'recoveryPassword', 'twoFactorSecret', 'notes'].forEach((key) => { if (item[key]) payload[key] = item[key]; });
    return JSON.stringify({ payload, ...(item.sourceRef ? { sourceRef: item.sourceRef } : {}) });
  }
  function clearUploadSensitiveFields() {
    state.upload.content = '';
    state.upload.single = { username: '', email: '', password: '', recoveryEmail: '', recoveryPassword: '', twoFactorSecret: '', notes: '', sourceRef: '' };
    state.upload.authorizationConfirmed = false;
    const file = root.querySelector('[data-admin-file="jsonl"]'); if (file) file.value = '';
  }
  async function validateUpload(form) {
    if (busy || state.upload.validating || state.upload.committing) return;
    syncUploadForm(form);
    if (!state.upload.authorizationConfirmed) { state.upload.error = 'Confirm authorization before validation.'; render(); return; }
    if (!state.upload.productId) { state.upload.error = 'Choose an OWN, non-archived product first.'; render(); return; }
    const content = state.upload.source === 'single' ? buildSingleContent() : state.upload.content;
    if (!content.trim()) { state.upload.error = 'Add a single unit or JSONL content before validating.'; render(); return; }
    const authorizationConfirmed = state.upload.authorizationConfirmed === true;
    const requestData = { productId: state.upload.productId, format: 'jsonl', content, authorizationConfirmed };
    clearUploadSensitiveFields();
    state.upload.validating = true; state.upload.error = ''; render();
    try {
      const result = await request('/imports/validate', { method: 'POST', body: JSON.stringify(requestData) });
      state.uploadResult = result;
      toast('Validation complete. Raw input was cleared from this page.', result.status === 'VALIDATED' ? 'success' : 'error');
    } catch (error) { state.upload.error = controlledError(error, 'Validation failed. Raw input was cleared from this page.'); }
    finally { state.upload.validating = false; render(); }
  }
  async function commitImport(button) {
    if (busy || state.upload.validating || state.upload.committing) return;
    const result = state.uploadResult; const confirmation = root.querySelector('[data-admin-field="commit-authorization-confirmed"]');
    if (!result?.commitToken || !confirmation?.checked) { toast('Confirm authorization before committing this batch.', 'error'); return; }
    busy = true; state.upload.committing = true; button.disabled = true; render();
    try { await request(`/imports/${encodeURIComponent(result.id)}/commit`, { method: 'POST', body: JSON.stringify({ commitToken: result.commitToken }) }); state.uploadResult = null; await loadImports(); toast('Import committed. Encrypted units were added atomically.', 'success'); }
    catch (error) { state.upload.error = controlledError(error, 'The import was not committed. The token remains in memory for a retry if still valid.'); }
    finally { state.upload.committing = false; busy = false; render(); }
  }
  async function loadImports() { const result = await request('/imports'); state.imports = Array.isArray(result.imports) ? result.imports : []; state.upload.committing = false; render(); }
  async function toggleUnit(button) {
    if (busy || state.upload.validating || state.upload.committing) return;
    const id = button.dataset.id; const oldStatus = button.dataset.status; const next = oldStatus === 'AVAILABLE' ? 'QUARANTINED' : 'AVAILABLE';
    await goWithConfirm(`Set this unit to ${next.toLowerCase()}?`, async () => {
      if (busy) return;
      busy = true; button.disabled = true; render();
      try { await request(`/inventory/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status: next }) }); await loadUnits(revision); toast(`Unit marked ${next.toLowerCase()}.`, 'success'); }
      catch (error) { toast(controlledError(error, 'Inventory status was not changed.'), 'error'); }
      finally { busy = false; render(); }
    });
  }
  async function logout() {
    if (busy) return;
    busy = true; revision += 1; clearPrivateAdminState(); render();
    try {
      await request('/logout', { method: 'POST', body: JSON.stringify({}) });
      logoutRetry = false; state.pageError = ''; toast('Signed out of the admin workspace.', 'success');
    } catch (error) {
      logoutRetry = true;
      state.pageError = controlledError(error, 'Remote sign-out could not be confirmed. All locally cached admin records and drafts were cleared; retry sign out.');
    } finally {
      session = null;
      csrfToken = null;
      busy = false;
      go('/admin/login');
    }
  }
  function bind() {
    root.querySelectorAll('[data-admin-link]').forEach((link) => link.addEventListener('click', (event) => { const path = link.dataset.adminLink; if (!path || path.startsWith('#')) return; event.preventDefault(); if (path === '/') { window.location.href = '/'; return; } go(path); }));
    root.querySelectorAll('[data-admin-action]').forEach((control) => control.addEventListener('click', async (event) => {
      const action = control.dataset.adminAction;
      if (action === 'order-filter') { state.orderFilter = control.dataset.filter || 'All'; render(); return; }
      if (action === 'menu') { root.querySelector('[data-admin-sidebar]')?.classList.toggle('open'); return; }
      if (action === 'retry-session') { state.error = ''; await loadSession(revision); render(); return; }
      if (action === 'retry-logout') { await logout(); return; }
      if (action === 'retry-page' || action === 'refresh-page') { state.pageError = ''; revision += 1; await loadRouteData(revision, currentRoute); return; }
      if (action === 'product-tab') { state.productTab = control.dataset.tab === 'OWN' ? 'OWN' : 'DONMARKETPLACE'; state.selectedDonProduct = null; render(); return; }
      if (action === 'open-don-product') { const product = state.products.find((item) => String(item.id) === String(control.dataset.id) && item.source === 'DONMARKETPLACE'); if (product) { state.selectedDonProduct = product; render(); } return; }
      if (action === 'close-don-product') { if (control.classList.contains('ej-admin-drawer-backdrop') && event.target !== control) return; state.selectedDonProduct = null; render(); return; }
      if (action === 'deactivate-don-product') {
        if (busy) return;
        if (!(await confirmDialog('Customers will no longer see this Don Log, but its selling price will be saved.', { title: 'Deactivate Don Log', confirmLabel: 'Deactivate', tone: 'danger' }))) return;
        busy = true; render();
        try { await request(`/products/${encodeURIComponent(control.dataset.id)}/don-activation`, { method: 'PATCH', body: JSON.stringify({ active: false }) }); await loadProducts(revision); state.selectedDonProduct = null; toast('Don Log deactivated.', 'success'); }
        catch (error) { state.pageError = controlledError(error, 'Don Log could not be deactivated.'); }
        finally { busy = false; render(); }
        return;
      }
      if (action === 'new-product') { state.drawer = 'social'; state.editingProduct = null; state.socialStep = 1; state.socialGroup = ''; render(); return; }
      if (action === 'social-group') { state.socialGroup = control.dataset.group || ''; render(); return; }
      if (action === 'social-next') { if (state.socialGroup) { state.socialStep = 2; render(); } return; }
      if (action === 'social-back') { state.socialStep = 1; render(); return; }
      if (action === 'edit-product') { const product = state.products.find((item) => String(item.id) === String(control.dataset.id)); if (product) { state.drawer = 'product'; state.editingProduct = product; state.productForm = emptyProduct(product); render(); } return; }
      if (action === 'close-drawer') { if (event.target.closest('[data-admin-drawer]') && event.target !== control) return; state.drawer = null; render(); return; }
      if (action === 'archive-product') { await goWithConfirm('Archive this product? It will no longer be available for new active catalog use.', async () => { if (busy) return; busy = true; render(); try { await request(`/products/${encodeURIComponent(control.dataset.id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'ARCHIVED' }) }); state.drawer = null; state.editingProduct = null; await loadProducts(revision); toast('Product archived.', 'success'); } catch (error) { state.pageError = controlledError(error, 'Product was not archived.'); } finally { busy = false; render(); } }); return; }
      if (action === 'new-rule') { state.drawer = 'rule'; state.pricingForm = emptyRule(); render(); return; }
      if (action === 'edit-rule') { const rule = state.rules.find((item) => String(item.id) === String(control.dataset.id)); if (rule) { state.drawer = 'rule'; state.pricingForm = emptyRule(rule); render(); } return; }
      if (action === 'delete-rule') { await goWithConfirm('Delete this pricing rule? The server will record the deletion.', async () => { if (busy) return; busy = true; render(); try { await request(`/pricing-rules/${encodeURIComponent(control.dataset.id)}`, { method: 'DELETE' }); await loadPricing(); toast('Pricing rule deleted.', 'success'); } catch (error) { state.pageError = controlledError(error, 'Pricing rule was not deleted.'); } finally { busy = false; render(); } }); return; }
      if (action === 'toggle-unit') { await toggleUnit(control); return; }
      if (action === 'upload-mode') { state.upload.source = control.dataset.mode; state.upload.error = ''; render(); return; }
      if (action === 'download-template') { const content = '{"payload":{"username":"fakeuser@instagram.invalid","password":"synthetic-password.invalid"},"sourceRef":"synthetic.invalid"}\n'; const blob = new Blob([content], { type: 'application/jsonl' }); const anchor = document.createElement('a'); anchor.href = URL.createObjectURL(blob); anchor.download = 'emmyjosh-jsonl-template.jsonl'; anchor.click(); setTimeout(() => URL.revokeObjectURL(anchor.href), 0); return; }
      if (action === 'paste-template') { state.upload.source = 'text'; state.upload.content = '{"payload":{"username":"fakeuser@instagram.invalid","password":"synthetic-password.invalid"},"sourceRef":"synthetic.invalid"}'; state.upload.error = ''; render(); return; }
      if (action === 'commit-import') { await commitImport(control); return; }
      if (action === 'refund-order') {
        const reason = await promptDialog('The customer wallet is credited the full original purchase amount. This is not a bank refund.', { title: 'Full wallet refund', label: 'Reason (required)', defaultValue: 'Customer-requested refund', confirmLabel: 'Issue refund', tone: 'danger' });
        if (!reason) return;
        await (async () => {
          if (busy) return;
          busy = true; render();
          try { await request(`/commerce/orders/${encodeURIComponent(control.dataset.id)}/refund`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) }); toast('Full wallet refund completed.', 'success'); await loadRouteData(revision, currentRoute); }
          catch (error) { state.pageError = controlledError(error, 'The wallet refund could not be confirmed.'); }
          finally { busy = false; render(); }
        })();
        return;
      }
      if (action === 'supplier-sync') {
        if (!(await confirmDialog('New or changed Don Logs stay inactive until you set their selling price.', { title: 'Sync Donmarketplace catalogue', confirmLabel: 'Sync now' }))) return;
        if (busy) return;
        busy = true; state.pageError = ''; render();
        try { await request('/providers/logs/sync', { method: 'POST', body: JSON.stringify({}) }); toast('Supplier catalog sync started. Mappings remain server-controlled DRAFT records.', 'success'); await loadRouteData(revision, currentRoute); }
        catch (error) { state.pageError = controlledError(error, 'Supplier sync could not be confirmed.'); }
        finally { busy = false; render(); }
        return;
      }
      if (action === 'logout') { await logout(); return; }
    }));
    root.querySelectorAll('[data-admin-form="login"]').forEach((form) => form.addEventListener('submit', (event) => { event.preventDefault(); void login(form); }));
    root.querySelectorAll('[data-admin-form="don-price"]').forEach((form) => form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy || !state.selectedDonProduct) return;
      const data = new FormData(form); const sellingPrice = String(data.get('sellingPrice') || '').trim();
      if (!/^\d+(?:\.\d{1,2})?$/.test(sellingPrice) || Number(sellingPrice) <= 0) { state.pageError = 'Enter a valid selling price in Naira.'; render(); return; }
      busy = true; state.pageError = ''; render();
      try {
        await request(`/products/${encodeURIComponent(state.selectedDonProduct.id)}/don-price`, { method: 'PATCH', body: JSON.stringify({ sellingPrice }) });
        await loadProducts(revision); state.selectedDonProduct = null; toast('Selling price saved and Don Log activated.', 'success');
      } catch (error) { state.pageError = controlledError(error, 'Selling price was not saved. Check that it is not below the supplier price.'); }
      finally { busy = false; render(); }
    }));
    root.querySelectorAll('[data-admin-form="social"]').forEach((form) => {
      form.addEventListener('change', (event) => {
        if (event.target.name !== 'formatType') return;
        const selected = event.target.value;
        form.querySelectorAll('[data-format-panel]').forEach((panel) => {
          const active = panel.dataset.formatPanel === selected;
          panel.hidden = !active;
          const field = panel.querySelector('textarea');
          if (field) field.required = active;
        });
        form.querySelectorAll('.ej-format-type-card').forEach((card) => {
          const active = card.querySelector('input')?.value === selected;
          card.classList.toggle('selected', active);
        });
      });
      form.addEventListener('submit', (event) => { event.preventDefault(); void saveSocialLog(form); });
    });
    root.querySelectorAll('[data-admin-form="product"]').forEach((form) => { form.addEventListener('input', () => syncForm(form, state.productForm)); form.addEventListener('change', () => syncForm(form, state.productForm)); form.addEventListener('submit', (event) => { event.preventDefault(); void saveProduct(form); }); });
    root.querySelectorAll('[data-admin-form="rule"]').forEach((form) => { form.addEventListener('input', () => syncForm(form, state.pricingForm)); form.addEventListener('change', (event) => { syncForm(form, state.pricingForm); if (event.target.name === 'scope') { const scope = state.pricingForm.scope; const options = scope === 'PLATFORM' ? PLATFORMS : state.products.map((product) => product.id); if (scope === 'DEFAULT') state.pricingForm.scopeKey = 'logs'; else if (!options.includes(state.pricingForm.scopeKey)) state.pricingForm.scopeKey = options[0] || ''; render(); } else if (event.target.name === 'mode') render(); }); form.addEventListener('submit', (event) => { event.preventDefault(); void saveRule(form); }); });
    root.querySelectorAll('[data-admin-form="calculator"]').forEach((form) => { form.addEventListener('input', () => syncForm(form, state.calculator)); form.addEventListener('change', (event) => { syncForm(form, state.calculator); if (event.target.name === 'mode') render(); }); form.addEventListener('submit', (event) => { event.preventDefault(); void calculate(form); }); });
    root.querySelectorAll('[data-admin-form="upload"]').forEach((form) => { form.addEventListener('input', () => { syncUploadForm(form); }); form.addEventListener('change', () => { syncUploadForm(form); }); form.addEventListener('submit', (event) => { event.preventDefault(); void validateUpload(form); }); });
    root.querySelectorAll('[data-admin-file="jsonl"]').forEach((input) => input.addEventListener('change', async () => { const file = input.files?.[0]; if (!file) return; if (file.size > 2 * 1024 * 1024) { state.upload.error = 'The JSONL file is larger than 2 MiB.'; input.value = ''; render(); return; } try { state.upload.content = await file.text(); input.value = ''; state.upload.source = 'file'; state.upload.error = ''; render(); } catch { input.value = ''; state.upload.content = ''; state.upload.error = 'The selected file could not be read.'; render(); } }));
    root.querySelectorAll('[data-admin-field="inventory-product"], [data-admin-field="inventory-status"]').forEach((input) => input.addEventListener('change', async () => { if (input.dataset.adminField === 'inventory-product') state.inventory.productId = input.value; else state.inventory.status = input.value; state.pageError = ''; await loadUnits(revision); render(); }));
    root.querySelectorAll('[data-admin-field="inventory-query"]').forEach((input) => input.addEventListener('input', () => { state.inventory.query = input.value; const rows = root.querySelectorAll('.ej-admin-table tbody tr'); rows.forEach((row) => row.hidden = !row.textContent.toLowerCase().includes(input.value.toLowerCase())); }));
  }

  await loadSession(revision);
  render();
  if (session && currentRoute !== '/admin/login') void loadRouteData(revision, currentRoute);
}

export default mountAdminTools;