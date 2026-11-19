'use strict';
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { notFound, errorHandler } = require('./middleware/error');
const { csrfEndpoint, csrfProtection } = require('./middleware/csrf');

// Limits are per IP. Set TRUST_PROXY_HOPS correctly when running behind a proxy, or every
// visitor shares the proxy's address.
const limiter = (windowMs, max) => rateLimit({ windowMs, max, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Please slow down.', code: 'RATE_LIMITED' } });
const providerLimiter = limiter(5 * 60 * 1000, 120);      // catalog lookups only (each one writes quotes); order polling is not limited
const purchaseLimiter = limiter(15 * 60 * 1000, 60);      // number and checkout purchases
const accountLimiter = limiter(60 * 60 * 1000, 10);       // virtual-account creation

function createLegacyApiRouter(options = {}) {
  const router = express.Router();
  router.use(helmet());
  const allowedOrigins = (process.env.CLIENT_URL || '').split(',').map(value => value.trim()).filter(Boolean);
  if (allowedOrigins.length) router.use(require('cors')({
    origin: (origin, done) => done(null, !origin || allowedOrigins.includes(origin)),
    credentials: true,
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Idempotency-Key', 'Authorization'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS']
  }));
  router.use('/webhooks', require('./routes/webhooks'));
  router.use(express.json({ limit: '100kb' }));
  router.use(cookieParser());
  router.get('/auth/csrf', csrfEndpoint);
  router.use(csrfProtection);
  router.use('/auth', require('./routes/auth'));
  router.use('/users', require('./routes/users'));
  router.use('/dashboard', require('./routes/dashboard'));
  router.use('/providers/numbers/catalog', providerLimiter);
  router.use('/providers/logs/catalog', providerLimiter);
  router.post('/providers/numbers/orders', purchaseLimiter);
  router.post('/providers/logs/orders', purchaseLimiter);
  router.post('/orders', purchaseLimiter);
  router.post('/wallet/virtual-account', accountLimiter);
  router.use('/providers', require('../../backend/providers/router').createProviderRouter({ db: options.db }));
  router.use('/', require('./routes/marketplace'));
  router.use('/wallet', require('./routes/wallet'));
  router.use('/transactions', require('./routes/transactions'));
  router.use('/orders', require('./routes/orders'));
  router.use('/notifications', require('./routes/notifications'));
  router.use('/support', require('./routes/support'));
  router.use('/admin', require('./routes/admin'));
  router.use(notFound);
  router.use(errorHandler);
  return router;
}
module.exports = { createLegacyApiRouter };
