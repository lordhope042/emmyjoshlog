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
  // The server reports which provider actually served the catalog (it falls back to the first
  // ready provider when the requested one is not configured). Show that one as active so the
  // highlighted card always matches the data on screen.
  const activeProvider = String(result?.provider ?? filters.provider ?? '');
  const providerChoices = providers.length ? providers : [{ id: '1', label: 'Provider 1' }, { id: '2', label: 'Provider 2' }];
  const providerCards = providerChoices.map((provider) => {
    const id = String(provider.id ?? provider.provider ?? '');
    const label = provider.label || provider.providerLabel || provider.name || `Provider ${id}`;
    const active = activeProvider === id;
    const down = provider.available === false || provider.status === 'DOWN';
    const note = down ? 'Currently unavailable' : active && countries.length ? `${countries.length} countries` : 'Tap to select';
    return `<button type="button" class="provider-card ${active ? 'is-active' : ''} ${down ? 'is-down' : ''}" data-number-provider="${esc(id)}" aria-pressed="${active}"><b><span class="provider-dot" aria-hidden="true"></span>${esc(label)}</b><small>${esc(note)}</small></button>`;
  }).join('');

  // Country and service are picked from a modal list. The rows are still radio inputs with
  // data-number-filter, so the existing change handler keeps working unchanged.
  const row = (field, value, label, checked) => `<label class="pick-row" data-chip-label="${esc(String(label).toLowerCase())}"><input type="radio" name="${field}" value="${esc(value)}" data-number-filter="${field}" ${checked ? 'checked' : ''}><span class="pick-row-label">${esc(label)}</span><span class="pick-row-check" aria-hidden="true"></span></label>`;
  const countryRows = countries.map((item) => { const value = String(item.code || item.id || item); return row('country', value, item.name || item.label || item.code || item, String(filters.country) === value); }).join('');
  const serviceRows = services.map((item) => { const value = String(item.id || item.code || item); return row('service', value, item.name || item.label || item.code || item, String(filters.service) === value); }).join('');
  const countryName = (countries.find((item) => String(item.code || item.id || item) === String(filters.country)) || {}).name || '';
  const serviceName = (services.find((item) => String(item.id || item.code || item) === String(filters.service)) || {}).name || '';
  const loadingCatalog = state.numberLoading && !countries.length;

  const trigger = (kind, label, selectedName, disabled, hint) => `<button type="button" class="picker-trigger ${selectedName ? 'has-value' : ''}" data-open-picker="${kind}" aria-haspopup="dialog" ${disabled ? 'disabled' : ''}><span class="picker-trigger-text"><small>${esc(label)}</small><b>${esc(selectedName || hint)}</b></span><span class="picker-trigger-chevron" aria-hidden="true">${icon('arrow', 14)}</span></button>`;
  const modal = (kind, title, rowsHtml, emptyText, placeholder, count) => `<dialog class="picker-modal" id="picker-${kind}" aria-label="${esc(title)}"><div class="picker-modal-card"><header class="picker-modal-head"><div><h3>${esc(title)}</h3><small>${count} available</small></div><button type="button" class="picker-modal-close" data-close-picker aria-label="Close">&times;</button></header><input class="chip-search" type="search" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}" data-chip-search="${kind}"><div class="picker-list" role="radiogroup" aria-label="${esc(title)}" data-chip-group="${kind}">${rowsHtml}<span class="chip-empty" hidden>${esc(emptyText)}</span></div></div></dialog>`;

  const countryBody = loadingCatalog
    ? trigger('country', 'Country', '', true, 'Loading countries…')
    : countries.length
      ? trigger('country', 'Country', countryName, Boolean(state.numberLoading), 'Select a country') + modal('country', 'Select a country', countryRows, 'No country matches your search.', 'Search countries', countries.length)
      : '<p class="chip-empty">No countries returned for this provider. Try another provider.</p>';
  const serviceBody = !filters.country
    ? trigger('service', 'Service', '', true, 'Choose a country first')
    : state.numberLoading && !services.length
      ? trigger('service', 'Service', '', true, 'Loading services…')
      : services.length
        ? trigger('service', 'Service', serviceName, Boolean(state.numberLoading), 'Select a service') + modal('service', 'Select a service', serviceRows, 'No service matches your search.', 'Search services', services.length)
        : '<p class="chip-empty">No services returned for this country.</p>';
  const picker = `<div class="number-picker">
    <div class="picker-step"><div class="picker-step-head"><span class="picker-step-num">1</span><h3>Provider</h3></div><div class="provider-cards" role="group" aria-label="Choose number provider">${providerCards}</div></div>
    <div class="picker-step ${countries.length || loadingCatalog ? '' : 'is-locked'}"><div class="picker-step-head"><span class="picker-step-num">2</span><h3>Country</h3></div>${countryBody}</div>
    <div class="picker-step ${filters.country ? '' : 'is-locked'}"><div class="picker-step-head"><span class="picker-step-num">3</span><h3>Service</h3></div>${serviceBody}</div>
  </div>`;
  const error = state.numberError ? `<div class="preview-notice" role="alert">${icon('warning', 17)}<span>${esc(state.numberError)}</span><button class="link-button" data-action="numbers-retry">Retry</button></div>` : '';

  // Prices are only fetched once a country AND a service are chosen, so an empty quote list
  // before that is expected, not an error. Say what to do next instead of "no quotes".
  const emptyQuotes = !filters.country
    ? `<div class="empty-state"><span>${icon('phone', 24)}</span><b>Choose a country</b><p>Pick a provider and a country, then a service, to see current prices.</p></div>`
    : !filters.service
      ? `<div class="empty-state"><span>${icon('phone', 24)}</span><b>Choose a service</b><p>Select a service above to see current prices for ${esc(countryName || 'this country')}.</p></div>`
      : `<div class="empty-state"><span>${icon('phone', 24)}</span><b>No quotes in stock</b><p>The provider has no numbers in stock for this country and service right now. Try another service or country.</p></div>`;
  const catalog = state.numberLoading
    ? Array.from({ length: 3 }, () => '<div class="skeleton-card" aria-hidden="true"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div>').join('')
    : state.numberError
      ? ''
      : quotes.length
        ? quotes.map((quote) => `<article class="number-quote" data-unavailable="${quote.available === false ? 1 : 0}"><div class="number-quote-top"><span class="secure-pill">${icon('shield', 13)} ${esc(quote.providerLabel || quote.provider || 'Provider')}</span><span class="status-pill ${quote.available === false ? 'failed' : ''}">${quote.available === false ? 'Unavailable' : 'Available'}</span></div><h3>${esc(quote.name || `${quote.country || 'Number'} · ${quote.service || 'SMS'}`)}</h3><p>${esc(quote.country || 'Country not specified')} · ${esc(quote.service || 'Service')} · ${esc(quote.operator || 'Any operator')}</p><strong>${money(quote.priceMinor, quote.currency || 'NGN')}</strong><button class="button button-small" data-action="number-order" data-quote-id="${esc(quote.id)}" ${quote.available === false ? 'disabled' : ''}>Request this number ${icon('arrow', 14)}</button></article>`).join('')
        : emptyQuotes;
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

// Styles for the picker modal. Injected once so no separate stylesheet change is needed.
// Colours fall back to system colours, so it adapts to light and dark themes.
const PICKER_CSS = `
.picker-trigger{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;padding:12px 14px;border:1px solid rgba(128,128,128,.4);border-radius:12px;background:var(--surface,Canvas);color:var(--text,CanvasText);font:inherit;text-align:left;cursor:pointer}
.picker-trigger:hover:not(:disabled){border-color:currentColor}
.picker-trigger:disabled{opacity:.55;cursor:not-allowed}
.picker-trigger-text{display:flex;flex-direction:column;min-width:0}
.picker-trigger-text small{opacity:.65;font-size:.75rem}
.picker-trigger-text b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.picker-trigger:not(.has-value) b{font-weight:500;opacity:.75}
.picker-trigger-chevron{display:inline-flex;transform:rotate(90deg);opacity:.7}
.picker-modal{border:0;padding:0;border-radius:16px;width:min(520px,calc(100vw - 24px));max-width:none;max-height:min(80vh,640px);background:var(--surface,Canvas);color:var(--text,CanvasText);box-shadow:0 20px 60px rgba(0,0,0,.35);overflow:hidden}
.picker-modal::backdrop{background:rgba(0,0,0,.55)}
.picker-modal-card{display:flex;flex-direction:column;max-height:min(80vh,640px)}
.picker-modal-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 16px 10px}
.picker-modal-head h3{margin:0;font-size:1.05rem}
.picker-modal-head small{opacity:.65}
.picker-modal-close{border:0;background:transparent;color:inherit;font-size:1.6rem;line-height:1;width:36px;height:36px;border-radius:50%;cursor:pointer}
.picker-modal-close:hover{background:rgba(128,128,128,.18)}
.picker-modal .chip-search{margin:0 16px 8px;width:calc(100% - 32px);padding:10px 12px;border:1px solid rgba(128,128,128,.4);border-radius:10px;background:transparent;color:inherit;font:inherit;box-sizing:border-box}
.picker-list{overflow-y:auto;flex:1;min-height:0;padding-bottom:8px}
.pick-row{position:relative;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 16px;cursor:pointer;border-top:1px solid rgba(128,128,128,.15)}
.pick-row[hidden]{display:none}
.pick-row input{position:absolute;opacity:0;pointer-events:none}
.pick-row:hover{background:rgba(128,128,128,.12)}
.pick-row:has(input:checked){background:rgba(80,120,255,.14);font-weight:600}
.pick-row:has(input:focus-visible){outline:2px solid currentColor;outline-offset:-2px}
.pick-row input:checked ~ .pick-row-check::after{content:'\\2713'}
.picker-list .chip-empty{display:block;padding:20px 16px;opacity:.7}
.picker-list .chip-empty[hidden]{display:none}
@media (max-width:600px){
  .picker-modal{margin:auto 0 0 0;width:100%;max-height:85vh;border-radius:16px 16px 0 0}
  .picker-modal-card{max-height:85vh}
}
`;

if (typeof document !== 'undefined' && !window.__pickerModalBound) {
  window.__pickerModalBound = true;
  const style = document.createElement('style');
  style.id = 'picker-modal-styles';
  style.textContent = PICKER_CSS;
  document.head.appendChild(style);

  document.addEventListener('click', (event) => {
    const opener = event.target.closest?.('[data-open-picker]');
    if (opener) {
      if (opener.disabled) return;
      const dialog = document.getElementById(`picker-${opener.dataset.openPicker}`);
      if (dialog && typeof dialog.showModal === 'function' && !dialog.open) {
        const search = dialog.querySelector('[data-chip-search]');
        if (search) { search.value = ''; search.dispatchEvent(new Event('input', { bubbles: true })); }
        dialog.showModal();
        // Bring the current choice into view; only auto-focus search where there is no on-screen keyboard.
        dialog.querySelector('input:checked')?.closest('label')?.scrollIntoView({ block: 'center' });
        if (search && window.matchMedia?.('(pointer: fine)').matches) search.focus();
      }
      return;
    }
    const closer = event.target.closest?.('[data-close-picker]');
    if (closer) { closer.closest('dialog')?.close(); return; }
    // A click on the dimmed backdrop targets the dialog element itself.
    if (event.target.matches?.('dialog.picker-modal')) { event.target.close(); return; }
    // Picking a row closes the modal (also covers tapping the row that is already selected).
    const choice = event.target.closest?.('.picker-modal .pick-row');
    if (choice) {
      const dialog = choice.closest('dialog');
      setTimeout(() => { try { dialog?.close(); } catch { /* already closed or removed by a re-render */ } }, 0);
    }
  });
}

// Client-side filtering for the country and service lists. Typing never re-renders the page.
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