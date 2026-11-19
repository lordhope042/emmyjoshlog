const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const config = require('./config');
const { createLegacyApiRouter } = require('./router');

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: config.clientUrl, credentials: true }));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/api/v1', createLegacyApiRouter());
module.exports = app;
