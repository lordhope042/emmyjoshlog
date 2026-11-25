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
