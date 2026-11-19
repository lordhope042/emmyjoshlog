function esc(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function money(minor, currency = 'NGN') {
  if (minor === null || minor === undefined || minor === '') return 'Price unavailable';
  try {
    const value = BigInt(String(minor));
    const naira = (value / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const kobo = (value % 100n).toString().padStart(2, '0');
    return `${currency === 'NGN' ? '₦' : `${currency} `}${naira}.${kobo}`;
  } catch { return 'Price unavailable'; }
}

function dateLabel(value) {
  if (!value) return 'Not available';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function statusTone(status) {
  const value = String(status || '').toUpperCase();
  if (['COMPLETED', 'FINISHED', 'RECEIVED'].includes(value)) return 'completed';
  if (['FAILED', 'CANCELLED', 'CANCELED', 'REFUNDED'].includes(value)) return 'failed';
  if (value === 'RECONCILIATION') return 'reconciliation';
  return 'pending';
}

export function renderNumbersPage({ state, pageHeading, accountShell, icon }) {
  const filters = state.numberFilters;
  const result = state.numberCatalog;
  const providers = Array.isArray(result?.providers) ? result.providers : [];
  const quotes = Array.isArray(result?.quotes) ? result.quotes : [];
  const countries = Array.isArray(result?.countries) ? result.countries : [];
  const services = Array.isArray(result?.services) ? result.services : [];
  if (!state.user) {
    return accountShell('numbers', `${pageHeading('VIRTUAL NUMBERS', 'Choose a number', 'Sign in to view current provider quotes and place a verified order.')}<section class="panel"><div class="empty-state"><span>${icon('user', 24)}</span><b>Sign in required</b><p>Provider catalogs and number orders are private to your account. No example prices are shown.</p><a class="button button-small" href="/login" data-link>Sign in</a></div></section>`);
  }
  const providerChoices = providers.length ? providers : [{ id: '1', label: 'Provider 1' }, { id: '2', label: 'Provider 2' }];
  const providerCards = providerChoices.map((provider) => {
    const id = String(provider.id ?? provider.provider ?? '');
    const label = provider.label || provider.providerLabel || provider.name || `Provider ${id}`;
    const active = String(filters.provider) === id;
    const down = provider.available === false || provider.status === 'DOWN';
    const note = down ? 'Currently unavailable' : active && countries.length ? `${countries.length} countries` : 'Tap to select';
    return `<button type="button" class="provider-card ${active ? 'is-active' : ''} ${down ? 'is-down' : ''}" data-number-provider="${esc(id)}" aria-pressed="${active}"><b><span class="provider-dot" aria-hidden="true"></span>${esc(label)}</b><small>${esc(note)}</small></button>`;
  }).join('');
  const chip = (field, value, label, checked) => `<label class="pick-chip" data-chip-label="${esc(String(label).toLowerCase())}"><input type="radio" name="${field}" value="${esc(value)}" data-number-filter="${field}" ${checked ? 'checked' : ''}><span>${esc(label)}</span></label>`;
  const countryChips = countries.map((item) => { const value = String(item.code || item.id || item); return chip('country', value, item.name || item.label || item.code || item, String(filters.country) === value); }).join('');
  const serviceChips = services.map((item) => { const value = String(item.id || item.code || item); return chip('service', value, item.name || item.label || item.code || item, String(filters.service) === value); }).join('');
  const countryName = (countries.find((item) => String(item.code || item.id || item) === String(filters.country)) || {}).name || '';
  const serviceName = (services.find((item) => String(item.id || item.code || item) === String(filters.service)) || {}).name || '';
  const loadingCatalog = state.numberLoading && !countries.length;
  const countryBody = loadingCatalog
    ? '<div class="chip-grid" aria-busy="true">' + Array.from({ length: 8 }, () => '<span class="skeleton" style="width:92px;height:38px;border-radius:999px"></span>').join('') + '</div>'
    : countries.length
      ? `<input class="chip-search" type="search" placeholder="Search countries" aria-label="Search countries" data-chip-search="country"><div class="chip-grid" role="radiogroup" aria-label="Country" data-chip-group="country">${countryChips}<span class="chip-empty" hidden>No country matches your search.</span></div>`
      : '<p class="chip-empty">No countries returned for this provider. Try another provider.</p>';
  const serviceBody = !filters.country
    ? '<p class="chip-empty">Choose a country first.</p>'
    : state.numberLoading && !services.length
      ? '<div class="chip-grid" aria-busy="true">' + Array.from({ length: 6 }, () => '<span class="skeleton" style="width:110px;height:38px;border-radius:999px"></span>').join('') + '</div>'
      : services.length
        ? `<input class="chip-search" type="search" placeholder="Search services" aria-label="Search services" data-chip-search="service"><div class="chip-grid" role="radiogroup" aria-label="Service" data-chip-group="service">${serviceChips}<span class="chip-empty" hidden>No service matches your search.</span></div>`
        : '<p class="chip-empty">No services returned for this country.</p>';
  const picker = `<div class="number-picker">
    <div class="picker-step"><div class="picker-step-head"><span class="picker-step-num">1</span><h3>Provider</h3></div><div class="provider-cards" role="group" aria-label="Choose number provider">${providerCards}</div></div>
    <div class="picker-step ${countries.length || loadingCatalog ? '' : 'is-locked'}"><div class="picker-step-head"><span class="picker-step-num">2</span><h3>Country</h3>${countryName ? `<span class="picker-selected">${esc(countryName)}</span>` : ''}</div>${countryBody}</div>
    <div class="picker-step ${filters.country ? '' : 'is-locked'}"><div class="picker-step-head"><span class="picker-step-num">3</span><h3>Service</h3>${serviceName ? `<span class="picker-selected">${esc(serviceName)}</span>` : ''}</div>${serviceBody}</div>
  </div>`;
  const error = state.numberError ? `<div class="preview-notice" role="alert">${icon('warning', 17)}<span>${esc(state.numberError)}</span><button class="link-button" data-action="numbers-retry">Retry</button></div>` : '';
  const catalog = state.numberLoading ? Array.from({ length: 3 }, () => '<div class="skeleton-card" aria-hidden="true"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div>').join('') : state.numberError ? '' : quotes.length ? quotes.map((quote) => `<article class="number-quote" data-unavailable="${quote.available === false ? 1 : 0}"><div class="number-quote-top"><span class="secure-pill">${icon('shield', 13)} ${esc(quote.providerLabel || quote.provider || 'Provider')}</span><span class="status-pill ${quote.available === false ? 'failed' : ''}">${quote.available === false ? 'Unavailable' : 'Available'}</span></div><h3>${esc(quote.name || `${quote.country || 'Number'} · ${quote.service || 'SMS'}`)}</h3><p>${esc(quote.country || 'Country not specified')} · ${esc(quote.service || 'Service')} · ${esc(quote.operator || 'Any operator')}</p><strong>${money(quote.priceMinor, quote.currency || 'NGN')}</strong><button class="button button-small" data-action="number-order" data-quote-id="${esc(quote.id)}" ${quote.available === false ? 'disabled' : ''}>Request this number ${icon('arrow', 14)}</button></article>`).join('') : `<div class="empty-state"><span>${icon('phone', 24)}</span><b>No configured quotes</b><p>The selected provider returned no current quotes. Try another selection or check provider configuration.</p></div>`;
  return accountShell('numbers', `${pageHeading('VIRTUAL NUMBERS', 'Choose a number', 'Compare current quotes from your configured providers.')}<section class="panel numbers-toolbar">${picker}</section>${error}<section class="number-quote-grid">${catalog}</section>`);
}

export function renderNumberOrderPage({ state, pageHeading, accountShell, icon }) {
  const item = state.numberOrder;
  const session = item?.session || {};
  const status = String(item?.state || item?.status || 'PROCESSING').toUpperCase();
  const terminal = ['COMPLETED', 'CANCELLED', 'CANCELED', 'FAILED', 'FINISHED', 'REFUNDED'].includes(status);
  const provider = item?.providerLabel || item?.provider || 'Number provider';
  const phone = session.phone || session.number || '';
  const country = session.country || item?.country || item?.requestPayload?.country || '';
  const service = session.serviceName || session.service || item?.service || item?.requestPayload?.service || '';
  const operator = session.operator || item?.operator || item?.requestPayload?.operator || '';
  const messages = Array.isArray(session.messages) ? session.messages : [];
  const code = session.code || messages.find((message) => message?.code)?.code || '';
  const amount = item?.amountMinor ?? item?.retailMinor ?? null;
  const currency = item?.currency || 'NGN';
  const hasReference = item?.providerRefSaved === true || Boolean(session.id);
  const reconciliationMessage = item?.reconciliationMessage || (status === 'RECONCILIATION'
    ? (hasReference ? 'The provider outcome is still being checked. Refresh the status before taking another action.' : 'The provider activation reference was not saved. The system cannot query this activation automatically, and placing another order could create a duplicate charge.')
    : '');
  if (!state.user) return accountShell('numbers', `${pageHeading('NUMBER ORDER', 'Order status', 'Sign in to view a private number order.')}<section class="panel"><div class="empty-state"><span>${icon('user', 24)}</span><b>Sign in required</b><p>Number sessions are never shown to a signed-out visitor.</p></div></section>`);
  if (state.numberOrderLoading) return accountShell('numbers', `${pageHeading('NUMBER ORDER', 'Order status', 'Requesting the latest server-confirmed state.')}<section class="panel"><div class="empty-state"><span>${icon('clock', 24)}</span><b>Loading order…</b></div></section>`);
  if (state.numberError && !item) return accountShell('numbers', `${pageHeading('NUMBER ORDER', 'Order unavailable', 'The order could not be loaded.')}<div class="preview-notice" role="alert">${icon('warning', 17)}<span>${esc(state.numberError)}</span><button class="link-button" data-action="number-refresh">Retry</button></div>`);

  const messageList = messages.length ? `<section class="number-sms-section"><div class="number-section-heading"><div><span class="eyebrow">INCOMING MESSAGES</span><h3>SMS inbox</h3></div><span class="muted-caption">${messages.length} message${messages.length === 1 ? '' : 's'}</span></div><div class="number-sms-list">${messages.map((message) => `<article class="number-sms-message"><div class="number-sms-message-top"><b>${esc(message.sender || 'Provider message')}</b><time>${esc(dateLabel(message.createdAt || message.date))}</time></div><p>${esc(message.text || message.body || 'Message received')}</p>${message.code ? `<strong class="number-sms-code">${esc(message.code)}</strong>` : ''}</article>`).join('')}</div></section>` : '';
  const noPhone = !phone ? `<div class="number-assignment-state ${statusTone(status)}"><span class="number-assignment-icon">${icon('phone', 23)}</span><div><b>${status === 'RECONCILIATION' ? 'Phone number not confirmed' : 'Waiting for phone assignment'}</b><p>${esc(reconciliationMessage || 'The provider has not returned a phone number yet. Refresh the status to check for an update.')}</p></div></div>` : `<div class="number-assigned-phone"><span class="eyebrow">YOUR ASSIGNED NUMBER</span><strong>${esc(phone)}</strong><small>${esc(country || 'Country unavailable')}${service ? ` · ${esc(service)}` : ''}</small><button class="button button-outline button-small" data-action="number-copy" data-copy-value="${esc(phone)}" data-copy-label="Phone number">Copy number</button></div>`;
  const statusCheck = item?.statusCheck === 'UNAVAILABLE' ? `<p class="number-status-note" role="status">The provider could not be reached during the last refresh. Your order has not been cancelled or retried.</p>` : '';
  const actionButtons = `<button class="button button-outline" data-action="number-refresh" ${state.numberOrderRefreshing ? 'disabled' : ''}>${state.numberOrderRefreshing ? 'Refreshing…' : 'Refresh status'}</button>${!terminal && item?.canFinish === true ? `<button class="button button-outline" data-action="number-finish">Finish</button>` : ''}${!terminal && item?.canCancel === true ? `<button class="button button-outline danger-outline" data-action="number-cancel">Cancel</button>` : ''}<a class="button button-outline" href="/numbers" data-link>Choose another</a>`;
  return accountShell('numbers', `${pageHeading('VIRTUAL NUMBER ORDER', 'Number order details', 'A dedicated activation view for your virtual number and incoming SMS.')}<section class="panel number-order-card number-order-detail"><div class="number-order-heading"><div><span class="eyebrow">VIRTUAL NUMBER ORDER</span><h2>${esc(item?.orderId || item?.id || 'Order')}</h2><p>${esc(provider)}${country ? ` · ${esc(country)}` : ''}</p></div><span class="status-pill ${statusTone(status)}">${esc(status.replaceAll('_', ' '))}</span></div><div class="number-order-facts"><div><span>Service</span><b>${esc(service || 'Not available')}</b></div><div><span>Country</span><b>${esc(country || 'Not available')}</b></div><div><span>Operator</span><b>${esc(operator || 'Any operator')}</b></div><div><span>Activation reference</span><b>${hasReference ? 'Saved securely' : 'Not saved'}</b></div>${amount !== null ? `<div><span>Amount paid</span><b>${money(amount, currency)}</b></div>` : ''}</div>${noPhone}${code ? `<div class="number-code-panel"><span class="eyebrow">SMS VERIFICATION CODE</span><strong>${esc(code)}</strong><button class="button button-outline button-small" data-action="number-copy" data-copy-value="${esc(code)}" data-copy-label="Verification code">Copy code</button><small>Only the signed-in order owner can view this code.</small></div>` : `<p class="muted-caption number-no-code">${messages.length ? 'No verification code has been identified in the messages yet.' : 'No SMS has arrived yet.'}</p>`}${messageList}${statusCheck}${status === 'RECONCILIATION' && !hasReference ? `<div class="number-reconciliation-help" role="alert"><b>Manual reconciliation is required</b><p>Do not place the same order again yet. Support needs to match this order with the provider's activation record before it can be safely completed or refunded.</p><span>Keep this order reference: <strong>${esc(item?.orderId || item?.id || '')}</strong></span></div>` : ''}<div class="detail-actions number-order-actions">${actionButtons}</div>${state.numberError ? `<p class="form-feedback" role="alert">${esc(state.numberError)}</p>` : ''}</section>`);
}

// Client-side filtering for the country and service chips. Typing never re-renders the page.
if (typeof document !== 'undefined' && !window.__chipSearchBound) {
  window.__chipSearchBound = true;
  document.addEventListener('input', (event) => {
    const input = event.target.closest?.('[data-chip-search]');
    if (!input) return;
    const group = document.querySelector(`[data-chip-group="${input.dataset.chipSearch}"]`);
    if (!group) return;
    const term = input.value.trim().toLowerCase();
    let shown = 0;
    group.querySelectorAll('[data-chip-label]').forEach((el) => {
      const match = !term || el.dataset.chipLabel.includes(term);
      el.hidden = !match;
      if (match) shown += 1;
    });
    const empty = group.querySelector('.chip-empty');
    if (empty) empty.hidden = shown > 0;
  });
}
