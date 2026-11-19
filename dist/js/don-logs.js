import { formatMinorNaira } from './data.js';

function escape(value = '') { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
function platformArt(name) {
  const platform = ['instagram', 'tiktok', 'facebook', 'telegram', 'youtube'].find(value => String(name).toLowerCase().includes(value));
  return platform ? `<img src="/assets/social/${platform}.svg" alt="" width="30" height="30">` : '<span aria-hidden="true">EJ</span>';
}

export function renderSupplierLogs({ signedIn, loading, error, quotes = [], status } = {}) {
  let content;
  if (!signedIn) content = '<p class="muted-caption">Sign in to request supplier availability and your server-priced quotes.</p><a class="text-link" data-link href="/login">Sign in</a>';
  else if (loading) content = '<p role="status">Loading supplier quotes…</p>';
  else if (error) content = `<p role="alert">${escape(error)}</p><button class="button button-small" data-action="refresh-supplier-logs">Retry catalog</button>`;
  else if (!status?.enabled) content = '<p class="muted-caption">The supplier is not enabled. Your own authorized stock remains separate and available when activated.</p>';
  else if (!quotes.length) content = '<p class="muted-caption">No active, priced supplier stock is available. The administrator can sync stock and configure its retail markup when the supplier returns products.</p>';
  else content = `<div class="supplier-quote-grid">${quotes.map(quote => `<article class="supplier-quote"><div class="supplier-quote-heading">${platformArt(quote.name)}<div><strong>${escape(quote.name)}</strong><small>Donmarketplace · ${escape(status?.mode || 'sandbox')}</small></div></div><div class="supplier-quote-price">${formatMinorNaira(quote.priceMinor)} <small>per unit</small></div><label>Quantity <input id="don-quantity-${escape(quote.id)}" type="number" min="${Number(quote.minQty || 1)}" max="${Number(quote.maxQty || 1)}" value="${Number(quote.minQty || 1)}"></label><button class="button button-small" data-action="purchase-supplier-logs" data-quote="${escape(quote.id)}" ${status?.purchasesEnabled ? '' : 'disabled'}>${status?.purchasesEnabled ? 'Continue to purchase' : 'Supplier checkout disabled'}</button></article>`).join('')}</div>`;
  return `<section class="panel supplier-logs-panel"><div class="panel-head"><div><span class="eyebrow">AUTHORIZED SUPPLIER CATALOG</span><h2>Supplier Logs</h2></div>${signedIn && !loading ? '<button class="text-link" data-action="refresh-supplier-logs">Refresh catalog</button>' : ''}</div>${content}<p class="muted-caption">Retail prices are calculated by your marketplace. Unknown supplier outcomes stay in Orders for reconciliation, not a second purchase.</p></section>`;
}
