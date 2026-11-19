const LOGO = '/manus-storage/emmyjosh-logo-original-crop_1be053b9.png';
let pending = 0;
let overlay = null;

function ensureOverlay() {
  if (overlay?.isConnected) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'emmyjosh-loading';
  overlay.className = 'ej-loading-overlay';
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');
  overlay.setAttribute('aria-label', 'Loading');
  overlay.innerHTML = `<div class="ej-loading-card"><img src="${LOGO}" alt="" width="56" height="32"><span class="ej-loading-rings" aria-hidden="true"><i></i><i></i><i></i></span><span class="ej-loading-label">Loading verified data…</span></div>`;
  (document.body || document.documentElement).appendChild(overlay);
  return overlay;
}

function paint(label) {
  const node = ensureOverlay();
  node.classList.toggle('is-visible', pending > 0);
  node.setAttribute('aria-busy', pending > 0 ? 'true' : 'false');
  const labelNode = node.querySelector('.ej-loading-label');
  if (labelNode && label) labelNode.textContent = label;
}

export function beginLoading(label = 'Loading verified data…') {
  pending += 1;
  paint(label);
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    pending = Math.max(0, pending - 1);
    paint();
  };
}

export async function withLoading(task, label) {
  const end = beginLoading(label);
  try { return await task(); }
  finally { end(); }
}

export function loadingCount() { return pending; }
