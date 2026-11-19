// Shared UI helpers: styled confirmation dialog and button busy state.
// Replaces window.confirm so confirmations match the brand and work on mobile.

let openDialog = null;

export function confirmDialog(message, options = {}) {
  const {
    title = 'Please confirm',
    confirmLabel = 'Continue',
    cancelLabel = 'Cancel',
    tone = 'default',
  } = options;

  if (openDialog) openDialog.close(false);

  return new Promise((resolve) => {
    const previous = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'ds-overlay';
    overlay.innerHTML = `
      <div class="ds-dialog" role="alertdialog" aria-modal="true" aria-labelledby="ds-dialog-title" aria-describedby="ds-dialog-text">
        <h2 id="ds-dialog-title"></h2>
        <p id="ds-dialog-text"></p>
        <div class="ds-dialog-actions">
          <button type="button" class="button button-outline button-small" data-ds="cancel"></button>
          <button type="button" class="button button-small ${tone === 'danger' ? 'ds-danger' : ''}" data-ds="ok"></button>
        </div>
      </div>`;
    overlay.querySelector('#ds-dialog-title').textContent = title;
    overlay.querySelector('#ds-dialog-text').textContent = message;
    overlay.querySelector('[data-ds="cancel"]').textContent = cancelLabel;
    overlay.querySelector('[data-ds="ok"]').textContent = confirmLabel;

    function close(result) {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      openDialog = null;
      if (previous && typeof previous.focus === 'function') previous.focus();
      resolve(result);
    }
    function onKey(event) {
      if (event.key === 'Escape') { event.preventDefault(); close(false); }
      if (event.key === 'Tab') {
        const items = [...overlay.querySelectorAll('button')];
        const first = items[0]; const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close(false);
      const action = event.target.closest('[data-ds]')?.dataset.ds;
      if (action === 'ok') close(true);
      if (action === 'cancel') close(false);
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    openDialog = { close };
    overlay.querySelector('[data-ds="ok"]').focus();
  });
}

// Dialog with a required text field. Resolves to the trimmed text, or null if cancelled.
export function promptDialog(message, options = {}) {
  const { title = 'Enter details', label = 'Reason', defaultValue = '', confirmLabel = 'Submit', cancelLabel = 'Cancel', tone = 'default', required = true, maxLength = 300 } = options;
  if (openDialog) openDialog.close(false);
  return new Promise((resolve) => {
    const previous = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'ds-overlay';
    overlay.innerHTML = `<div class="ds-dialog" role="dialog" aria-modal="true" aria-labelledby="ds-dialog-title" aria-describedby="ds-dialog-text">
      <h2 id="ds-dialog-title"></h2><p id="ds-dialog-text"></p>
      <label class="ds-field"><span></span><textarea rows="3"></textarea><small class="ds-error" hidden></small></label>
      <div class="ds-dialog-actions"><button type="button" class="button button-outline button-small" data-ds="cancel"></button><button type="button" class="button button-small ${tone === 'danger' ? 'ds-danger' : ''}" data-ds="ok"></button></div></div>`;
    overlay.querySelector('#ds-dialog-title').textContent = title;
    overlay.querySelector('#ds-dialog-text').textContent = message;
    overlay.querySelector('.ds-field span').textContent = label;
    const field = overlay.querySelector('textarea');
    field.value = defaultValue; field.maxLength = maxLength;
    overlay.querySelector('[data-ds="cancel"]').textContent = cancelLabel;
    overlay.querySelector('[data-ds="ok"]').textContent = confirmLabel;
    const error = overlay.querySelector('.ds-error');
    function close(result) {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove(); openDialog = null;
      if (previous && typeof previous.focus === 'function') previous.focus();
      resolve(result);
    }
    function submit() {
      const value = field.value.trim();
      if (required && !value) { error.textContent = `${label} is required.`; error.hidden = false; field.focus(); return; }
      close(value);
    }
    function onKey(event) {
      if (event.key === 'Escape') { event.preventDefault(); close(null); }
      if (event.key === 'Tab') {
        const items = [...overlay.querySelectorAll('textarea, button')];
        const first = items[0]; const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close(null);
      const action = event.target.closest('[data-ds]')?.dataset.ds;
      if (action === 'ok') submit();
      if (action === 'cancel') close(null);
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    openDialog = { close: () => close(null) };
    field.focus(); field.select();
  });
}

// Disables a button and shows a spinner while an async task runs. Prevents double submits.
export async function withBusy(button, task) {
  if (!button || button.dataset.busy === '1') return undefined;
  button.dataset.busy = '1';
  button.disabled = true;
  button.classList.add('is-busy');
  try { return await task(); }
  finally {
    delete button.dataset.busy;
    if (button.isConnected) { button.disabled = false; button.classList.remove('is-busy'); }
  }
}

// Hero search button: reuses the existing Enter-key search handler on the input.
// Live estimated total on the product page. The server still recalculates price at checkout.
if (typeof document !== 'undefined' && !window.__uiDelegatesBound) {
  window.__uiDelegatesBound = true;
  document.addEventListener('click', (event) => {
    const go = event.target.closest?.('[data-hero-search-go]');
    if (go) {
      const input = go.parentElement?.querySelector('input');
      if (input) input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    }
    if (event.target.closest?.('.detail-quantity')) setTimeout(updateTotal, 0);
  });
  document.addEventListener('input', (event) => { if (event.target.id === 'quantity') updateTotal(); });
}

function updateTotal() {
  const box = document.querySelector('[data-unit-price]');
  const input = document.getElementById('quantity');
  const out = document.querySelector('[data-total-value]');
  if (!box || !input || !out) return;
  const unit = Number(box.dataset.unitPrice) || 0;
  const qty = Math.max(1, Math.floor(Number(input.value) || 1));
  out.textContent = `₦${(unit * qty).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
