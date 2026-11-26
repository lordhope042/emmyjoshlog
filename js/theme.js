// Emmyjosh Logs typography layer.
// Loads the brand fonts and applies them across the app, injected from JS so no CSS file needs editing.
//   Headings  : Bricolage Grotesque (warm, confident, great at large sizes)
//   Body / UI : Plus Jakarta Sans   (clean and very readable on small phone screens)
//   Secrets   : JetBrains Mono      (log credentials, codes, ids)
// If Google Fonts is blocked or offline, the system font stack below is used instead.

const FONT_URL = 'https://fonts.googleapis.com/css2'
  + '?family=Bricolage+Grotesque:opsz,wght@12..96,500..800'
  + '&family=Plus+Jakarta+Sans:wght@400..700'
  + '&family=JetBrains+Mono:wght@400;500'
  + '&display=swap';

const CSS = `
:root{
  --ej-font:'Plus Jakarta Sans',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;
  --ej-display:'Bricolage Grotesque','Plus Jakarta Sans',ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;
  --ej-mono:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
html body,html body button,html body input,html body select,html body textarea{font-family:var(--ej-font)}
html body{
  -webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;
  text-rendering:optimizeLegibility;font-kerning:normal;font-feature-settings:"kern","liga","calt";line-height:1.6;
}
html body h1,html body h2,html body h3,html body h4,
html body .sidebar-brand,html body .sf-brand,html body .support-hero h1{
  font-family:var(--ej-display);letter-spacing:-.025em;line-height:1.12;text-wrap:balance;
}
html body h1{letter-spacing:-.035em}
html body p,html body li,html body .empty-state small{text-wrap:pretty}

/* Figures: aligned digits so money and counts do not jitter, and a display face for big numbers */
html body table,html body .data-table,html body .ej-admin-table,html body .transaction-row{font-variant-numeric:tabular-nums}
html body .metric-card strong,html body .ej-admin-metric strong,html body .wallet-balance-card strong{
  font-family:var(--ej-display);font-variant-numeric:tabular-nums;letter-spacing:-.03em;
}

/* Credentials, ids and codes read better in a monospace face */
html body code,html body kbd,html body samp,html body pre,html body .lp-secret,html body [class*="secret"],html body [class*="credential"]{
  font-family:var(--ej-mono);font-variant-ligatures:none;
}

/* Wallet deposit card + transaction filters */
.account-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}
.account-actions .button{display:inline-flex;align-items:center;gap:8px}
.deposit-steps{list-style:none;counter-reset:step;display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:18px 0 6px;padding:0}
.deposit-steps li{counter-increment:step;position:relative;padding:14px 14px 14px 52px;border:1px solid rgba(232,101,10,.18);border-radius:14px;background:rgba(255,248,240,.7);font-size:.9rem;line-height:1.4}
.deposit-steps li::before{content:counter(step);position:absolute;left:14px;top:50%;transform:translateY(-50%);width:26px;height:26px;border-radius:50%;display:grid;place-items:center;background:var(--o,#e8650a);color:#fff;font:700 .8rem var(--ej-display)}
.tx-filter-panel{display:flex;flex-wrap:wrap;gap:18px 32px;align-items:flex-end;margin:0 0 14px;padding:14px 16px;border:1px solid rgba(232,101,10,.18);border-radius:14px;background:rgba(255,248,240,.7)}
.tx-filter-panel>div>b{display:block;margin-bottom:8px;font-size:.78rem;letter-spacing:.04em;text-transform:uppercase;opacity:.7}
.tx-filter-panel .filter-chips{margin:0}
.chip small{margin-left:6px;opacity:.6;font-size:.75em}
.chip{cursor:pointer}

/* Small details */
::selection{background:rgba(232,101,10,.22);color:inherit}
:focus-visible{outline:2px solid #e8650a;outline-offset:2px;border-radius:6px}
@media (max-width:700px){
  html body input,html body select,html body textarea{font-size:16px} /* stops iOS zooming into fields */
}
`;

function init() {
  if (document.getElementById('ej-theme')) return;
  const head = document.head;
  [['https://fonts.googleapis.com', false], ['https://fonts.gstatic.com', true]].forEach(([href, cors]) => {
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = href;
    if (cors) link.crossOrigin = '';
    head.appendChild(link);
  });
  const fonts = document.createElement('link');
  fonts.rel = 'stylesheet';
  fonts.href = FONT_URL;
  head.appendChild(fonts);

  const style = document.createElement('style');
  style.id = 'ej-theme';
  style.textContent = CSS;
  head.appendChild(style); // appended last so it wins over older rules of equal weight
}

if (typeof document !== 'undefined') init();
