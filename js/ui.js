// Shared UI helpers: styled confirmation dialog and button busy state.
// Replaces window.confirm so confirmations match the brand and work on mobile.

let openDialog = null;

// Brand styling for the dialogs, matched to the landing page. Injected once so no CSS file needs editing.
// Selectors are scoped under .ds-overlay so they win over any older .ds-* rules in the stylesheets.
const DIALOG_CSS = `
.ds-overlay{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:20px;background:rgba(23,17,13,.5);-webkit-backdrop-filter:blur(5px);backdrop-filter:blur(5px);animation:ds-fade .18s ease-out both}
.ds-overlay .ds-dialog{box-sizing:border-box;width:min(440px,100%);max-height:calc(100vh - 40px);overflow:auto;padding:28px;border-radius:22px;border:1px solid #f0e3d4;background:#faf5ee;color:#17110d;box-shadow:0 40px 90px -30px rgba(70,20,0,.6);animation:ds-pop .26s cubic-bezier(.2,.8,.2,1) both}
.ds-overlay .ds-dialog h2{margin:0 0 8px;font-size:1.35rem;line-height:1.2;letter-spacing:-.02em;font-weight:500;color:#17110d}
.ds-overlay .ds-dialog p{margin:0 0 22px;color:#6e6055;line-height:1.55}
.ds-overlay .ds-field{display:grid;gap:6px;margin:0 0 22px;font-size:.875rem;font-weight:600;color:#17110d}
.ds-overlay .ds-field textarea{box-sizing:border-box;width:100%;padding:12px 14px;border-radius:14px;border:1.5px solid #f0e3d4;background:#fff;color:#17110d;font:inherit;font-weight:400;resize:vertical;transition:border-color .2s ease,box-shadow .2s ease}
.ds-overlay .ds-field textarea:focus{outline:none;border-color:#e8650a;box-shadow:0 0 0 4px rgba(232,101,10,.16)}
.ds-overlay .ds-error{color:#b3340a;font-weight:500}
.ds-overlay .ds-dialog-actions{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:10px}
.ds-overlay .ds-dialog-actions .button{display:inline-flex;align-items:center;justify-content:center;padding:11px 24px;border-radius:999px;border:1.5px solid #e8650a;background:#e8650a;color:#fff;font:inherit;font-weight:600;text-decoration:none;cursor:pointer;transition:transform .2s ease,background .2s ease,color .2s ease,border-color .2s ease}
.ds-overlay .ds-dialog-actions .button:hover{transform:translateY(-2px);background:#d4570a;border-color:#d4570a}
.ds-overlay .ds-dialog-actions .button.button-outline{background:transparent;border-color:#17110d;color:#17110d}
.ds-overlay .ds-dialog-actions .button.button-outline:hover{background:#17110d;border-color:#17110d;color:#fff}
.ds-overlay .ds-dialog-actions .button.ds-danger{background:#b3340a;border-color:#b3340a;color:#fff}
.ds-overlay .ds-dialog-actions .button.ds-danger:hover{background:#962b08;border-color:#962b08}
.ds-overlay .ds-dialog-actions .button:focus-visible{outline:3px solid #e8650a;outline-offset:3px}
.button.is-busy{position:relative;color:transparent!important;pointer-events:none}
.button.is-busy::after{content:"";position:absolute;inset:0;margin:auto;width:16px;height:16px;border-radius:50%;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;animation:ds-spin .7s linear infinite}
.button.button-outline.is-busy::after{border-color:rgba(23,17,13,.25);border-top-color:#17110d}
@keyframes ds-fade{from{opacity:0}to{opacity:1}}
@keyframes ds-pop{from{opacity:0;transform:translateY(14px) scale(.97)}to{opacity:1;transform:none}}
@keyframes ds-spin{to{transform:rotate(360deg)}}
@media (max-width:480px){
  .ds-overlay{align-items:end;padding:12px}
  .ds-overlay .ds-dialog{padding:22px}
  .ds-overlay .ds-dialog-actions{flex-direction:column-reverse}
  .ds-overlay .ds-dialog-actions .button{width:100%}
}
@media (prefers-reduced-motion:reduce){
  .ds-overlay,.ds-overlay .ds-dialog,.ds-overlay .ds-dialog-actions .button{animation:none!important;transition:none!important}
}
`;

function ensureDialogStyles() {
  if (typeof document === 'undefined' || document.getElementById('ds-dialog-styles')) return;
  const style = document.createElement('style');
  style.id = 'ds-dialog-styles';
  style.textContent = DIALOG_CSS;
  document.head.appendChild(style);
}

export function confirmDialog(message, options = {}) {
  const {
    title = 'Please confirm',
    confirmLabel = 'Continue',
    cancelLabel = 'Cancel',
    tone = 'default',
  } = options;

  if (openDialog) openDialog.close(false);
  ensureDialogStyles();

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
  ensureDialogStyles();
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