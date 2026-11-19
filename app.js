import { api, ApiError, getApiBase, setApiBase } from './api.js';
import { mountAdminTools } from './admin-tools.js';
import { beginLoading } from './loading.js';
import { renderNumbersPage, renderNumberOrderPage } from './numbers.js';
import { renderSupplierLogs } from './don-logs.js';
import {
  formatNaira, sampleAdmin, sampleNotifications, sampleOrders,
  sampleProducts, sampleTransactions, sampleUser,
} from './data.js';

const LOGO = '/manus-storage/emmyjosh-logo-original-crop_1be053b9.png';
const HERO = '/manus-storage/async-images/DUkoSpJ2nXlRVxpQJjP4OK/image-1.webp';
const app = document.querySelector('#app');
const endInitialLoading = beginLoading('Preparing your marketplace…');
const state = {
  user: null,
  authMessage: '',
  orderFilter: 'All orders',
  apiConnected: false,
  apiMessage: '',
  productError: '',
  productCache: getApiBase() ? [] : [...sampleProducts],
  ownProducts: [],
  ownProductError: '',
  ownProductsLoaded: false,
  productQueryKey: '',
  productsLoading: false,
  purchasePending: false,
  loaded: {},
  dashboard: null,
  wallet: null,
  orders: null,
  transactions: null,
  notifications: null,
  supportTickets: null,
  profile: null,
  currentProduct: null,
  account: null,
  orderDetail: null,
  delivery: null,
  numberFilters: { provider: '1', country: '', service: '', operator: '' },
  numberCatalog: null,
  numberOrder: null,
  numberLoading: false,
  numberOrderLoading: false,
  numberError: '',
  supplierQuotes: [],
  supplierStatus: null,
  supplierLoaded: false,
  supplierLoading: false,
  supplierError: '',
  signedOut: false,
  menuOpen: false,
};
let sessionCheckTimer = null;
let sessionCheckPending = false;
const SESSION_EXPIRED_MESSAGE = 'Your session has ended. Please sign in again.';

const paths = {
  dashboard: '/dashboard', marketplace: '/marketplace', wallet: '/wallet',
  orders: '/orders', numbers: '/numbers', transactions: '/transactions', profile: '/profile',
  notifications: '/notifications', support: '/support',
};

const svgPaths = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  bag: '<path d="M5 8h14l1 13H4L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  wallet: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H20v16H6.5A2.5 2.5 0 0 1 4 17.5z"/><path d="M4 7h14a2 2 0 0 1 2 2v3h-5a2 2 0 0 0 0 4h5"/><path d="M15 14h.01"/>',
  arrows: '<path d="M7 7h13l-3-3M17 17H4l3 3"/><path d="M20 7v5M4 12v5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.6.9l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.6-.9l-1.7.6-1.4-2.4L5.5 15a8 8 0 0 1 0-1.9l-1.4-1.2 1.4-2.4 1.7.6a8 8 0 0 1 1.6-.9l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.6.9l1.7-.6 1.4 2.4-1.4 1.2a8 8 0 0 1-.1 1.9Z" transform="translate(1 -1) scale(.92)"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9a2.5 2.5 0 1 1 4.6 1.3c-.8 1-2.2 1.3-2.2 3M12 17h.01"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/>',
  cart: '<path d="M3 4h2l2.2 11.5a2 2 0 0 0 2 1.6h8.5a2 2 0 0 0 1.9-1.4L22 9H6"/><circle cx="10" cy="21" r="1"/><circle cx="18" cy="21" r="1"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  shield: '<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/>',
  zap: '<path d="m13 2-3 8h7l-6 12 1-9H5l8-11Z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
  chart: '<path d="M4 19V5M4 19h17"/><path d="m7 15 4-4 3 2 6-7"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  bank: '<path d="m3 9 9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 21h18M2 18h20"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  logout: '<path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/>',
  megaphone: '<path d="m3 11 18-5v12L3 14z"/><path d="M11 16l2 6H8l-2-7M21 11a2 2 0 0 1 0 4"/>',
  filter: '<path d="M4 6h16M7 12h10m-7 6h4"/>',
};

function icon(name, size = 20, extraClass = '') {
  return `<svg class="icon ${extraClass}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${svgPaths[name] || svgPaths.grid}</svg>`;
}

function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function logo(className = '') {
  return `<img class="brand-logo ${className}" src="${LOGO}" alt="Emmyjosh Logs" width="142" height="80">`;
}

function productSymbol(product, size = 38) {
  const slug = String(product.platform || '').toLowerCase();
  return ['instagram', 'tiktok', 'facebook', 'x', 'telegram', 'youtube'].includes(slug)
    ? `<img class="social-product-symbol" src="/assets/social/${slug}.svg" width="${size}" height="${size}" alt="${escapeHTML(product.platform)}">`
    : icon(product.icon || (product.category === 'Virtual Numbers' ? 'phone' : 'file'), size);
}

function productArtwork(product, size = 38) {
  // Keep the established brand SVGs for social products; do not replace them
  // with user-supplied cover images in the public catalogue card.
  return productSymbol(product, size);
}
function catalogProducts() {
  return [...state.ownProducts, ...state.productCache.filter((product) => !state.ownProducts.some((own) => String(own.id) === String(product.id)))];
}

function previewNotice() {
  if (state.authMessage) {
    return `<div class="preview-notice">${icon('help', 17)} <span>${escapeHTML(state.authMessage)}</span><a data-link href="/login">Sign in</a></div>`;
  }
  if (state.apiConnected) {
    return `<div class="preview-notice connected">${icon('shield', 17)} <span>You are connected. Prices and order outcomes are confirmed by service providers.</span></div>`;
  }
  if (getApiBase()) {
    return `<div class="preview-notice">${icon('help', 17)} <span><strong>We cannot connect right now.</strong> Account information is temporarily unavailable. Please try again later.</span><a data-link href="/profile#api-settings">Connection settings</a></div>`;
  }
  return `<div class="preview-notice">${icon('eye', 17)} <span><strong>Customer preview.</strong> Sample balances and activity are examples. Saved own-stock products may be real listings; checkout requires a verified customer session and server confirmation.</span><a data-link href="/profile#api-settings">API status</a></div>`;
}

function formatAmount(value) {
  const num = Number(value || 0);
  return formatNaira(Number.isFinite(num) ? num : 0);
}

function supportTicketHistoryPanel() {
  let content;
  if (!getApiBase()) {
    content = `<div class="empty-state"><span>${icon('eye', 23)}</span><b>Preview only</b><p>Ticket history appears here after connecting an API and signing in.</p></div>`;
  } else if (!state.user) {
    content = `<div class="empty-state"><span>${icon('user', 23)}</span><b>Sign in to view ticket history</b><p>Customer support records are only loaded for a verified session.</p><a data-link class="button button-small" href="/login">Sign in</a></div>`;
  } else if (state.supportTickets === null) {
    content = `<div class="empty-state"><span>${icon('clock', 23)}</span><b>Loading requests…</b><p>Retrieving your support history from the API.</p></div>`;
  } else if (!state.supportTickets.length) {
    content = `<div class="empty-state"><span>${icon('help', 23)}</span><b>No support requests yet</b><p>Your API-confirmed support requests will appear here.</p></div>`;
  } else {
    content = `<div class="notification-list">${state.supportTickets.map((ticket) => `<article class="notification-item"><span class="notification-icon brown">${icon('help', 19)}</span><div class="notification-copy"><b>${escapeHTML(ticket.subject || ticket.title || 'Support request')}</b><p>Status: ${escapeHTML(ticket.status || '—')}</p><small>${escapeHTML(apiDate(ticket.createdAt || ticket.updatedAt))}</small></div></article>`).join('')}</div>`;
  }
  return `<section class="panel support-history-panel"><div class="panel-head"><div><span class="eyebrow">YOUR ACCOUNT</span><h2>Support request history</h2></div></div>${content}</section>`;
}

async function refreshSession() {
  try {
    const result = await api.me();
    const user = result.user || result.data?.user || null;
    if (!user?.id) throw new ApiError('We could not confirm your sign-in. Please sign in again.', 401, 'SESSION_NOT_ESTABLISHED');
    state.user = user;
    state.authMessage = '';
    startSessionMonitor();
    return user;
  } catch (error) {
    if ([401, 403].includes(error.status)) {
      state.user = null;
      if (state.authMessage !== SESSION_EXPIRED_MESSAGE) state.authMessage = '';
    } else {
      state.authMessage = 'We could not confirm your account right now. Please try again.';
    }
    throw error;
  }
}

function stopSessionMonitor() {
  if (sessionCheckTimer) window.clearInterval(sessionCheckTimer);
  sessionCheckTimer = null;
  sessionCheckPending = false;
}

function startSessionMonitor() {
  stopSessionMonitor();
  if (!state.user || !getApiBase()) return;
  sessionCheckTimer = window.setInterval(async () => {
    if (!state.user || document.visibilityState === 'hidden' || sessionCheckPending) return;
    sessionCheckPending = true;
    try { await api.me(); }
    catch { /* 401 triggers the centralized expiry handler; transient failures stay quiet */ }
    finally { sessionCheckPending = false; }
  }, 60_000);
}

function publicHeader() {
  return `<header class="public-header"><a class="brand-wrap" data-link href="/" aria-label="Emmyjosh Logs home">${logo()}</a>
    <button class="icon-button mobile-only" data-action="menu" aria-label="Open navigation">${icon('menu', 22)}</button>
    <nav class="public-nav ${state.menuOpen ? 'open' : ''}" aria-label="Main navigation">
      <a data-link href="/">Home</a><a data-link href="/marketplace">Services</a><a data-link href="/support#about">About</a><a data-link href="/support">Support</a>
      <div class="nav-actions">${state.user ? `<a class="nav-login" data-link href="/dashboard">Account</a><button class="button button-small" data-action="logout">Sign out</button>` : `<a class="nav-login" data-link href="/login">Login</a><a class="button button-small" data-link href="/register">Register</a>`}</div>
    </nav>
  </header>`;
}

function landingPage() {
  const featured = catalogProducts().slice(0, 3);
  return `<div class="site-public">${publicHeader()}
    <main>
      <section class="landing-hero page-wrap">
        <div class="hero-copy">
          <span class="eyebrow"><span class="eyebrow-dot"></span> YOUR DIGITAL SERVICES, MADE SIMPLE</span>
          <h1>Emmyjosh Logs<br><span>Marketplace</span></h1>
          <p>Buy, sell and manage your digital services with a clear, convenient experience.</p>
          <p class="hero-subcopy">Explore lawful log services and virtual numbers with straightforward delivery and support.</p>
          <div class="hero-actions"><a class="button" data-link href="/marketplace">Get started ${icon('arrow', 18)}</a><a class="text-link" data-link href="/marketplace">Explore marketplace</a></div>
          <div class="trust-row"><span>${icon('shield', 18)} Secure &amp; reliable</span><span>${icon('zap', 18)} Clear service terms</span></div>
        </div>
        <div class="hero-visual"><div class="hero-circle"></div><img src="${HERO}" alt="A customer using a smartphone" class="hero-person" loading="eager"><div class="hero-caption">Your trusted logs &amp; virtual number hub <span>↗</span></div></div>
      </section>
      <section class="category-section page-wrap">
        <div class="section-heading"><div><span class="eyebrow">EXPLORE WHAT YOU NEED</span><h2>Two clear categories.<br><span>One easy place.</span></h2></div><a class="text-link" data-link href="/marketplace">View marketplace ${icon('arrow', 17)}</a></div>
        <div class="category-grid">
          <a class="category-card category-logs" data-link href="/marketplace?category=logs"><span class="category-icon">${icon('file', 26)}</span><span class="category-meta"><b>Logs</b><small>Lawful log products and operational tools</small></span>${icon('arrow', 20)}</a>
          <a class="category-card category-numbers" data-link href="/marketplace?category=virtual-numbers"><span class="category-icon">${icon('phone', 26)}</span><span class="category-meta"><b>Virtual Numbers</b><small>Clear options for supported workflows</small></span>${icon('arrow', 20)}</a>
        </div>
      </section>
      <section class="featured-section page-wrap">
        <div class="section-heading"><div><span class="eyebrow">HAND-PICKED FOR YOU</span><h2>Popular right now</h2></div><a class="text-link" data-link href="/marketplace">Browse all ${icon('arrow', 17)}</a></div>
        <div class="product-grid">${featured.map(productCard).join('')}</div>
      </section>
      <section class="trust-band"><div class="page-wrap trust-band-inner"><div>${icon('shield', 24)}<span><b>Built around clarity</b><small>Know what you’re buying before you continue.</small></span></div><div>${icon('wallet', 24)}<span><b>Verified funding states</b><small>Wallet updates follow confirmed provider events.</small></span></div><div>${icon('help', 24)}<span><b>Support when you need it</b><small>Reach the team with a question or request.</small></span></div></div></section>
      <section class="cta-section page-wrap"><div><span class="eyebrow">READY WHEN YOU ARE</span><h2>Find your next<br><span>digital service.</span></h2><p>Browse the marketplace and review clear service details.</p></div><a class="button" data-link href="/marketplace">Explore marketplace ${icon('arrow', 18)}</a></section>
    </main>
    <footer class="public-footer page-wrap"><a data-link href="/">${logo('footer-logo')}</a><p>Emmyjosh Logs Marketplace · Lawful services, clearly presented.</p><div><a data-link href="/admin/login">Admin</a><a data-link href="/support">Support</a><a data-link href="/support#terms">Terms</a><a data-link href="/support#privacy">Privacy</a></div></footer>
  </div>`;
}

function decimalPriceMinor(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  return (BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2))).toString();
}

function socialListingMeta(product, compact = false) {
  const meta = product?.socialMetadata || product?.social_metadata || null;
  if (!meta || typeof meta !== 'object') return '';

  const category = String(product.logCategory || meta.category || '').toUpperCase();
  const chips = [];
  const add = (label, value) => {
    if (value === undefined || value === null || value === '') return;
    chips.push([label, String(value)]);
  };
  const humanize = (value) => String(value || '')
    .toLowerCase().split('_').filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  const age = Number(meta.ageMonths);
  const addAge = () => {
    if (Number.isFinite(age) && age > 0) add('Age', `${age} month${age === 1 ? '' : 's'}`);
  };
  const followerValue = Number(meta.followers);
  const addFollowers = () => {
    if (meta.followers !== null && meta.followers !== undefined && Number.isFinite(followerValue) && followerValue >= 0) {
      add('Followers', followerValue === 0 ? 'Empty aged' : followerValue.toLocaleString() + '+');
    }
  };

  switch (category) {
    case 'TIKTOK_COUNTRY':
      add('Country', meta.country === 'RANDOM' ? 'Random country' : meta.country);
      addAge();
      break;
    case 'TIKTOK_FOLLOWERS':
    case 'TWITTER_FOLLOWERS':
      addFollowers();
      addAge();
      break;
    case 'INSTAGRAM_FOLLOWERS': {
      const subtype = String(meta.instagramSubType || '').toUpperCase();
      if (subtype === 'AGED_500' || (Number.isFinite(followerValue) && followerValue > 0)) {
        addFollowers();
      } else if (subtype) {
        add('Account type', humanize(subtype));
      }
      addAge();
      break;
    }
    case 'FACEBOOK_PAGE': {
      const pageType = String(meta.pageType || '').toUpperCase();
      if (pageType === 'PAGE_WITH_FOLLOWERS') add('Audience', '1K+ followers');
      else if (pageType) add('Page type', humanize(pageType));
      addAge();
      break;
    }
    case 'ICLOUD':
      add('Country', meta.country || 'USA');
      addAge();
      break;
    case 'VPN':
      add('VPN type', humanize(meta.vpnType));
      break;
    case 'TUTORIAL':
      add('Tutorial', humanize(meta.tutorialType));
      break;
    case 'WEBSITE_CREATION':
      add('Service', humanize(meta.websiteType));
      break;
    case 'ALL_WORKING_TOOLS':
      add('Tool box', humanize(meta.workingToolType));
      break;
    default:
      if (meta.formatType) add('Format', humanize(meta.formatType));
      if (meta.formatName) add('Type', meta.formatName);
      break;
  }

  const flags = [
    ['verified', 'Verified'], ['ogEmail', 'OG email'],
    ['twoFactor', '2FA enabled'], ['emailAttached', 'Email attached'],
    ['phoneAttached', 'Phone attached'],
  ].filter(([key]) => meta[key] === true).map(([, label]) => label);

  if (!chips.length && !flags.length) return '';
  const chipMarkup = chips.map(([label, value]) => `<span class="social-meta-chip"><b>${escapeHTML(label)}</b><span>${escapeHTML(value)}</span></span>`).join('');
  const flagMarkup = flags.map((label) => `<span class="social-flag-chip">${escapeHTML(label)}</span>`).join('');
  const toolUrl = category === 'ALL_WORKING_TOOLS' && /^https?:\/\//i.test(String(meta.toolLink || ''))
    ? `<a class="social-tool-link" href="${escapeHTML(meta.toolLink)}" target="_blank" rel="noopener noreferrer">Open tool ${icon('arrow', 12)}</a>` : '';
  return `<div class="social-listing-meta ${compact ? 'compact' : 'expanded'}" aria-label="Listing attributes">${chipMarkup}${flagMarkup}${toolUrl}</div>`;
}

function productCard(product) {
  const category = product.category || product.categoryName || (product.categorySlug === 'virtual-numbers' ? 'Virtual Numbers' : 'Logs');
  const logType = String(product.logCategory || product.socialMetadata?.category || '').toLowerCase()
    .split('_').filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  const price = formatAmount(product.price);
  const stockCount = typeof product._count?.inventory === 'number' ? product._count.inventory : null;
  const available = typeof product.available === 'boolean' ? product.available : stockCount === null ? null : stockCount > 0;
  const soldOut = product.customLog ? (stockCount === 0 || product.checkoutEnabled === false) : available === false;
  const stockLabel = product.customLog
    ? (product.checkoutEnabled === false ? (stockCount > 0 ? 'Unavailable' : 'Sold out') : stockCount === null ? '' : stockCount > 0 ? `${stockCount.toLocaleString()} in stock` : 'Sold out')
    : available === true ? 'Available' : available === false ? 'Unavailable' : '';
  const stockClass = soldOut ? 'unavailable' : 'available';
  const hasRating = product.rating !== undefined && product.rating !== null && product.rating !== '—' && product.rating !== '';
  const rating = hasRating ? `${icon('zap', 14)} <b>${escapeHTML(product.rating)}</b> <span>(${Number(product.reviews || 0).toLocaleString()} reviews)</span>` : '';
  const href = `/product/${encodeURIComponent(product.id || product.slug)}`;
  const brand = product.platform ? String(product.platform).replace(/_/g, ' ') : '';
  return `<article class="product-card">
    <a class="product-art ${product.icon === 'phone' ? 'phone-art' : ''}" data-link href="${href}" aria-label="View ${escapeHTML(product.name)}">
      <span class="product-art-icon ${product.platform ? 'social-brand-art' : ''}">${productArtwork(product, 38)}</span>
      <span class="product-art-badges">${product.customLog || product.tag ? `<span class="product-tag">${product.customLog ? 'Own stock' : escapeHTML(product.tag)}</span>` : ''}${stockLabel ? `<span class="product-stock-pill ${stockClass}"><i></i>${escapeHTML(stockLabel)}</span>` : ''}</span>
    </a>
    <div class="product-card-body">
      <div class="product-card-kicker"><span class="product-category">${escapeHTML(logType || category)}</span>${brand ? `<span class="product-platform">${escapeHTML(brand)}</span>` : ''}</div>
      <a data-link href="${href}" class="product-title">${escapeHTML(product.name)}</a>
      <p>${escapeHTML(product.description || 'View the full details and service terms.')}</p>
      ${socialListingMeta(product, true)}
      ${rating ? `<div class="product-rating">${rating}</div>` : ''}
      <div class="product-card-bottom"><div class="product-price"><strong>${price}</strong><small>per unit</small></div><a class="button button-small" data-link href="${href}">View details ${icon('arrow', 13)}</a></div>
    </div>
  </article>`;
}

function pageHeading(kicker, title, description = '') {
  return `<div class="page-heading"><div><span class="eyebrow">${escapeHTML(kicker)}</span><h1>${title}</h1>${description ? `<p>${description}</p>` : ''}</div></div>`;
}

function sidebar(active) {
  const items = [
    ['dashboard', 'Dashboard', paths.dashboard, 'home'],
    ['marketplace', 'Marketplace', paths.marketplace, 'grid'],
    ['orders', 'My Orders', paths.orders, 'bag'], ['numbers', 'Virtual Numbers', paths.numbers, 'phone'],
    ['wallet', 'Wallet', paths.wallet, 'wallet'],
    ['transactions', 'Transactions', paths.transactions, 'arrows'],
    ['profile', 'Profile', paths.profile, 'user'],
    ['notifications', 'Notifications', paths.notifications, 'bell'],
    ['support', 'Support', paths.support, 'help'],
  ];
  return `<aside class="app-sidebar ${state.menuOpen ? 'open' : ''}"><a data-link class="sidebar-brand" href="/dashboard">${logo('sidebar-logo')}</a><span class="sidebar-label">YOUR ACCOUNT</span><nav>${items.map(([id, label, href, glyph]) => `<a data-link class="sidebar-link ${active === id ? 'active' : ''}" href="${href}">${icon(glyph, 19)}<span>${label}</span>${id === 'notifications' && !getApiBase() ? '<span class="nav-count">2</span>' : ''}</a>`).join('')}</nav><div class="sidebar-bottom"><div class="sidebar-help">${icon('help', 19)}<span><b>Need a hand?</b><small>We’re here to help.</small><a data-link href="/support">Contact support ${icon('arrow', 13)}</a></span></div><button class="sidebar-link logout-link" data-action="logout">${icon('logout', 18)}<span>Sign out</span></button></div></aside>`;
}

function userTopbar() {
  const displayName = state.user?.fullName || 'Guest';
  const accountLabel = state.user ? 'Customer account' : 'Not signed in';
  return `<header class="app-topbar"><button class="icon-button mobile-only" data-action="menu" aria-label="Open account menu">${icon('menu', 21)}</button><div class="topbar-search">${icon('search', 18)}<input type="search" placeholder="Search products…" aria-label="Search products" data-search-shortcut></div><div class="topbar-actions"><a data-link class="icon-button notification-action" href="/notifications" aria-label="Notifications">${icon('bell', 20)}<i></i></a><a data-link class="account-chip" href="/profile"><span class="avatar">${escapeHTML(displayName.slice(0, 1))}</span><span class="account-chip-copy"><b>${escapeHTML(displayName)}</b><small>${accountLabel}</small></span><span class="chip-chevron">⌄</span></a>${state.user ? '<button class="button button-small topbar-logout" data-action="logout">Sign out</button>' : ''}</div></header>`;
}

function accountShell(active, content) {
  return `<div class="app-shell">${sidebar(active)}<div class="app-main">${userTopbar()}<main class="app-content">${previewNotice()}${content}</main></div></div><div class="toast-slot" aria-live="polite"></div>`;
}

function metricCard(glyph, label, value, helper, tone = '') {
  return `<article class="metric-card"><span class="metric-icon ${tone}">${icon(glyph, 21)}</span><span class="metric-label">${label}</span><strong>${value}</strong><small>${helper}</small></article>`;
}

function dashboardPage() {
  const name = state.user?.fullName || (!state.signedOut && !getApiBase() ? sampleUser.fullName : '');
  const greeting = name ? `Good to see you, ${escapeHTML(name.split(' ')[0])}. Here’s a quick look at your account.` : 'Sign in through the connected API to view your account summary.';
  return accountShell('dashboard', `${pageHeading('CUSTOMER AREA', 'Dashboard', greeting)}
    <section class="metrics-grid">
      ${metricCard('bag', 'Total orders', state.dashboard?.totalOrders ?? (getApiBase() ? '—' : '2'), state.dashboard ? 'From your account' : (getApiBase() ? 'Sign in to load account data' : 'Example activity'), 'orange')}
      ${metricCard('wallet', 'Wallet balance', state.dashboard ? formatAmount(state.dashboard.walletBalance) : (getApiBase() ? '—' : formatNaira(12500)), state.dashboard ? 'From your wallet' : (getApiBase() ? 'Awaiting authenticated API data' : 'Example amount only'), 'brown')}
      ${metricCard('phone', 'Active numbers', state.dashboard?.activeNumbers ?? (getApiBase() ? '—' : '1'), state.dashboard ? 'From your number-provider orders' : 'Sign in to load account data', 'green')}
      ${metricCard('bell', 'Unread notices', state.dashboard?.unreadNotifications ?? (getApiBase() ? '—' : '2'), state.dashboard ? 'From notifications' : (getApiBase() ? 'Sign in to load account data' : 'Example activity'), 'yellow')}
    </section>
    <section class="dashboard-feature"><div class="feature-copy"><span class="eyebrow light-eyebrow">EXPLORE OUR SERVICES</span><h2>Find a service<br>that fits your needs.</h2><p>Browse clear product details, availability, and terms before you decide.</p><a data-link href="/marketplace" class="button button-light">Browse marketplace ${icon('arrow', 16)}</a></div><div class="feature-visual">${icon('wallet', 56)}<span class="feature-orbit orbit-one"></span><span class="feature-orbit orbit-two"></span></div></section>
    <section class="content-grid two-col"><article class="panel"><div class="panel-head"><div><span class="eyebrow">RECENT ACTIVITY</span><h2>Recent orders</h2></div><a class="text-link" data-link href="/orders">View all ${icon('arrow', 14)}</a></div>${orderRows(state.dashboard ? mapOrders(state.dashboard.recentOrders || []) : (getApiBase() ? [] : sampleOrders.slice(0, 2)))}</article><article class="panel quick-panel"><div class="panel-head"><div><span class="eyebrow">QUICK ACCESS</span><h2>Your account</h2></div></div><a class="quick-link" data-link href="/wallet"><span>${icon('wallet', 19)}</span><b>Wallet &amp; deposits</b>${icon('arrow', 16)}</a><a class="quick-link" data-link href="/transactions"><span>${icon('arrows', 19)}</span><b>Transaction history</b>${icon('arrow', 16)}</a><a class="quick-link" data-link href="/profile"><span>${icon('user', 19)}</span><b>Profile &amp; settings</b>${icon('arrow', 16)}</a></article></section>`);
}

function marketplacePage() {
  const url = new URL(window.location.href);
  const query = url.searchParams.get('q') || '';
  const category = url.searchParams.get('category') || 'all';
  const platform = url.searchParams.get('platform') || '';
  let list = catalogProducts();
  if (query) list = list.filter((p) => `${p.name} ${p.description} ${p.category}`.toLowerCase().includes(query.toLowerCase()));
  if (category !== 'all') list = list.filter((p) => (p.categorySlug || (p.category === 'Virtual Numbers' ? 'virtual-numbers' : 'logs')) === category);
  if (platform) list = list.filter((p) => p.platform === platform);
  const sort = url.searchParams.get('sort') || 'popular';
  if (sort === 'price_asc') list.sort((a, b) => Number(a.price) - Number(b.price));
  if (sort === 'price_desc') list.sort((a, b) => Number(b.price) - Number(a.price));
  const platformFilter = `<div class="platform-filter"><span class="filter-title">LOGS PLATFORMS</span>${['Instagram', 'TikTok', 'Facebook', 'X', 'Telegram', 'YouTube'].map((name) => `<a data-link class="category-filter-link ${platform === name ? 'active' : ''}" href="/marketplace?category=logs&platform=${encodeURIComponent(name)}"><img src="/assets/social/${name.toLowerCase()}.svg" alt="">${name}</a>`).join('')}${platform ? '<a data-link class="text-link" href="/marketplace?category=logs">Clear platform</a>' : ''}</div>`;
  const categories = [['all', 'All products'], ['logs', 'Logs'], ['virtual-numbers', 'Virtual Numbers']];
  const catalogError = state.productError ? `<div class="preview-notice" role="alert">${icon('help', 17)}<span><strong>We could not load services.</strong> ${escapeHTML(state.productError)} Please try again.</span><button class="link-button" data-action="retry-products">Retry</button></div>` : '';
  const catalogContent = state.productsLoading
    ? `<div class="empty-state"><span>${icon('clock', 24)}</span><b>Loading marketplace…</b><p>Requesting current catalog and availability.</p></div>`
    : state.productError ? '' : list.length ? list.map(productCard).join('')
      : `<div class="empty-state"><span>${icon('search', 26)}</span><b>No services found</b><p>Try another search or category.</p></div>`;
  return accountShell('marketplace', `${pageHeading('DISCOVER', 'Our Marketplace', 'The best services, with clear descriptions and availability details.')}
    <div class="market-toolbar"><form class="search-form" data-form="market-search">${icon('search', 18)}<input name="q" type="search" value="${escapeHTML(query)}" placeholder="Search products…"><button class="button button-small" type="submit">Search</button></form><label class="sort-control"><span>Sort by:</span><select data-change="sort"><option value="popular" ${sort === 'popular' ? 'selected' : ''}>Popular</option><option value="price_asc" ${sort === 'price_asc' ? 'selected' : ''}>Price: low to high</option><option value="price_desc" ${sort === 'price_desc' ? 'selected' : ''}>Price: high to low</option><option value="newest">Newest</option></select></label></div>
    <div class="market-layout"><aside class="category-filter"><span class="filter-title">CATEGORIES</span>${categories.map(([key, label]) => `<a data-link class="category-filter-link ${category === key ? 'active' : ''}" href="/marketplace${key === 'all' ? '' : `?category=${key}`}"><span class="category-mini-icon">${icon(key === 'virtual-numbers' ? 'phone' : key === 'logs' ? 'file' : 'grid', 16)}</span>${label}<span class="filter-arrow">›</span></a>`).join('')}${category !== 'virtual-numbers' ? platformFilter : ''}<div class="lawful-note">${icon('shield', 17)}<span>Listings are intended for lawful, authorized use.</span></div></aside>
      <section class="market-results">${state.ownProductError ? `<div class="own-catalog-note">${escapeHTML(state.ownProductError)} <button class="link-button" data-action="retry-own-catalog">Retry own-stock catalog</button></div>` : state.ownProducts.length ? `<div class="own-catalog-note">Own-stock listings below are saved catalog records. Checkout uses your signed-in wallet; price and stock are rechecked transactionally on the server.</div>` : ''}${catalogError}<div class="results-heading"><b>${state.productError ? 'Catalog unavailable' : state.productsLoading ? 'Loading services…' : `${list.length} services`}</b><span>Service availability is confirmed when you place an order.</span></div><div class="product-grid market-products">${catalogContent}</div>${category !== 'virtual-numbers' ? renderSupplierLogs({ signedIn: Boolean(state.user), loading: state.supplierLoading, error: state.supplierError, quotes: state.supplierQuotes, status: state.supplierStatus }) : ''}</section></div>`);
}

function productPage(id) {
  const decodedId = decodeURIComponent(id);
  const ownId = decodedId.startsWith('ejl_');
  const product = (state.currentProduct && String(state.currentProduct.id) === decodedId ? state.currentProduct : null)
    || catalogProducts().find((item) => String(item.id) === decodedId || item.slug === decodedId)
    || (getApiBase() || ownId ? { id: decodedId, name: state.ownProductError && ownId ? 'Product unavailable' : 'Loading product…', category: 'Logs', description: ownId && state.ownProductError ? state.ownProductError : 'Requesting product details from the marketplace API.', price: 0 } : state.productCache[0] || sampleProducts[0]);
  const category = product.category || product.categoryName || (product.categorySlug === 'virtual-numbers' ? 'Virtual Numbers' : 'Logs');
  const hasRating = product.rating !== undefined && product.rating !== null && product.rating !== '—' && product.rating !== '';
  const rating = hasRating ? `${icon('zap', 17)} <b>${escapeHTML(product.rating)}</b><span>${Number(product.reviews || 0).toLocaleString()} ${getApiBase() ? 'reviews' : 'example reviews'}</span>` : '';
  const stockCount = typeof product._count?.inventory === 'number' ? product._count.inventory : null;
  const availability = product.customLog ? `${stockCount ?? 0} available in stock` : product.available === false ? 'Currently unavailable' : '';
  const priceNote = product.customLog ? 'Own-stock listing · server-calculated unit price' : getApiBase() ? 'API-listed price · server rechecks at checkout' : 'Preview price';
  const examplePrice = getApiBase() || product.customLog ? '' : '<del>Example</del>';
  const purchaseDisabled = (ownId && product.checkoutEnabled !== true) || product.available === false || (product.customLog && stockCount === 0) || product.name === 'Loading product…' ? 'disabled aria-disabled="true"' : '';
  const detailArtwork = productSymbol(product, 74);
  const checkoutNote = product.customLog ? 'The server reserves encrypted stock and debits your wallet atomically. Completed delivery is visible only in your own order.' : 'A purchase is only recorded after the server confirms price, availability, and wallet status.';
  const serviceTerms = product.customLog ? (product.terms || 'Ask the administrator for product-specific terms before purchasing.') : 'Confirm eligibility, delivery timing, and applicable refund or cancellation rules with the service provider. Preview content is illustrative and does not confirm availability.';
  return accountShell('marketplace', `${pageHeading('MARKETPLACE / PRODUCT', 'Product details', 'Review the product information and terms before continuing.')}
    <div class="product-detail-grid"><article class="product-detail-art ${product.icon === 'phone' ? 'phone-art' : ''}"><span>${detailArtwork}</span><small>${escapeHTML(category)}</small></article><section class="product-detail-copy"><div class="breadcrumb"><a data-link href="/marketplace">Marketplace</a><span>/</span><span>${escapeHTML(category)}</span></div><span class="product-category">${escapeHTML(category)}</span><h2>${escapeHTML(product.name)}</h2>${rating ? `<div class="detail-rating">${rating}</div>` : ''}<div class="detail-price">${formatAmount(product.price)} ${examplePrice}<span>${priceNote}</span></div><p class="detail-description">${escapeHTML(product.description || 'Review service terms before continuing.')}</p>${socialListingMeta(product, false)}${availability ? `<p class="availability ${product.available === false ? 'unavailable' : 'available'}"><i></i>${escapeHTML(availability)}</p>` : ''}<div class="detail-quantity"><span>Quantity</span><button class="quantity-button" data-action="quantity-minus" aria-label="Decrease quantity" ${stockCount === 0 ? 'disabled' : ''}>−</button><input id="quantity" value="${product.minQty || 1}" type="number" min="${product.minQty || 1}" max="${product.maxQty ?? 10}" aria-label="Quantity" ${stockCount === 0 ? 'disabled' : ''}><button class="quantity-button" data-action="quantity-plus" aria-label="Increase quantity" ${stockCount === 0 ? 'disabled' : ''}>+</button></div><div class="detail-actions"><button class="button" data-action="purchase" data-product="${escapeHTML(product.id)}" ${purchaseDisabled}>${icon('bag', 18)} ${ownId && product.checkoutEnabled !== true ? 'Checkout unavailable' : 'Continue to purchase'}</button><a data-link class="button button-outline" href="/marketplace">Back to marketplace</a></div><p class="safe-note">${icon('shield', 16)} ${escapeHTML(checkoutNote)}</p></section></div>
    <section class="panel info-panel"><div><span class="eyebrow">SERVICE INFORMATION</span><h2>Before you continue</h2><p>${escapeHTML(serviceTerms)}</p></div><a data-link class="text-link" href="/support">Ask support ${icon('arrow', 15)}</a></section>`);
}

function authPage(kind) {
  const isLogin = kind === 'login';
  return `<div class="auth-page"><a data-link href="/" class="auth-back">${icon('arrow', 17)} Back to home</a><section class="auth-card"><aside class="auth-brand"><a data-link href="/">${logo('auth-logo')}</a><div><span class="eyebrow light-eyebrow">EMMYJOSH LOGS MARKETPLACE</span><h2>${isLogin ? 'Your trusted<br>digital services hub.' : 'Join the<br>marketplace.'}</h2><p>${isLogin ? 'A clear place to manage your services and account.' : 'Create an account and explore available services.'}</p></div><span class="auth-shield">${icon('shield', 42)}</span></aside><div class="auth-form-wrap"><div class="auth-form-heading"><a data-link href="/">${logo('form-logo')}</a><h1>${isLogin ? 'Welcome back' : 'Create your account'}</h1><p>${isLogin ? 'Sign in to continue to your account.' : 'It’s quick and easy.'}</p></div>${state.authMessage ? `<p class="auth-feedback" role="status">${escapeHTML(state.authMessage)}</p>` : ''}
    <form class="stack-form" data-form="${isLogin ? 'login' : 'register'}">${isLogin ? `<label>Email address or phone<input name="identifier" required autocomplete="username" placeholder="Email, phone, or username"></label><label>Password<input name="password" type="password" required minlength="8" autocomplete="current-password" placeholder="Password"></label><div class="form-between"><label class="check-label"><input name="rememberMe" type="checkbox"><span>Remember me</span></label><a data-link class="form-link" href="/support#password">Forgot password?</a></div>` : `<label>Username<input name="username" required minlength="3" maxlength="30" pattern="[a-zA-Z0-9_]{3,30}" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="3–30 letters, numbers, or underscores"></label><label>Full name<input name="fullName" required autocomplete="name" placeholder="Full name"></label><label>Email address<input name="email" type="email" required autocomplete="email" placeholder="Email address"></label><label>Phone number<input name="phoneNumber" type="tel" required autocomplete="tel" placeholder="Phone number"></label><label>Password<input name="password" type="password" required minlength="8" autocomplete="new-password" placeholder="Password"></label><label>Confirm password<input name="confirmPassword" type="password" required minlength="8" autocomplete="new-password" placeholder="Confirm password"></label>`}<button class="button auth-submit" type="submit">${isLogin ? 'Login' : 'Register account'} ${icon('arrow', 17)}</button><p class="auth-feedback" data-feedback></p></form>
    <div class="auth-divider"><span>or continue with</span></div><div class="social-buttons"><button type="button" class="social-button" data-action="social-login">${googleMark()} Google</button><button type="button" class="social-button" data-action="social-login">${facebookMark()} Facebook</button></div><p class="auth-switch">${isLogin ? 'Don’t have an account?' : 'Already have an account?'} <a data-link href="${isLogin ? '/register' : '/login'}">${isLogin ? 'Register' : 'Login'}</a></p><p class="auth-disclaimer">Preview interface · real authentication requires a configured API.</p></div></section></div><div class="toast-slot" aria-live="polite"></div>`;
}

function googleMark() { return '<span class="google-mark" aria-hidden="true">G</span>'; }
function facebookMark() { return '<span class="facebook-mark" aria-hidden="true">f</span>'; }

function walletPage() {
  const balance = state.wallet ? formatAmount(state.wallet.balance) : (getApiBase() ? '—' : formatNaira(12500));
  const balanceCaption = state.wallet ? 'Balance returned by your wallet API.' : (getApiBase() ? 'Sign in to load a verified wallet balance.' : 'Example balance · preview only');
  const transactions = state.transactions !== null ? mapTransactions(state.transactions).slice(0, 3) : (getApiBase() ? [] : sampleTransactions.slice(0, 3));
  return accountShell('wallet', `${pageHeading('YOUR MONEY', 'Wallet', 'View your balance and manage supported deposit options.')}
    <section class="wallet-layout"><div class="wallet-balance-card"><div><span>Wallet balance</span><strong>${balance}</strong><small>${balanceCaption}</small></div><span class="balance-mark">${icon('wallet', 31)}</span></div><article class="panel wallet-fund-card"><div class="panel-head"><div><span class="eyebrow">FUND YOUR WALLET</span><h2>Deposit funds</h2></div><span class="secure-pill">${icon('shield', 15)} Verified transfers</span></div><p>Request a dedicated virtual account after signing in. Transfers are credited only after the payment provider verifies the event.</p><div class="deposit-methods"><div class="deposit-option active">${icon('bank', 21)}<b>Bank transfer</b><small>Provider account</small></div></div>${state.account ? `<div class="account-details"><div class="account-created"><span>${icon('check', 18)} Account details returned by API</span><small>Verify the account and provider instructions before sending funds.</small></div><dl><div><dt>Bank</dt><dd>${escapeHTML(state.account.bankName || '—')}</dd></div><div><dt>Account name</dt><dd>${escapeHTML(state.account.accountName || '—')}</dd></div><div><dt>Account number</dt><dd><strong>${escapeHTML(state.account.accountNumber || '—')}</strong><button class="icon-button" data-action="copy-account" aria-label="Copy account number">${icon('copy', 17)}</button></dd></div></dl></div>` : `<form class="inline-account-form" data-form="virtual-account"><label>Phone number for your dedicated account<input name="phoneNumber" type="tel" required minlength="7" placeholder="e.g. +234 810 123 4567"></label><button class="button" type="submit">Create virtual account ${icon('arrow', 16)}</button></form><p class="muted-caption">This requests an account from the configured backend. No bank details are invented in preview.</p>`}</article></section>
    <section class="panel"><div class="panel-head"><div><span class="eyebrow">RECENT ACTIVITY</span><h2>Wallet transactions</h2></div><a data-link class="text-link" href="/transactions">View all ${icon('arrow', 14)}</a></div>${transactionRows(transactions)}${getApiBase() ? '' : `<div class="preview-footnote">${icon('eye', 15)} Example wallet activity only.</div>`}</section>`);
}

function orderRows(orders) {
  if (!orders.length) return `<div class="empty-state"><span>${icon('bag', 24)}</span><b>No orders yet</b><p>Your orders will appear here after the API confirms them.</p></div>`;
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Product</th><th>Date</th><th>Status</th><th>Amount</th><th></th></tr></thead><tbody>${orders.map((item) => `<tr><td><span class="table-product"><span class="table-product-icon">${icon(item.type === 'Virtual Numbers' ? 'phone' : 'file', 18)}</span><b>${escapeHTML(item.product)}</b><small>${escapeHTML(item.reference)}</small></span></td><td>${escapeHTML(item.date)}</td><td><span class="status-pill ${String(item.status).toLowerCase()}">${escapeHTML(item.status)}</span></td><td class="amount-cell">${formatAmount(item.amount)}</td><td><button class="link-button" data-action="order-detail" data-id="${escapeHTML(item.id || item.reference)}">Details</button></td></tr>`).join('')}</tbody></table></div>`;
}

function transactionRows(rows) {
  return `<div class="transaction-list">${rows.map((tx) => `<div class="transaction-row"><span class="transaction-icon ${tx.direction === 'in' ? 'in' : 'out'}">${icon(tx.direction === 'in' ? 'arrows' : 'bag', 18)}</span><span class="transaction-copy"><b>${escapeHTML(tx.type)}</b><small>${escapeHTML(tx.date)} · ${escapeHTML(tx.reference)}</small></span><span class="transaction-amount ${tx.direction === 'in' ? 'positive' : ''}">${tx.direction === 'in' ? '+' : '−'}${formatAmount(tx.amount)}<small>${escapeHTML(tx.status)}</small></span></div>`).join('')}</div>`;
}

function apiRows(result, key) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.[key])) return result[key];
  if (Array.isArray(result?.data)) return result.data;
  return [];
}

function apiDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' });
}

function mapOrders(rows) {
  return rows.map((item) => {
    const lineItems = Array.isArray(item.items) ? item.items : [];
    const names = lineItems.map((line) => line.product?.name || line.productNameSnapshot || line.productName || line.productId).filter(Boolean);
    const categories = lineItems.map((line) => line.product?.category?.slug || line.categorySlug || line.productCategorySlug).filter(Boolean);
    const numberType = categories.includes('virtual-numbers');
    const logType = categories.includes('logs');
    return {
      id: item.id,
      reference: item.orderReference || item.reference || item.id || '—',
      product: names.join(', ') || item.product || `Order ${item.orderReference || item.reference || item.id || ''}`.trim(),
      type: numberType ? 'Virtual Numbers' : logType ? 'Logs' : item.type || 'Service',
      date: apiDate(item.createdAt || item.date),
      status: item.status || '—',
      amount: item.total ?? item.amount ?? item.totalAmount ?? 0,
    };
  });
}

function mapTransactions(rows) {
  return rows.map((item) => {
    const rawType = String(item.type || item.kind || 'Transaction').toUpperCase();
    const incoming = /CREDIT|DEPOSIT|REFUND/.test(rawType) && !/DEBIT/.test(rawType);
    const labels = { WALLET_CREDIT: 'Wallet deposit', PURCHASE_DEBIT: 'Marketplace purchase', REFUND_CREDIT: 'Refund' };
    return {
      type: labels[rawType] || rawType.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()),
      date: apiDate(item.createdAt || item.date),
      reference: item.reference || item.transactionReference || item.id || '—',
      amount: item.amount ?? item.value ?? 0,
      status: item.status || '—',
      direction: incoming ? 'in' : 'out',
    };
  });
}

function mapNotifications(rows) {
  return rows.map((item) => {
    const type = String(item.type || '').toLowerCase();
    return {
      id: item.id || item.notificationId || '',
      title: item.title || 'Account update',
      body: item.body || item.message || 'Open your account for more information.',
      read: Boolean(item.read ?? item.isRead ?? item.readAt),
      time: item.time || apiDate(item.createdAt),
      tone: item.tone || (type.includes('deposit') || type.includes('wallet') ? 'green' : type.includes('support') ? 'brown' : ''),
      icon: item.icon || (type.includes('deposit') || type.includes('wallet') ? 'wallet' : type.includes('support') ? 'help' : 'megaphone'),
    };
  });
}

function ordersPage() {
  const filters = ['All orders', 'Logs', 'Virtual Numbers'];
  const orders = state.orders ?? (getApiBase() ? [] : sampleOrders);
  const activeFilter = state.orderFilter || 'All orders';
  const mappedOrders = mapOrders(orders);
  const visibleOrders = activeFilter === 'All orders' ? mappedOrders : mappedOrders.filter((item) => item.type === activeFilter);
  const categoryMetadataMissing = getApiBase() && mappedOrders.some((item) => item.type === 'Service');
  return accountShell('orders', `${pageHeading('ORDER HISTORY', 'My Orders', 'Track purchases and review their latest server-confirmed status.')}
    <section class="panel"><div class="panel-head"><div><span class="eyebrow">YOUR PURCHASES</span><h2>Orders and purchase history</h2></div><span class="muted-caption">${visibleOrders.length} shown</span></div><div class="tabs" role="tablist">${filters.map((filter) => `<button class="tab-button ${filter === activeFilter ? 'active' : ''}" role="tab" aria-selected="${filter === activeFilter}" data-action="order-filter" data-filter="${filter}">${filter}</button>`).join('')}</div>${categoryMetadataMissing ? `<p class="muted-caption">The supplied Orders API returns product-name snapshots but not category labels. Category filters can only classify rows when the API provides category data.</p>` : ''}${orderRows(visibleOrders)}${getApiBase() ? '' : `<div class="preview-footnote">${icon('eye', 15)} All rows shown here are example preview data.</div>`}</section>`);
}

function orderDetailPage(id) {
  const order = state.orderDetail;
  const title = order?.items?.map((item) => item.product?.name || item.productNameSnapshot || item.productId).filter(Boolean).join(', ') || order?.orderReference || order?.id || 'Order details';
  const status = order?.providerState || order?.state || order?.status || 'Loading';
  const delivery = state.delivery;
  const canReveal = String(order?.status || '').toUpperCase() === 'COMPLETED';
  if (!state.user) return accountShell('orders', `${pageHeading('ORDER DETAILS', 'Order details', 'Sign in to view a private order.') }<section class="panel"><div class="empty-state"><span>${icon('user', 24)}</span><b>Sign in required</b><p>Order details and delivery are never shown to a signed-out visitor.</p><a class="button button-small" href="/login" data-link>Sign in</a></div></section>`);
  if (!order && state.authMessage) return accountShell('orders', `${pageHeading('ORDER DETAILS', 'Order unavailable', 'The server did not confirm this order for the current account.')}<div class="preview-notice" role="alert">${icon('warning', 17)}<span>${escapeHTML(state.authMessage)}</span><a data-link href="/orders">Back to orders</a></div>`);
  return accountShell('orders', `${pageHeading('ORDER DETAILS', 'Order details', 'Private order information is loaded only for the signed-in owner.')}
    <section class="panel order-detail-panel"><div class="panel-head"><div><span class="eyebrow">PRIVATE ORDER</span><h2>${escapeHTML(title)}</h2></div><span class="status-pill ${String(status).toLowerCase()}">${escapeHTML(status)}</span></div>${order ? `<dl class="number-order-meta"><div><dt>Placed</dt><dd>${escapeHTML(apiDate(order.createdAt))}</dd></div><div><dt>Total</dt><dd>${formatAmount(order.total ?? order.amount ?? order.totalAmount ?? 0)}</dd></div><div><dt>Reference</dt><dd>${escapeHTML(order.orderReference || order.reference || order.id || id)}</dd></div></dl>${delivery ? `<div class="private-reveal"><span class="eyebrow">DELIVERY</span>${delivery.lines?.length ? delivery.lines.map((line) => `<strong>${escapeHTML(line)}</strong>`).join('') : '<strong>No delivery lines were returned.</strong>'}<small>This sensitive delivery is held in memory only and clears when you leave this page or sign out.</small></div>` : canReveal ? `<div class="empty-state"><span>${icon('shield', 24)}</span><b>Delivery is protected</b><p>Confirm before revealing sensitive delivery credentials. They are never stored in local storage or route state.</p><button class="button" data-action="reveal-delivery" data-id="${escapeHTML(id)}">${icon('eye', 16)} Reveal delivery</button></div>` : `<div class="empty-state"><span>${icon('clock', 24)}</span><b>Delivery is not available</b><p>${escapeHTML(order.providerState === 'RECONCILIATION' ? 'The supplier outcome is uncertain. Keep this order and wait for administrator reconciliation; do not place another order.' : 'Delivery can be revealed only after the server confirms completed fulfillment.')}</p>${order.providerState && !['COMPLETED', 'FAILED', 'REFUNDED', 'CANCELLED', 'CANCELED'].includes(String(order.providerState).toUpperCase()) ? `<button class="button button-outline" data-action="order-refresh" data-id="${escapeHTML(id)}">Refresh order status</button>` : ''}</div>`}<div class="detail-actions"><a class="button button-outline" href="/orders" data-link>Back to orders</a></div>` : `<div class="empty-state"><span>${icon('clock', 24)}</span><b>Loading order…</b><p>Requesting owner-only order data.</p></div>`}</section>`);
}

function numbersPage() { return renderNumbersPage({ state, pageHeading, accountShell, icon }); }
function numberOrderPage() { return renderNumberOrderPage({ state, pageHeading, accountShell, icon }); }

function transactionsPage() {
  const transactions = state.transactions ?? (getApiBase() ? [] : sampleTransactions);
  return accountShell('transactions', `${pageHeading('WALLET LEDGER', 'Transaction history', 'A clear record of wallet credits, purchases, and other account activity.')}
    <section class="panel"><div class="panel-head"><div><span class="eyebrow">YOUR WALLET</span><h2>Transactions</h2></div><button class="button button-outline button-small" data-action="filter-transactions">${icon('filter', 16)} Filter</button></div><div class="filter-chips"><button class="chip active">All</button><button class="chip">Credits</button><button class="chip">Purchases</button><button class="chip">Refunds</button></div>${transactionRows(mapTransactions(transactions))}${getApiBase() ? '' : `<div class="preview-footnote">${icon('eye', 15)} Example ledger only. Confirmed transactions are read from the API.</div>`}</section>`);
}

function profilePage() {
  const user = state.profile || state.user || (!state.signedOut && !getApiBase() ? sampleUser : {});
  return accountShell('profile', `${pageHeading('ACCOUNT SETTINGS', 'Profile & settings', 'Manage your personal details, security, and notification preferences.')}
    <div class="settings-layout"><aside class="settings-nav"><a class="active" href="#personal">${icon('user', 18)} Personal information</a><a href="#security">${icon('shield', 18)} Security</a><a href="#notifications">${icon('bell', 18)} Notifications</a><a href="#api-settings">${icon('settings', 18)} API connection</a></aside><div class="settings-content"><section class="panel settings-panel" id="personal"><div class="panel-head"><div><span class="eyebrow">YOUR PROFILE</span><h2>Personal information</h2></div><span class="avatar avatar-large">${escapeHTML((user.fullName || 'H').slice(0, 1))}</span></div><form class="stack-form form-two-col" data-form="profile"><label>Full name<input name="fullName" required value="${escapeHTML(user.fullName || '')}"></label><label>Email address<input name="email" type="email" value="${escapeHTML(user.email || '')}" readonly></label><label>Phone number<input name="phoneNumber" type="tel" value="${escapeHTML(user.phoneNumber || '')}"></label><div class="form-end"><button class="button button-small" type="submit">Update profile</button></div></form><p class="preview-footnote">Profile changes are saved only after the API accepts them.</p></section>
      <section class="panel settings-panel" id="security"><div class="panel-head"><div><span class="eyebrow">ACCOUNT SECURITY</span><h2>Change password</h2></div>${icon('shield', 22, 'panel-head-icon')}</div><form class="stack-form form-two-col" data-form="password"><label>Current password<input name="currentPassword" type="password" required autocomplete="current-password"></label><label>New password<input name="newPassword" type="password" required minlength="8" autocomplete="new-password"></label><div class="form-end"><button class="button button-small" type="submit">Update password</button></div></form></section>
      <section class="panel settings-panel" id="notifications"><div class="panel-head"><div><span class="eyebrow">PREFERENCES</span><h2>Notifications</h2></div></div><label class="preference-row"><span><b>Account and order updates</b><small>Important changes to orders, wallet and security.</small></span><input type="checkbox" checked disabled aria-label="Account and order updates enabled in prototype"></label><p class="preview-footnote">Preference storage is not yet included in the supplied API.</p></section>
      <section class="panel settings-panel" id="api-settings"><div class="panel-head"><div><span class="eyebrow">INTEGRATION</span><h2>Connect your API</h2></div><span class="connection-pill ${state.apiConnected ? 'connected' : ''}"><i></i>${state.apiConnected ? 'Reachable' : 'Not connected'}</span></div><p>Enter the API base URL ending in <code>/api/v1</code>. For this single-port setup, use <code>/api/v1</code>. This field is not a secret; do not paste provider keys here.</p><form class="api-config-form" data-form="api-config"><label class="sr-only" for="apiBase">API base URL</label><input id="apiBase" name="apiBase" type="text" placeholder="/api/v1" value="${escapeHTML(getApiBase())}"><button class="button button-small" type="submit">Save API URL</button></form><p class="muted-caption">Same-origin requests use the marketplace server; using the marketplace connection keeps setup simple.</p></section>
    </div></div>`);
}

function notificationsPage() {
  const notices = state.notifications !== null ? mapNotifications(state.notifications) : (getApiBase() ? [] : sampleNotifications);
  return accountShell('notifications', `${pageHeading('ACCOUNT UPDATES', 'Notifications', 'Stay up to date with orders, wallet activity, and support.')}
    <section class="panel"><div class="panel-head"><div><span class="eyebrow">YOUR ACTIVITY</span><h2>Notifications</h2></div><button class="link-button" data-action="mark-all">Mark all as read</button></div><div class="notification-list">${notices.map((item) => `<article class="notification-item ${item.read ? 'read' : 'unread'}"><span class="notification-icon ${item.tone}">${icon(item.icon, 20)}</span><div class="notification-copy"><b>${escapeHTML(item.title)}</b><p>${escapeHTML(item.body)}</p><small>${escapeHTML(item.time)} · ${item.read ? 'Read' : 'Unread'}</small></div><button class="link-button" data-action="mark-one" data-id="${escapeHTML(item.id)}">${item.read ? 'Read' : 'Mark read'}</button></article>`).join('') || `<div class="empty-state"><span>${icon('bell', 24)}</span><b>No notifications</b><p>There are no customer updates to show.</p></div>`}</div>${getApiBase() ? '' : `<div class="preview-footnote">${icon('eye', 15)} Example notifications only.</div>`}</section>`);
}

function supportPage() {
  return `<div class="site-public">${publicHeader()}<main class="support-page page-wrap">${previewNotice()}<section class="support-hero" id="about"><div><span class="eyebrow">ABOUT EMMYJOSH LOGS</span><h1>Digital services,<br><span>made clearer.</span></h1><p>Emmyjosh Logs Marketplace brings together lawful digital services and account tools in a straightforward experience.</p><a data-link class="button" href="/marketplace">Explore marketplace ${icon('arrow', 17)}</a></div><div class="support-brand-visual">${logo('support-logo')}<span>YOUR TRUSTED LOGS &amp; VIRTUAL NUMBER HUB</span><div class="support-swoosh"></div></div></section><section class="support-content-grid"><article class="panel" id="contact"><div class="panel-head"><div><span class="eyebrow">WE’RE HERE TO HELP</span><h2>Contact support</h2></div>${icon('help', 23, 'panel-head-icon')}</div><p>Send a question or tell us what you need help with. A ticket is only recorded when the support API confirms it.</p><form class="stack-form" data-form="support"><label>Subject<input name="subject" required minlength="3" maxlength="160" placeholder="How can we help?"></label><label>Message<textarea name="body" required minlength="3" maxlength="4000" rows="5" placeholder="Share a few details…"></textarea></label><button class="button" type="submit">Send support request ${icon('arrow', 17)}</button><p class="form-feedback" data-feedback></p></form></article><aside class="policy-panel"><span class="eyebrow">HELPFUL INFORMATION</span><a id="terms" href="#terms">Terms of service <small>Content pending</small><span>›</span></a><a id="privacy" href="#privacy">Privacy policy <small>Content pending</small><span>›</span></a><a id="refunds" href="#refunds">Refund information <small>Content pending</small><span>›</span></a><a id="password" href="#password">Password recovery <small>Not configured</small><span>›</span></a><div class="policy-note">${icon('shield', 18)}<p>Only lawfully sourced products and authorized use are supported. Payment questions are reviewed against verified provider records. Official policy copy has not been provided yet.</p></div></aside></section></main><footer class="public-footer page-wrap"><a data-link href="/">${logo('footer-logo')}</a><p>Emmyjosh Logs Marketplace · Lawful services, clearly presented.</p><div><a data-link href="/admin/login">Admin</a><a data-link href="/support">Support</a><a data-link href="/support#terms">Terms</a><a data-link href="/support#privacy">Privacy</a></div></footer></div><div class="toast-slot" aria-live="polite"></div>`;
}

function adminSidebar(active) {
  const items = [
    ['dashboard', 'Overview', '/admin', 'home'], ['customers', 'Customers', '/admin/customers', 'user'],
    ['products', 'Products', '/admin/products', 'grid'], ['categories', 'Categories', '/admin/categories', 'grid'],
    ['pricing', 'Pricing rules', '/admin/pricing', 'wallet'], ['uploads', 'Upload Logs', '/admin/uploads', 'plus'],
    ['inventory', 'Inventory', '/admin/inventory', 'file'],
    ['orders', 'Orders', '/admin/orders', 'bag'], ['transactions', 'Transactions', '/admin/transactions', 'arrows'],
    ['accounts', 'Virtual accounts', '/admin/virtual-accounts', 'wallet'], ['notifications', 'Notifications', '/admin/notifications', 'bell'],
    ['support', 'Support', '/admin/support', 'help'], ['audit', 'Audit logs', '/admin/audit-logs', 'shield'], ['settings', 'Settings', '/admin/settings', 'settings'],
  ];
  return `<aside class="app-sidebar admin-sidebar ${state.menuOpen ? 'open' : ''}"><a data-link class="sidebar-brand" href="/admin">${logo('sidebar-logo')}</a><span class="sidebar-label">ADMINISTRATION</span><nav>${items.map(([id, label, href, glyph]) => `<a data-link class="sidebar-link ${active === id ? 'active' : ''}" href="${href}">${icon(glyph, 18)}<span>${label}</span></a>`).join('')}</nav><div class="sidebar-bottom"><a data-link class="sidebar-link" href="/dashboard">${icon('user', 18)}<span>Customer view</span></a><a data-link class="sidebar-link logout-link" href="/">${icon('logout', 18)}<span>Exit admin preview</span></a></div></aside>`;
}

function adminShell(active, content) {
  return `<div class="app-shell admin-shell">${adminSidebar(active)}<div class="app-main">${userTopbar()}<main class="app-content">${previewNotice()}<div class="admin-preview-banner">${icon('eye', 17)} <span>Admin preview only. Every administrator action must be protected by backend role checks and audit logging.</span></div>${content}</main></div></div><div class="toast-slot" aria-live="polite"></div>`;
}

function adminPage(route) {
  const last = route.split('/').filter(Boolean).at(-1) || 'admin';
  if (last === 'admin') return adminShell('dashboard', `${pageHeading('ADMINISTRATION', 'Overview', 'Marketplace activity and operational overview.')}
    <div class="metrics-grid admin-metrics">${metricCard('user', 'Customers', '248', 'Example count', 'orange')}${metricCard('bag', 'Orders', '612', 'Example count', 'brown')}${metricCard('wallet', 'Revenue', formatNaira(1845000), 'Example total', 'green')}${metricCard('help', 'Open support', '7', 'Example queue', 'yellow')}</div>
    <section class="content-grid two-col"><article class="panel"><div class="panel-head"><div><span class="eyebrow">RECENT ACTIVITY</span><h2>Admin activity</h2></div><a data-link class="text-link" href="/admin/audit-logs">Audit logs ${icon('arrow', 14)}</a></div><div class="admin-activity">${sampleAdmin.events.map((event) => `<div><span class="activity-dot"></span><p><b>${escapeHTML(event.action)}</b><small>${escapeHTML(event.actor)} · ${escapeHTML(event.date)}</small></p></div>`).join('')}</div></article><article class="panel admin-shortcuts"><div class="panel-head"><div><span class="eyebrow">MANAGE</span><h2>Quick links</h2></div></div><a data-link href="/admin/products">Review products ${icon('arrow', 15)}</a><a data-link href="/admin/orders">Open order queue ${icon('arrow', 15)}</a><a data-link href="/admin/support">Respond to support ${icon('arrow', 15)}</a><a data-link href="/admin/virtual-accounts">Virtual account status ${icon('arrow', 15)}</a></article></section>`);

  const config = {
    customers: ['CUSTOMER RECORDS', 'Customers', 'Search and review customer accounts.'],
    products: ['CATALOGUE', 'Products', 'Create and manage lawful marketplace products.'],
    categories: ['TAXONOMY', 'Categories', 'Review the two approved marketplace categories.'],
    inventory: ['STOCK CONTROL', 'Inventory', 'Review availability and inventory state.'],
    orders: ['FULFILMENT', 'Orders', 'Review orders and their current processing status.'],
    transactions: ['WALLET LEDGER', 'Transactions', 'Review financial records; corrections should remain auditable.'],
    'virtual-accounts': ['PAYMENT OPERATIONS', 'Virtual accounts', 'Review provider account status and references.'],
    notifications: ['CUSTOMER UPDATES', 'Notifications', 'Prepare relevant system notices for customers.'],
    support: ['CUSTOMER CARE', 'Support tickets', 'Review open support requests and replies.'],
    'audit-logs': ['ACCOUNTABILITY', 'Audit logs', 'Review sensitive administrator actions.'],
    settings: ['PLATFORM', 'Settings', 'Review platform-level configuration.'],
  }[last] || ['ADMINISTRATION', 'Admin page', 'Manage marketplace operations.'];
  return adminShell(last, `${pageHeading(...config)}${adminDataPanel(last)}`);
}

function adminDataPanel(section) {
  const links = {
    customers: ['Name', 'Email', 'Status', 'Wallet'],
    products: ['Product', 'Category', 'Price', 'Availability'],
    categories: ['Category', 'Slug', 'Status', 'Scope'],
    inventory: ['Reference', 'Product', 'Status', 'Updated'],
    orders: ['Reference', 'Customer', 'Status', 'Amount'],
    transactions: ['Reference', 'Type', 'Status', 'Amount'],
    'virtual-accounts': ['Customer', 'Provider', 'Account status', 'Currency'],
    notifications: ['Title', 'Audience', 'Status', 'Date'],
    support: ['Ticket', 'Customer', 'Status', 'Updated'],
    'audit-logs': ['Action', 'Actor', 'Target', 'Timestamp'],
    settings: ['Setting', 'Current value', 'Scope', 'Status'],
  };
  const headers = links[section] || ['Item', 'Type', 'Status', 'Date'];
  let rows;
  if (section === 'categories') rows = [['Logs', 'logs', 'Approved', 'Preview only'], ['Virtual Numbers', 'virtual-numbers', 'Approved', 'Preview only']];
  else if (section === 'customers') rows = sampleAdmin.customers.map((x) => [x.name, x.email, x.status, formatNaira(x.balance)]);
  else if (section === 'audit-logs') rows = sampleAdmin.events.map((x) => [x.action, x.actor, 'Example', x.date]);
  else if (section === 'products') rows = sampleProducts.slice(0, 4).map((x) => [x.name, x.category, formatAmount(x.price), x.available ? 'Example stock' : 'Unavailable']);
  else if (section === 'orders') rows = sampleOrders.map((x) => [x.reference, sampleUser.fullName, x.status, formatAmount(x.amount)]);
  else if (section === 'transactions') rows = sampleTransactions.map((x) => [x.reference, x.type, x.status, formatAmount(x.amount)]);
  else if (section === 'inventory') rows = sampleProducts.slice(0, 4).map((x, i) => [`DEMO-STOCK-${100 + i}`, x.name, x.available ? 'Example available' : 'Unavailable', 'Preview data']);
  else if (section === 'virtual-accounts') rows = [['No live accounts', 'PocketFi', 'Not connected', 'NGN']];
  else if (section === 'notifications') rows = sampleNotifications.map((x) => [x.title, 'Example audience', 'Draft preview', x.time]);
  else if (section === 'support') rows = [['No live tickets', 'Preview customer', 'Waiting for API', '—']];
  else rows = [['API connection', 'Not configured', 'Preview only', '—'], ['Payment provider', 'PocketFi', 'Contract needs verification', '—']];
  return `<section class="panel admin-table-panel"><div class="panel-head"><div><span class="eyebrow">${section.toUpperCase().replaceAll('-', ' ')}</span><h2>${headers[0]} and records</h2></div>${section === 'products' ? '<button class="button button-small" data-action="admin-create">' + icon('plus', 16) + ' Add product</button>' : '<button class="button button-outline button-small" data-action="admin-export">' + icon('filter', 16) + ' Filter</button>'}</div><div class="table-wrap"><table class="data-table"><thead><tr>${headers.map((head) => `<th>${escapeHTML(head)}</th>`).join('')}<th></th></tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHTML(cell)}</td>`).join('')}<td><button class="link-button" data-action="admin-review">Review</button></td></tr>`).join('')}</tbody></table></div><div class="preview-footnote">${icon('eye', 15)} Preview records only. Persistence requires an authenticated admin API response.</div></section>`;
}

function render() {
  const route = window.location.pathname.replace(/\/$/, '') || '/';
  const query = new URLSearchParams(window.location.search);
  document.title = route === '/' ? 'Emmyjosh Logs Marketplace' : `${route.split('/').filter(Boolean).at(-1)?.replaceAll('-', ' ') || 'Marketplace'} · Emmyjosh Logs`;
  const managedAdminRoutes = ['/admin', '/admin/login', '/admin/products', '/admin/pricing', '/admin/inventory', '/admin/uploads', '/admin/orders', '/admin/checkout', '/admin/supplier', '/admin/audit-logs'];
  if (managedAdminRoutes.includes(route)) {
    void mountAdminTools(app, { route, navigate, icon, logo, escapeHTML, toast });
    return;
  }
  app.__adminToolsMount = null;
  if (route === '/') app.innerHTML = landingPage();
  else if (route === '/login') app.innerHTML = authPage('login');
  else if (route === '/register') app.innerHTML = authPage('register');
  else if (route === '/dashboard') app.innerHTML = dashboardPage();
  else if (route === '/marketplace') app.innerHTML = marketplacePage();
  else if (route.startsWith('/product/')) app.innerHTML = productPage(route.slice('/product/'.length));
  else if (route === '/wallet') app.innerHTML = walletPage();
  else if (route === '/orders') app.innerHTML = ordersPage();
  else if (route.startsWith('/orders/')) app.innerHTML = orderDetailPage(route.slice('/orders/'.length));
  else if (route === '/numbers') app.innerHTML = numbersPage();
  else if (route.startsWith('/numbers/orders/')) app.innerHTML = numberOrderPage();
  else if (route === '/transactions') app.innerHTML = transactionsPage();
  else if (route === '/profile') app.innerHTML = profilePage();
  else if (route === '/notifications') app.innerHTML = notificationsPage();
  else if (route === '/support') { app.innerHTML = supportPage(); app.querySelector('.support-page')?.insertAdjacentHTML('beforeend', supportTicketHistoryPanel()); }
  else if (route === '/admin' || route.startsWith('/admin/')) app.innerHTML = adminPage(route);
  else app.innerHTML = `<div class="not-found"><a data-link href="/">${logo()}</a><h1>Page not found</h1><p>That page isn’t available.</p><a data-link class="button" href="/">Return home ${icon('arrow', 16)}</a></div>`;
  bindEvents();
  if ((route === '/' || route === '/marketplace') && !state.ownProductsLoaded) {
    state.ownProductsLoaded = true;
    void loadOwnCatalog();
  }
  if (route.startsWith('/product/ejl_')) void loadOwnProduct(route.slice('/product/'.length));
  if ((route === '/' || route === '/marketplace') && getApiBase()) {
    const sort = query.get('sort') || 'popular';
    const key = `${query.get('q') || ''}|${query.get('category') || ''}|${sort}`;
    if (key !== state.productQueryKey && !state.productsLoading) void loadProducts(query.get('q') || '', query.get('category') || '', sort);
  }
  if (route.startsWith('/product/') && !route.startsWith('/product/ejl_') && getApiBase()) void loadProduct(route.slice('/product/'.length));
  if (getApiBase() && state.user && ['/dashboard', '/orders', '/transactions', '/profile', '/notifications', '/support'].includes(route) && !state.loaded[route]) {
    state.loaded[route] = true;
    void loadAccountPage(route);
  }
  if (route === '/marketplace' && state.user && !state.supplierLoaded && !state.supplierLoading) void loadSupplierQuotes();
  if (route === '/wallet' && getApiBase() && state.user && !state.loaded.wallet) {
    state.loaded.wallet = true;
    void loadWalletAccount();
  }
  if (route === '/numbers' && getApiBase() && state.user && !state.loaded.numbers) {
    state.loaded.numbers = true;
    void loadNumbersCatalog();
  }
  if (route.startsWith('/numbers/orders/') && getApiBase() && state.user && state.numberOrder?.orderId !== route.slice('/numbers/orders/'.length)) {
    void loadNumberOrder(route.slice('/numbers/orders/'.length));
  }
  if (route.startsWith('/orders/') && getApiBase() && state.user && state.orderDetail?.id !== route.slice('/orders/'.length)) {
    void loadOrderDetail(route.slice('/orders/'.length));
  }
}

function navigate(target) {
  if (!target.startsWith('/orders/') && !target.startsWith('/numbers/orders/')) {
    state.delivery = null;
    state.orderDetail = null;
    state.numberOrder = null;
    state.numberError = '';
  }
  history.pushState({}, '', target);
  state.menuOpen = false;
  if (target === '/' || target.startsWith('/marketplace')) state.ownProductsLoaded = false;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toast(message, kind = 'info') {
  const slot = document.querySelector('.toast-slot') || (() => {
    const element = document.createElement('div'); element.className = 'toast-slot'; element.setAttribute('aria-live', 'polite'); document.body.appendChild(element); return element;
  })();
  slot.innerHTML = `<div class="toast ${kind}">${icon(kind === 'success' ? 'check' : 'help', 18)}<span>${escapeHTML(message)}</span><button data-action="dismiss-toast" aria-label="Dismiss">${icon('close', 16)}</button></div>`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { if (slot) slot.innerHTML = ''; }, 4800);
}

async function loadSupplierQuotes() {
  if (!state.user || state.supplierLoading) return;
  const userId = state.user.id;
  state.supplierLoading = true;
  state.supplierLoaded = true;
  state.supplierError = '';
  try {
    const [catalog, status] = await Promise.all([api.supplierLogsCatalog(), api.providerStatus()]);
    if (state.user?.id !== userId) return;
    state.supplierQuotes = Array.isArray(catalog.quotes) ? catalog.quotes : [];
    state.supplierStatus = status.don || null;
  } catch (error) {
    if (state.user?.id !== userId) return;
    state.supplierQuotes = [];
    state.supplierError = error.message || 'Supplier quotes could not be confirmed.';
  } finally {
    if (state.user?.id === userId) { state.supplierLoading = false; if (window.location.pathname === '/marketplace') render(); }
  }
}

function clearPrivateCaches() {
  stopSessionMonitor();
  state.loaded = {};
  for (const key of ['dashboard','wallet','orders','transactions','notifications','supportTickets','profile','account','orderDetail','delivery','numberOrder','numberCatalog']) state[key] = null;
  state.numberError = '';
  state.supplierQuotes = [];
  state.supplierStatus = null;
  state.supplierError = '';
  state.supplierLoaded = false;
  state.supplierLoading = false;
}

function expireCustomerSession() {
  state.user = null;
  state.profile = null;
  state.signedOut = true;
  clearPrivateCaches();
  state.apiConnected = true;
  state.authMessage = SESSION_EXPIRED_MESSAGE;
}

window.addEventListener('emmyjosh:session-expired', (event) => {
  if (!state.user && !event.detail?.hadSession) return;
  expireCustomerSession();
  navigate('/login');
  // Best-effort server cookie cleanup; the client has already cleared private state.
  void api.logout().catch(() => {});
  toast(SESSION_EXPIRED_MESSAGE, 'info');
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.user) {
    void api.me().catch(() => {});
  }
});

async function readOwnCatalog(path = '') {
  const response = await fetch(`/api/admin-tools/catalog${path}`, { headers: { 'X-EJ-Request': '1', Accept: 'application/json' }, credentials: 'omit' });
  if (!response.ok) throw new Error('The own-stock catalog could not be loaded.');
  return response.json();
}

async function loadOwnCatalog() {
  try {
    const result = await readOwnCatalog();
    state.ownProducts = Array.isArray(result.products) ? result.products : [];
    state.ownProductError = '';
  } catch {
    state.ownProducts = [];
    state.ownProductError = 'Own-stock listings are not available from the admin backend yet.';
  }
  if (['/', '/marketplace'].includes(window.location.pathname)) render();
}

async function loadOwnProduct(id) {
  const key = `own-product:${id}`;
  if (state.loaded[key]) return;
  state.loaded[key] = true;
  try {
    const result = await readOwnCatalog(`/${encodeURIComponent(decodeURIComponent(id))}`);
    state.currentProduct = result.product;
    state.ownProducts = [result.product, ...state.ownProducts.filter((product) => product.id !== result.product.id)];
    state.ownProductError = '';
  } catch {
    state.currentProduct = null;
    state.ownProductError = 'This own-stock listing is not active or could not be loaded.';
  }
  if (window.location.pathname.startsWith('/product/ejl_')) render();
}

async function loadProducts(q = '', category = '', sort = 'popular') {
  if (state.productsLoading) return;
  state.productsLoading = true;
  state.productQueryKey = `${q}|${category}|${sort}`;
  state.productError = '';
  render();
  try {
    const result = await api.products({ q, category, sort, limit: 50 });
    state.productCache = apiRows(result, 'products').map((item) => {
      const inventoryCount = typeof item._count?.inventory === 'number' ? item._count.inventory : null;
      return {
        ...item,
        priceMinor: item.priceMinor ?? decimalPriceMinor(item.price),
        category: item.category?.name || item.category || 'Logs',
        categorySlug: item.category?.slug || item.categorySlug || 'logs',
        available: typeof item.available === 'boolean' ? item.available : inventoryCount === null ? null : inventoryCount > 0,
        rating: item.rating ?? null, reviews: item.reviews ?? null,
        icon: (item.category?.slug || item.categorySlug) === 'virtual-numbers' ? 'phone' : 'file',
      };
    });
    state.apiConnected = true;
    state.apiMessage = '';
    state.productError = '';
  } catch (error) {
    state.apiMessage = error.message;
    state.productError = error.message || 'The product request could not be completed.';
    state.productCache = [];
  } finally {
    state.productsLoading = false;
    render();
  }
}

async function loadProduct(id) {
  const key = `product:${id}`;
  if (state.loaded[key]) return;
  state.loaded[key] = true;
  try {
    const result = await api.product(decodeURIComponent(id));
    const item = result.product || result;
    const inventoryCount = typeof item._count?.inventory === 'number' ? item._count.inventory : null;
    state.currentProduct = {
      ...item,
      priceMinor: item.priceMinor ?? decimalPriceMinor(item.price),
      category: item.category?.name || item.category || 'Logs',
      categorySlug: item.category?.slug || item.categorySlug || 'logs',
      available: typeof item.available === 'boolean' ? item.available : inventoryCount === null ? null : inventoryCount > 0,
      rating: item.rating ?? null, reviews: item.reviews ?? null,
      icon: (item.category?.slug || item.categorySlug) === 'virtual-numbers' ? 'phone' : 'file',
    };
    state.productCache = [state.currentProduct, ...state.productCache.filter((product) => String(product.id) !== String(item.id))];
    state.apiConnected = true;
  } catch (error) {
    state.apiMessage = error.message;
    state.currentProduct = null;
  }
  if (window.location.pathname.startsWith('/product/')) render();
}

async function loadAccountPage(route) {
  try {
    if (route === '/dashboard') {
      const result = await api.dashboard();
      state.dashboard = result.summary || result.dashboard || result;
    } else if (route === '/orders') {
      state.orders = apiRows(await api.orders(), 'orders');
    } else if (route === '/transactions') {
      state.transactions = apiRows(await api.transactions(), 'transactions');
    } else if (route === '/notifications') {
      state.notifications = apiRows(await api.notifications(), 'notifications');
    } else if (route === '/support') {
      state.supportTickets = apiRows(await api.supportTickets(), 'tickets');
    } else if (route === '/profile') {
      const result = await api.profile();
      state.profile = result.user || result.profile || result;
      state.user = state.profile;
    }
    state.apiConnected = true;
    state.apiMessage = '';
    state.authMessage = '';
    if (window.location.pathname.replace(/\/$/, '') === route) render();
  } catch (error) {
    state.apiMessage = error.message;
    if ([401, 403].includes(error.status)) {
      state.user = null; state.profile = null; state.dashboard = null; state.wallet = null;
      state.orders = null; state.transactions = null; state.notifications = null; state.supportTickets = null; state.account = null;
      state.loaded = {};
    }
    state.authMessage = [401, 403].includes(error.status)
      ? 'Your API session is missing or expired. Sign in to view customer data.'
      : `Could not load account data: ${error.message}`;
    if (window.location.pathname.replace(/\/$/, '') === route) render();
  }
}

async function loadWalletAccount() {
  const [walletResult, accountResult, transactionResult] = await Promise.allSettled([
    api.wallet(), api.virtualAccount(), api.walletTransactions(),
  ]);
  let received = false;
  if (walletResult.status === 'fulfilled') {
    state.wallet = walletResult.value.wallet || walletResult.value;
    received = true;
  }
  if (accountResult.status === 'fulfilled') {
    state.account = accountResult.value.virtualAccount || null;
    received = true;
  }
  if (transactionResult.status === 'fulfilled') {
    state.transactions = apiRows(transactionResult.value, 'transactions');
    received = true;
  }
  const authFailure = [walletResult, accountResult, transactionResult]
    .find((result) => result.status === 'rejected' && [401, 403].includes(result.reason?.status));
  if (authFailure) {
    state.user = null; state.profile = null; state.wallet = null; state.account = null; state.transactions = null;
    state.loaded = {}; state.apiConnected = true;
    state.apiMessage = authFailure.reason.message;
    state.authMessage = SESSION_EXPIRED_MESSAGE;
  } else if (received) { state.apiConnected = true; state.authMessage = ''; }
  else {
    state.apiMessage = walletResult.reason?.message || accountResult.reason?.message || transactionResult.reason?.message || 'We could not load your wallet right now. Please try again.';
    state.authMessage = [401, 403].includes(walletResult.reason?.status || accountResult.reason?.status || transactionResult.reason?.status)
      ? SESSION_EXPIRED_MESSAGE
      : `We could not load your wallet right now. ${state.apiMessage}`;
  }
  if (window.location.pathname.replace(/\/$/, '') === '/wallet') render();
}

async function loadNumbersCatalog() {
  if (!state.user) return;
  state.numberLoading = true; state.numberError = ''; render();
  try {
    state.numberCatalog = await api.numberCatalog(state.numberFilters);
    state.apiConnected = true;
  } catch (error) {
    state.numberCatalog = null;
    state.numberError = [401, 403].includes(error.status) ? 'Sign in again to view provider quotes.' : error.message || 'Provider quotes are not configured.';
  } finally {
    state.numberLoading = false;
    if (window.location.pathname.replace(/\/$/, '') === '/numbers') render();
  }
}

async function loadNumberOrder(id) {
  if (!state.user) return;
  state.numberOrderLoading = true; state.numberError = ''; state.numberOrder = null; render();
  try {
    const result = await api.numberOrder(id);
    state.numberOrder = result.order || result;
    state.apiConnected = true;
  } catch (error) {
    state.numberError = [401, 403].includes(error.status) ? 'This number order is not available to the signed-in account.' : error.message || 'Number order status is unavailable.';
  } finally {
    state.numberOrderLoading = false;
    if (window.location.pathname.replace(/\/$/, '') === `/numbers/orders/${id}`) render();
  }
}

async function loadOrderDetail(id) {
  if (!state.user) return;
  state.orderDetail = null; state.delivery = null; render();
  try {
    const result = await api.order(id);
    state.orderDetail = result.order || result;
    const isSupplierLogs = state.orderDetail.items?.some((item) => /^(?:donmarketplace):/i.test(String(item.productId || '')));
    if (isSupplierLogs) {
      try {
        const external = await api.supplierLogsOrder(id);
        state.orderDetail = { ...state.orderDetail, providerState: external.state || external.status || null };
      } catch (error) {
        if (error.code === 'SESSION_CHANGED') return;
        state.orderDetail = { ...state.orderDetail, providerState: error.status === 401 ? null : 'STATUS_UNAVAILABLE' };
      }
    }
  } catch (error) {
    if (error.code === 'SESSION_CHANGED') return;
    state.authMessage = [401, 403].includes(error.status) ? 'This order is not available to the signed-in account.' : error.message || 'Order details are unavailable.';
  }
  if (window.location.pathname.replace(/\/$/, '') === `/orders/${id}`) render();
}

function bindEvents() {
  app.querySelectorAll('a[data-link]').forEach((link) => link.addEventListener('click', (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const href = link.getAttribute('href');
    if (!href || href.startsWith('#')) return;
    event.preventDefault();
    if (href.includes('#')) {
      const [path, anchor] = href.split('#');
      navigate(path || window.location.pathname);
      requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth' }));
    } else navigate(href);
  }));

  app.querySelectorAll('form[data-form]').forEach((form) => form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const kind = form.dataset.form;
    const values = Object.fromEntries(new FormData(form).entries());
    const button = form.querySelector('button[type="submit"]');
    if (button) { button.disabled = true; button.dataset.originalText = button.textContent; button.textContent = 'Please wait…'; }
    try {
      if (kind === 'login') {
        if (!getApiBase()) throw new ApiError('Connect the API URL in Profile & settings before using real login.', 0, 'NOT_CONFIGURED');
        clearPrivateCaches(); state.user = null; state.signedOut = true;
        await api.login({ identifier: values.identifier, password: values.password, rememberMe: form.rememberMe.checked });
        await refreshSession();
        state.apiConnected = true; state.loaded = {}; state.signedOut = false;
        toast('Signed in with the configured API.', 'success'); navigate('/dashboard'); return;
      }
      if (kind === 'register') {
        if (values.password !== values.confirmPassword) throw new ApiError('Your passwords do not match.', 422, 'VALIDATION');
        if (!getApiBase()) throw new ApiError('Connect the API URL in Profile & settings before creating a real account.', 0, 'NOT_CONFIGURED');
        clearPrivateCaches(); state.user = null; state.signedOut = true;
        await api.register(values);
        await refreshSession();
        state.apiConnected = true; state.loaded = {}; state.signedOut = false;
        toast('Account created by the API.', 'success'); navigate('/dashboard'); return;
      }
      if (kind === 'market-search') {
        const params = new URLSearchParams(); if (values.q?.trim()) params.set('q', values.q.trim());
        const category = new URL(window.location.href).searchParams.get('category'); if (category) params.set('category', category);
        navigate(`/marketplace${params.size ? `?${params}` : ''}`); return;
      }
      if (kind === 'number-search') {
        state.numberFilters = { provider: values.provider || '1', country: values.country || '', service: values.service || '', operator: values.operator || '' };
        state.loaded.numbers = false; state.numberCatalog = null; state.numberError = '';
        render(); void loadNumbersCatalog(); return;
      }
      if (kind === 'virtual-account') {
        if (!getApiBase()) throw new ApiError('Connect the API before requesting a virtual account.', 0, 'NOT_CONFIGURED');
        if (!state.user) throw new ApiError('Sign in through the configured API before requesting a virtual account.', 401, 'AUTH_REQUIRED');
        if (!window.confirm('This will contact the connected API and may request a real virtual bank account from its provider. Continue?')) return;
        const result = await api.createVirtualAccount(values.phoneNumber);
        state.account = result.virtualAccount || null; state.apiConnected = true;
        render(); toast(result.created === false ? 'Existing virtual account returned by the API.' : 'Virtual account details returned by the API.', 'success'); return;
      }
      if (kind === 'profile') {
        if (!getApiBase() || !state.user) throw new ApiError('Sign in through the configured API before updating your profile.', 401, 'AUTH_REQUIRED');
        const result = await api.updateProfile({ fullName: values.fullName, phoneNumber: values.phoneNumber });
        state.user = result.user || state.user;
        state.profile = state.user;
        state.apiConnected = true; render(); toast('Profile updated by the API.', 'success'); return;
      }
      if (kind === 'password') {
        if (!getApiBase() || !state.user) throw new ApiError('Sign in through the configured API before changing your password.', 401, 'AUTH_REQUIRED');
        await api.updatePassword({ currentPassword: values.currentPassword, newPassword: values.newPassword });
        state.apiConnected = true; form.reset(); toast('Password updated by the API.', 'success'); return;
      }
      if (kind === 'support') {
        if (!getApiBase() || !state.user) throw new ApiError('Sign in through the configured API before submitting a support ticket.', 401, 'AUTH_REQUIRED');
        await api.createSupportTicket(values.subject, values.body); state.apiConnected = true;
        state.supportTickets = null; state.loaded['/support'] = false;
        form.reset(); render(); toast('Support request accepted by the API.', 'success'); return;
      }
      if (kind === 'api-config') {
        const configured = setApiBase(values.apiBase);
        state.apiConnected = false;
        state.apiMessage = '';
        state.productError = '';
        state.authMessage = '';
        state.user = null;
        state.signedOut = true;
        state.profile = null;
        state.productCache = configured ? [] : [...sampleProducts];
        state.productQueryKey = '';
        state.productsLoading = false;
        state.loaded = {};
        state.dashboard = null;
        state.wallet = null;
        state.orders = null;
        state.transactions = null;
        state.notifications = null;
        state.supportTickets = null;
        state.account = null;
        state.currentProduct = null;
        if (!configured) { toast('API URL cleared. Preview sample data is available.', 'success'); render(); return; }
        try {
          await api.categories(); state.apiConnected = true; state.apiMessage = '';
          try { await refreshSession(); toast('Connection and sign-in confirmed.', 'success'); }
          catch { toast('Connection is working. Sign in to view your account.', 'info'); }
        } catch (error) { state.apiMessage = error.message; state.authMessage = 'We could not check the connection. Please try again.'; toast('Connection saved, but could not be checked. Please try again.', 'error'); }
        render(); return;
      }
    } catch (error) {
      toast(error.message || 'The request could not be completed.', 'error');
      const feedback = form.querySelector('[data-feedback]'); if (feedback) feedback.textContent = error.message;
    } finally {
      if (button?.isConnected) { button.disabled = false; button.textContent = button.dataset.originalText || button.textContent; }
    }
  }));

  app.querySelectorAll('[data-action]').forEach((control) => control.addEventListener('click', async (event) => {
    const action = control.dataset.action;
    if (action === 'refresh-supplier-logs') { state.supplierLoaded = false; void loadSupplierQuotes(); return; }
    if (action === 'purchase-supplier-logs') {
      const quote = state.supplierQuotes.find(item => item.id === control.dataset.quote);
      if (!state.user || !quote || !state.supplierStatus?.purchasesEnabled) return toast('This supplier listing is not enabled for checkout.', 'error');
      if (state.purchasePending) return;
      const input = document.getElementById(`don-quantity-${quote.id}`);
      const quantity = Number(input?.value || quote.minQty || 1);
      if (!Number.isSafeInteger(quantity) || quantity < Number(quote.minQty || 1) || quantity > Number(quote.maxQty || 1)) return toast('Choose a quantity within the listed limits.', 'error');
      if (!window.confirm(`Submit ${quantity} unit(s) of ${quote.name} at the listed unit price? Your wallet will be charged server-side. Unknown supplier delivery remains in Orders for reconciliation.`)) return;
      state.purchasePending = true; control.disabled = true;
      try {
        const result = await api.createSupplierLogsOrder(quote.id, quantity, quote.priceMinor);
        state.orders = null; state.wallet = null; state.dashboard = null; state.loaded = {};
        if (result.order?.id) navigate(`/orders/${encodeURIComponent(result.order.id)}`);
        toast(`Order state: ${result.order?.status || result.order?.state || 'Awaiting confirmation'}.`, 'info');
      } catch (error) { toast(error.message, 'error'); }
      finally { state.purchasePending = false; if (control.isConnected) control.disabled = false; }
      return;
    }
    if (action === 'retry-own-catalog') { state.ownProductsLoaded = true; void loadOwnCatalog(); return; }
    if (action === 'menu') { state.menuOpen = !state.menuOpen; app.querySelectorAll('.public-nav, .app-sidebar').forEach((el) => el.classList.toggle('open', state.menuOpen)); }
    if (action === 'dismiss-toast') control.closest('.toast')?.remove();
    if (action === 'logout') {
      const hadSession = Boolean(state.user);
      clearPrivateCaches(); state.user = null; state.profile = null; state.signedOut = true;
      state.authMessage = 'You have signed out. Sign in again to continue.';
      navigate('/login');
      let serverEnded = !getApiBase() || !hadSession;
      if (getApiBase() && hadSession) { try { await api.logout(); serverEnded = true; } catch { /* local private state is cleared, but never claim server revocation */ } }
      toast(serverEnded ? 'Signed out of this session.' : 'Account data was cleared, but the server did not confirm logout. Retry before leaving this shared device.', serverEnded ? 'success' : 'error');
    }
    if (action === 'copy-account') {
      const value = state.account?.accountNumber;
      if (!value) return toast('No account number is available.', 'error');
      try { await navigator.clipboard.writeText(value); toast('Account number copied.', 'success'); }
      catch { toast('Copy is not available in this browser.', 'error'); }
    }
    if (action === 'purchase') {
      const listedProduct = catalogProducts().find(item => String(item.id) === String(control.dataset.product));
      if (String(control.dataset.product || '').startsWith('ejl_') && listedProduct?.checkoutEnabled !== true) return toast('This listing is not currently enabled for checkout. Refresh its price and stock.', 'error');
      if (!getApiBase()) return toast('Preview mode only. Configure the API to request a real order.', 'error');
      if (!state.user) return toast('Sign in through the configured API before continuing.', 'error');
      if (state.purchasePending) return toast('A purchase request is already in progress.', 'info');
      if (!window.confirm('Submit this order to the connected API? It may debit your wallet. The server will determine the price, availability, and resulting order status.')) return;
      state.purchasePending = true;
      const purchaseButtons = [...document.querySelectorAll('[data-action="purchase"]')];
      const originalMarkup = new Map(purchaseButtons.map((button) => [button, button.innerHTML]));
      purchaseButtons.forEach((button) => { button.disabled = true; button.setAttribute('aria-busy', 'true'); button.textContent = 'Submitting…'; });
      try {
        const productId = control.dataset.product;
        const quantity = Number(document.querySelector('#quantity')?.value || listedProduct?.minQty || 1);
        const stockLimit = listedProduct?.customLog && Number.isInteger(listedProduct?._count?.inventory) ? listedProduct._count.inventory : Number(listedProduct?.maxQty || 100);
        const quantityLimit = Math.min(Number(listedProduct?.maxQty || 100), stockLimit);
        if (!Number.isSafeInteger(quantity) || quantity < Number(listedProduct?.minQty || 1) || quantity > quantityLimit) throw new Error(`Quantity cannot exceed the ${quantityLimit} units currently available in stock.`);
        const product = catalogProducts().find((item) => String(item.id) === String(productId));
        const expectedUnitPriceMinor = product?.priceMinor ?? null;
        if (!/^\d+$/.test(String(expectedUnitPriceMinor || ''))) { toast('The server-listed unit price is unavailable. Refresh the product before checking out.', 'error'); return; }
        const result = await api.createOrder(productId, quantity, expectedUnitPriceMinor);
        const order = result.order || result;
        state.apiConnected = true; state.orders = null; state.dashboard = null;
        state.loaded['/orders'] = false; state.loaded['/dashboard'] = false;
        const reference = order.orderReference || order.reference || order.id || 'returned order';
        toast(`API response for ${reference}: ${order.status || 'status unavailable'}. This does not confirm fulfilment.`, 'success');
      } catch (error) { toast(error.message, 'error'); }
      finally {
        state.purchasePending = false;
        purchaseButtons.forEach((button) => {
          button.disabled = false;
          button.removeAttribute('aria-busy');
          if (originalMarkup.has(button)) button.innerHTML = originalMarkup.get(button);
        });
      }
    }
    if (action === 'quantity-minus' || action === 'quantity-plus') {
      const input = document.querySelector('#quantity');
      if (input && !input.disabled) {
        const min = Number(input.min || 1);
        const max = Number(input.max || min);
        const current = Number(input.value || min);
        input.value = String(Math.max(min, Math.min(max, current + (action === 'quantity-plus' ? 1 : -1))));
      }
    }
    if (action === 'mark-all') {
      if (!getApiBase()) return toast('Preview mode: sample notifications cannot be marked in the live account.', 'error');
      if (!state.user) return toast('Sign in before updating notifications.', 'error');
      try {
        await api.markAllNotificationsRead();
        state.notifications = (state.notifications || []).map((item) => ({ ...item, read: true, isRead: true, readAt: item.readAt || new Date().toISOString() }));
        state.apiConnected = true; render(); toast('Notifications marked as read by the API.', 'success');
      }
      catch (error) { toast(error.message, 'error'); }
    }
    if (action === 'mark-one') {
      if (!getApiBase()) return toast('Preview mode: sample notifications cannot be marked in the live account.', 'error');
      if (!state.user) return toast('Sign in before updating notifications.', 'error');
      try {
        await api.markNotificationRead(control.dataset.id);
        state.notifications = (state.notifications || []).map((item) => String(item.id) === String(control.dataset.id) ? { ...item, read: true, isRead: true, readAt: item.readAt || new Date().toISOString() } : item);
        state.apiConnected = true; render(); toast('Notification updated by the API.', 'success');
      }
      catch (error) { toast(error.message, 'error'); }
    }
    if (action === 'social-login') toast('Social sign-in is not configured in the supplied API.', 'error');
    if (action === 'retry-products') {
      const url = new URL(window.location.href);
      state.productQueryKey = '';
      void loadProducts(url.searchParams.get('q') || '', url.searchParams.get('category') || '', url.searchParams.get('sort') || 'popular');
    }
    if (action === 'admin-create' || action === 'admin-export' || action === 'admin-review') toast('Admin actions are preview-only until a role-protected API is connected.', 'error');
    if (action === 'example-details') toast('This is a sample order. Connect the API to view a real order record.', 'info');
    if (action === 'order-detail') {
      if (!getApiBase()) return toast('This is an example order. Connect the API to view a real order record.', 'info');
      if (!state.user) return toast('Sign in before viewing order details.', 'error');
      navigate(`/orders/${encodeURIComponent(control.dataset.id)}`);
    }
    if (action === 'order-refresh') { const id = control.dataset.id; if (id) void loadOrderDetail(id); }
    if (action === 'reveal-delivery') {
      if (!getApiBase() || !state.user) return toast('Sign in before revealing order delivery.', 'error');
      if (!window.confirm('Reveal the sensitive delivery credentials for this order? They will remain in memory only until you leave or sign out.')) return;
      try { state.delivery = await api.delivery(control.dataset.id); render(); }
      catch (error) { toast(error.message, 'error'); }
    }
    if (action === 'number-order') {
      if (!state.user) return toast('Sign in before requesting a number.', 'error');
      if (!window.confirm('Request this number? The server will validate the quote and may debit your wallet.')) return;
      try {
        const result = await api.createNumberOrder(control.dataset.quoteId);
        const order = result.order || result;
        const id = order?.id || order?.orderId || result.orderId;
        state.numberOrder = { ...(order || {}), orderId: id, ...(result.session ? { session: result.session } : {}) };
        toast('Number order accepted by the API. Fulfilment is not assumed.', 'success');
        if (id) navigate(`/numbers/orders/${encodeURIComponent(id)}`);
      } catch (error) { toast(error.message, 'error'); }
    }
    if (action === 'number-refresh' || action === 'numbers-retry') {
      if (action === 'numbers-retry') { state.loaded.numbers = false; void loadNumbersCatalog(); }
      else { const id = window.location.pathname.split('/').at(-1); if (id) void loadNumberOrder(decodeURIComponent(id)); }
    }
    if (action === 'number-finish' || action === 'number-cancel') {
      const id = state.numberOrder?.orderId || window.location.pathname.split('/').at(-1);
      if (!id || !window.confirm(`${action === 'number-finish' ? 'Finish' : 'Cancel'} this number order?`)) return;
      try {
        const result = action === 'number-finish' ? await api.finishNumberOrder(id) : await api.cancelNumberOrder(id);
        state.numberOrder = result.order || result; render(); toast(`Number order ${action === 'number-finish' ? 'finish' : 'cancel'} request accepted by the API.`, 'success');
      } catch (error) { toast(error.message, 'error'); }
    }
    if (action === 'order-filter') {
      state.orderFilter = control.dataset.filter || 'All orders';
      render();
    }
    if (action === 'filter-transactions') toast('Filtering will be connected to transaction query parameters.', 'info');
  }));

  app.querySelectorAll('[data-change="sort"]').forEach((select) => select.addEventListener('change', () => {
    const url = new URL(window.location.href); url.searchParams.set('sort', select.value); navigate(`${url.pathname}${url.search}`);
  }));

  app.querySelectorAll('[data-search-shortcut]').forEach((input) => input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); navigate(`/marketplace?q=${encodeURIComponent(input.value)}`); }
  }));
}

async function initialize() {
  try {
    if (getApiBase()) {
      try {
        await api.categories();
        state.apiConnected = true;
        try { await refreshSession(); }
        catch (error) { if (![401, 403].includes(error.status)) state.apiMessage = error.message; }
      } catch (error) {
        state.apiMessage = error.message;
        state.authMessage = 'We could not connect right now. Please try again later.';
      }
    }
    render();
  } finally {
    endInitialLoading();
  }
}

window.addEventListener('popstate', () => {
  const route = window.location.pathname.replace(/\/$/, '') || '/';
  state.delivery = null;
  if (!route.startsWith('/orders/')) state.orderDetail = null;
  if (!route.startsWith('/numbers/orders/')) state.numberOrder = null;
  render();
});
initialize();
