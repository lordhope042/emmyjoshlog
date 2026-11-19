'use strict';

const path = require('node:path');

require('dotenv').config();
// Provider, PocketFi and wallet settings live in legacy-api/.env. dotenv never
// overrides a variable that is already set, so the root .env wins on conflicts
// and this file only fills in what the root .env does not define.
require('dotenv').config({ path: path.join(__dirname, 'legacy-api', '.env') });

const express = require('express');
const fs = require('node:fs');
const { createAdminRouter, isReady } = require('./backend');
const { getPool } = require('./backend/db');

function createApp(options = {}) {
  const app = express();

  const root = options.root || __dirname;
  const frontend = options.frontend || (
    process.env.SERVE_DIST === '1'
      ? path.join(root, 'dist')
      : root
  );

  app.disable('x-powered-by');

  // Compress text responses (HTML, JS, CSS, JSON). Optional dependency: run `npm install compression`.
  // The 100 KB+ JavaScript files shrink by roughly 70-80% on the wire. Without the package the
  // server still works, it just sends uncompressed responses.
  try {
    const compression = require('compression');
    app.use(compression({
      threshold: 1024,
      // Never compress the raw PocketFi webhook body path responses differently; only text types.
      filter: (req, res) => compression.filter(req, res)
    }));
  } catch (error) {
    if (error && error.code !== 'MODULE_NOT_FOUND') throw error;
    console.warn('Response compression is off: run "npm install compression" to enable it.');
  }

  // Gzip/Brotli for text responses. Uses the optional `compression` package when installed
  // (npm install compression); without it the server still works, just sends larger files.
  // When a reverse proxy (nginx, Cloudflare) already compresses, set DISABLE_COMPRESSION=1.
  if (process.env.DISABLE_COMPRESSION !== '1') {
    try {
      app.use(require('compression')({ threshold: 1024 }));
    } catch {
      /* compression package not installed */
    }
  }
  // Number of reverse proxies in front of this server. 0 (the default outside production) means
  // X-Forwarded-For is ignored, so visitors cannot spoof their IP and dodge rate limits. In
  // production behind one proxy (nginx, a host's load balancer) the default is 1.
  const proxyHops = process.env.TRUST_PROXY_HOPS !== undefined && process.env.TRUST_PROXY_HOPS !== ''
    ? Number(process.env.TRUST_PROXY_HOPS)
    : (process.env.NODE_ENV === 'production' ? 1 : 0);
  app.set('trust proxy', Number.isInteger(proxyHops) && proxyHops >= 0 ? proxyHops : 0);

  // Content-Security-Policy for the website. Scripts and styles come from this origin only
  // (plus Google Fonts); there are no inline scripts. A remote PUBLIC_API_BASE_URL origin is
  // added to connect-src so cross-origin API calls keep working.
  let apiOrigin = '';
  try {
    const base = String(process.env.PUBLIC_API_BASE_URL || '').trim();
    if (/^https?:\/\//i.test(base)) apiOrigin = new URL(base).origin;
  } catch { apiOrigin = ''; }
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    `connect-src 'self'${apiOrigin ? ` ${apiOrigin}` : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; ');

  // Security headers
  app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    // API and HTML stay uncached. Static files set their own cache headers below.
    if (req.path.startsWith('/api') || req.path === '/config.js' || req.path === '/health') {
      res.setHeader('Cache-Control', 'no-store');
    }
    next();
  });

  // Public frontend configuration.
  // Only expose the API base URL. Never expose database or payment secrets.
  app.get('/config.js', (req, res) => {
    const apiBase = String(
      process.env.PUBLIC_API_BASE_URL || '/api/v1'
    ).trim().replace(/\/+$/, '');

    // Accept only a same-origin path or a valid HTTP(S) URL.
    let validApiBase = '/api/v1';

    try {
      const parsed = new URL(apiBase, 'http://localhost');

      if (
        !apiBase.startsWith('//') &&
        ['http:', 'https:'].includes(parsed.protocol) &&
        !parsed.username &&
        !parsed.password &&
        !parsed.search &&
        !parsed.hash
      ) {
        validApiBase = apiBase;
      }
    } catch {
      validApiBase = '/api/v1';
    }

    res.type('application/javascript');
    res.setHeader('Cache-Control', 'no-store');

    res.send(
      `window.EMMYJOSH_CONFIG = Object.freeze({
        apiBase: ${JSON.stringify(validApiBase)}
      });`
    );
  });

  // Admin health check
  app.get('/health', async (req, res) => {
    try {
      const readiness = isReady();

      if (!readiness.setupReady) {
        return res.status(503).json({ ready: false });
      }

      const [rows] = await (options.db || getPool()).query(
        'SELECT COUNT(*) AS count FROM ej_admin_users WHERE role = ?',
        ['ADMIN']
      );

      if (!Number(rows[0]?.count)) {
        return res.status(503).json({ ready: false });
      }

      await (options.db || getPool()).query('SELECT id FROM "User" LIMIT 1');
      await (options.db || getPool()).query('SELECT order_id FROM ej_checkout_orders LIMIT 1');
      res.json({ ready: true });
    } catch {
      res.status(503).json({ ready: false });
    }
  });

  // Admin API
  app.use(
    '/api/admin-tools',
    createAdminRouter({ db: options.db })
  );

  // Customer, wallet, order and PocketFi routes share this server/port.
  // The legacy router mounts its raw-body webhook before its JSON parser.
  app.use(
    '/api/v1',
    require('./legacy-api/src/router').createLegacyApiRouter({ db: options.db })
  );

  // Reject unknown API endpoints
  app.use('/api', (req, res) => {
    res.status(404).json({
      error: {
        code: 'not_found',
        message: 'This API endpoint is not enabled.'
      }
    });
  });

  // Frontend manifest
  const manifest = fs.existsSync(
    path.join(frontend, 'manus-routes.json')
  )
    ? path.join(frontend, 'manus-routes.json')
    : path.join(root, 'public', 'manus-routes.json');

  app.get('/manus-routes.json', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(manifest);
  });

  // Asset aliases
  const aliases = {
    '/manus-storage/emmyjosh-logo-original-crop_1be053b9.png':
      'assets/emmyjosh-logo-original-crop.png',

    '/manus-storage/async-images/DUkoSpJ2nXlRVxpQJjP4OK/image-1.webp':
      'assets/emmyjosh-hero.webp'
  };

  for (const [url, file] of Object.entries(aliases)) {
    app.get(url, (req, res) => {
      res.setHeader('Cache-Control', 'public, max-age=604800');
      res.sendFile(path.join(frontend, file));
    });
  }

  // Serve only approved frontend directories.
  // Backend code, migrations, private files and the legacy API stay server-only.
  // Images and icons change rarely, so they are cached for a week. CSS and JS are cached
  // but revalidated with an ETag on every load, so a deploy is picked up immediately.
  for (const directory of ['css', 'js', 'assets']) {
    app.use(
      `/${directory}`,
      express.static(path.join(frontend, directory), {
        dotfiles: 'deny',
        fallthrough: false,
        index: false,
        etag: true,
        setHeaders(res) {
          res.setHeader(
            'Cache-Control',
            directory === 'assets' ? 'public, max-age=604800' : 'no-cache'
          );
        }
      })
    );
  }

  // Frontend routes
  app.get('*', (req, res) => {
    if (
      /\.[A-Za-z0-9]+$/.test(req.path) ||
      /^\/(?:backend|legacy-api|tests|node_modules|\.git|\.env)(?:\/|$)/.test(req.path)
    ) {
      return res.status(404).end();
    }

    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(frontend, 'index.html'));
  });

  // Central error handler
  app.use((error, req, res, next) => {
    if (res.headersSent) {
      return next(error);
    }

    res.status(error.status || 500).json({
      error: {
        code: error.status === 404
          ? 'not_found'
          : 'request_failed',
        message: 'The request could not be completed.'
      }
    });
  });

  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);

  createApp().listen(port, '0.0.0.0', () => {
    console.log(
      `Emmyjosh website and admin API listening on port ${port}`
    );
  });
}

module.exports = { createApp };
