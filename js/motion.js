// Emmyjosh Logs motion layer.
// One self-contained module: it injects its own CSS and animates the app by watching #app, so no page
// code has to change. Import it once at the top of app.js:  import './motion.js';
//
// What it does
//   - Route change: thin orange progress bar + staggered rise-in of cards, panels, metrics and table rows
//   - Metric numbers count up (₦ amounts, totals) the first time a page appears
//   - Below-the-fold cards reveal as you scroll to them
//   - Hover lift on cards, press feedback on buttons, toast and dialog pop-in
//
// What it deliberately does NOT do
//   - Re-animate on every re-render (typing in a search box, toggling a filter): animations only run
//     right after a route change or right after a loading state finishes
//   - Touch the landing page, which has its own reveal system (.lp-anim)
//   - Run at all when the visitor has "reduce motion" turned on

const TARGETS = [
  '.panel', '.metric-card', '.ej-admin-metric', '.ej-admin-panel', '.product-card',
  '.ej-admin-quick-card', '.wallet-balance-card', '.notification-item', '.transaction-row',
  '.ej-admin-table tbody tr',
].join(',');

const COUNTERS = '.metric-card strong, .ej-admin-metric strong, .wallet-balance-card strong';

// Splits "₦1,845,000.50" into a prefix, the number, and a suffix so it can be animated and re-formatted.
export function parseCount(raw) {
  const match = String(raw).match(/-?\d[\d,]*(\.\d+)?/);
  if (!match) return null;
  const numStr = match[0];
  const target = parseFloat(numStr.replace(/,/g, ''));
  if (!Number.isFinite(target) || target === 0) return null;
  const decimals = (numStr.split('.')[1] || '').length;
  const commas = numStr.includes(',');
  const pre = raw.slice(0, match.index);
  const post = raw.slice(match.index + numStr.length);
  const format = (value) => {
    let text = value.toFixed(decimals);
    if (commas) {
      const [whole, frac] = text.split('.');
      text = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac ? `.${frac}` : '');
    }
    return pre + text + post;
  };
  return { target, format };
}

const CSS = `
@media (prefers-reduced-motion: no-preference) {
  @keyframes ejm-rise { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
  @keyframes ejm-pop { from { opacity: 0; transform: translateY(10px) scale(.96); } to { opacity: 1; transform: none; } }
  @keyframes ejm-bar { 0% { transform: scaleX(0); opacity: 1; } 70% { transform: scaleX(.88); opacity: 1; } 100% { transform: scaleX(1); opacity: 0; } }

  /* 'backwards' (not 'both') so the end state is not pinned and hover transforms still work afterwards */
  .ejm-in { animation: ejm-rise .55s cubic-bezier(.2,.7,.2,1) var(--ejm-d, 0ms) backwards; }
  .ejm-pre { opacity: 0; transform: translateY(18px); }

  #ejm-bar { position: fixed; top: 0; left: 0; right: 0; height: 3px; z-index: 9999; background: var(--o, #e8650a);
    transform: scaleX(0); transform-origin: left; opacity: 0; pointer-events: none; }
  #ejm-bar.run { animation: ejm-bar .7s cubic-bezier(.25,.8,.3,1) forwards; }

  .product-card, .ej-admin-quick-card, .metric-card, .ej-admin-metric {
    transition: transform .25s cubic-bezier(.2,.7,.2,1), box-shadow .25s ease;
  }
  @media (hover: hover) {
    .product-card:hover, .ej-admin-quick-card:hover, .metric-card:hover, .ej-admin-metric:hover {
      transform: translateY(-3px); box-shadow: 0 12px 26px rgba(23,17,13,.10);
    }
  }
  button:not(:disabled):active, .button:active, a.button:active { transform: scale(.97); }

  .toast { animation: ejm-pop .4s cubic-bezier(.2,.9,.3,1.15) backwards; }
  [role="dialog"], dialog[open] { animation: ejm-pop .28s cubic-bezier(.2,.9,.3,1.1) backwards; }
}
`;

function init() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const root = document.querySelector('#app') || document.body;
  const style = document.createElement('style');
  style.id = 'ejm-style';
  style.textContent = CSS;
  document.head.appendChild(style);

  const bar = document.createElement('div');
  bar.id = 'ejm-bar';
  bar.setAttribute('aria-hidden', 'true');
  document.body.appendChild(bar);
  const runBar = () => { bar.classList.remove('run'); void bar.offsetWidth; bar.classList.add('run'); };

  // Animations only run inside a short window opened by a route change or the end of a loading state.
  let windowUntil = 0;
  let lastPath = location.pathname;
  const openWindow = (ms) => { windowUntil = performance.now() + ms; };
  openWindow(1400);

  const reveal = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        reveal.unobserve(el);
        el.classList.remove('ejm-pre');
        el.classList.add('ejm-in');
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 })
    : null;

  function countUp(el, delay) {
    const node = el.firstChild;
    if (!node || node.nodeType !== 3 || el.childNodes.length !== 1) return;
    const raw = node.nodeValue;
    const parsed = parseCount(raw);
    if (!parsed) return;
    const start = performance.now() + delay;
    const duration = 900;
    node.nodeValue = parsed.format(0);
    const tick = (now) => {
      const p = Math.min(1, Math.max(0, (now - start) / duration));
      node.nodeValue = p >= 1 ? raw : parsed.format(parsed.target * (1 - (1 - p) ** 3));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function animate(elements) {
    let index = 0;
    elements.forEach((el) => {
      if (el.dataset.ejm || el.closest('.lp-anim')) return;
      el.dataset.ejm = '1';
      const isRow = el.matches('tbody tr');
      const delay = isRow ? Math.min(index, 12) * 28 : Math.min(index, 14) * 55;
      index += 1;
      el.style.setProperty('--ejm-d', `${delay}ms`);
      const below = reveal && el.getBoundingClientRect().top > window.innerHeight * 0.95;
      if (below) {
        el.classList.add('ejm-pre');
        reveal.observe(el);
      } else {
        el.classList.add('ejm-in');
      }
      el.querySelectorAll(COUNTERS).forEach((counter) => countUp(counter, delay));
      if (el.matches(COUNTERS)) countUp(el, delay);
    });
  }

  const observer = new MutationObserver((mutations) => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      openWindow(1000);
      runBar();
    }
    for (const mutation of mutations) {
      for (const node of mutation.removedNodes) {
        if (node.nodeType === 1 && (node.matches('[aria-busy="true"]') || node.querySelector('[aria-busy="true"]'))) openWindow(900);
      }
    }
    if (performance.now() > windowUntil) return;

    const fresh = [];
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches(TARGETS)) fresh.push(node);
        node.querySelectorAll(TARGETS).forEach((el) => fresh.push(el));
      }
    }
    if (fresh.length) animate(fresh);
  });
  observer.observe(root, { childList: true, subtree: true });

  // First paint of the page that is already on screen.
  animate([...root.querySelectorAll(TARGETS)]);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
}
