'use strict';

const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('node:crypto');
const { getPool } = require('./db');
const { createCommerceRouter } = require('./commerce/router');
const {
  inventorySecret, encryptPayload, decryptPayload, fingerprintPayload, identityFingerprint,
  hashSessionToken, randomToken, csrfToken, timingSafeEqualText, scryptHash, scryptVerify,
  decimalToMinor, minorToDecimal, calculateRetail,
} = require('./crypto');

const COOKIE = 'ej_admin_session';
const PLATFORMS = ['Instagram', 'TikTok', 'Facebook', 'X', 'Telegram', 'YouTube', 'Other', 'OTHER'];
const PRODUCT_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'];
const SOURCES = ['OWN', 'DONMARKETPLACE'];
const PRICING_SCOPES = ['DEFAULT', 'PLATFORM', 'PRODUCT'];
const PRICING_MODES = ['FIXED', 'PERCENT', 'MANUAL'];
const UNIT_STATUSES = ['AVAILABLE', 'QUARANTINED'];
const IMPORT_TTL_MS = 30 * 60 * 1000;
const loginAttempts = new Map();
const importAttempts = new Map();

function id(prefix) { return `${prefix}${randomToken(16)}`; }
function asDate(value) { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }
function safeInt(value) { const n = Number(value); return Number.isSafeInteger(n) ? n : Number(value); }
function configured(env = process.env) {
  return Boolean(env.DATABASE_URL && env.INVENTORY_ENCRYPTION_KEY_V1 && env.INVENTORY_ENCRYPTION_KEY_V1.length >= 32 && env.ADMIN_BOOTSTRAP_EMAIL && typeof env.ADMIN_BOOTSTRAP_PASSWORD === 'string' && env.ADMIN_BOOTSTRAP_PASSWORD.length >= 12);
}
function isReady(env = process.env) { return { setupReady: configured(env), databaseConfigured: Boolean(env.DATABASE_URL) }; }
function dbOf(value) { return value || getPool(); }
async function rows(db, sql, params = []) { const result = await db.query(sql, params); return result[0]; }
async function exec(db, sql, params = []) { return db.query(sql, params); }
async function inTransaction(db, callback) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    connection.release();
  }
}

function apiError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}
function sendError(res, error) {
  const status = error.status || 500;
  if (status >= 500) console.error(`admin-tools error: ${error.code || 'internal_error'}`);
  return res.status(status).json({
    error: {
      code: error.code || 'internal_error',
      message: status >= 500 ? 'An internal error occurred.' : error.message,
    },
  });
}
function fail(status, code, message) { throw apiError(status, code, message); }
function requireString(value, field, max = 1000) {
  if (typeof value !== 'string' || value.length > max) {
    fail(400, 'invalid_request', `${field} is invalid`);
  }
  return value;
}
function requireEnum(value, field, allowed) {
  if (!allowed.includes(value)) fail(400, 'invalid_request', `${field} is invalid`);
  return value;
}
function optionalString(value, field, max = 1000) {
  if (value === undefined || value === null) return value == null ? null : undefined;
  return requireString(value, field, max);
}
function jsonWrite(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.get('content-type') || '')) {
    fail(415, 'json_required', 'JSON requests are required');
  }
}
function cookieOptions() {
  const local = process.env.ADMIN_LOCAL_HTTP === '1';
  if (local && process.env.NODE_ENV === 'production') {
    fail(503, 'insecure_cookie_configuration', 'Local HTTP cookies cannot be used in production');
  }
  // The admin console is served from the same origin as its API, so the session cookie never
  // needs to be sent cross-site. 'strict' is the safe default; set ADMIN_COOKIE_SAMESITE=none
  // only if the console is deliberately hosted on a different site.
  const configured = String(process.env.ADMIN_COOKIE_SAMESITE || 'strict').trim().toLowerCase();
  const sameSite = ['strict', 'lax', 'none'].includes(configured) ? configured : 'strict';
  return {
    httpOnly: true,
    sameSite: local ? 'lax' : sameSite,
    secure: !local,
    path: '/api/admin-tools',
  };
}

function auditDetail(detail) {
  const allowed = {};
  for (const key of [
    'status', 'fromStatus', 'toStatus', 'added', 'validRows',
    'invalidRows', 'duplicateRows', 'version', 'scope', 'scopeKey', 'count',
  ]) {
    if (detail && detail[key] !== undefined) allowed[key] = detail[key];
  }
  return allowed;
}
async function audit(db, actor, action, targetId, detail) {
  await exec(
    db,
    'INSERT INTO ej_admin_audit_events (action, actor_id, actor_email, target_id, detail_json) VALUES (?, ?, ?, ?, ?)',
    [
      action,
      actor?.id || null,
      actor?.email || null,
      targetId || null,
      JSON.stringify(auditDetail(detail || {})),
    ],
  );
}

const INSERT_BATCH_SIZE = 100; // keep modest: import rows can carry large encrypted payloads

// "?, ?, ?" for a list of values. Explicit placeholders (not mysql2's `VALUES ?` / `IN (?)`
// array expansion) so the SQL also works through your sql-translate layer.
const inList = (values) => values.map(() => '?').join(', ');

// Multi-row INSERT. `db` can be the pool or a transaction connection.
async function insertBatches(db, table, columns, valueRows) {
  const group = `(${inList(columns)})`;
  for (let i = 0; i < valueRows.length; i += INSERT_BATCH_SIZE) {
    const chunk = valueRows.slice(i, i + INSERT_BATCH_SIZE);
    await db.query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${chunk.map(() => group).join(', ')}`,
      chunk.flat(),
    );
  }
}

// One audit row per target, same action and detail.
async function auditMany(db, actor, action, targetIds, detail) {
  if (!targetIds.length) return;
  const json = JSON.stringify(auditDetail(detail || {}));
  await insertBatches(
    db,
    'ej_admin_audit_events',
    ['action', 'actor_id', 'actor_email', 'target_id', 'detail_json'],
    targetIds.map((target) => [action, actor?.id || null, actor?.email || null, target, json]),
  );
}

function productInput(body, existing = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    fail(400, 'invalid_request', 'Product body is invalid');
  }

  const rawName = requireString(body.name ?? existing.name, 'name', 160);
  if (!rawName.trim()) fail(400, 'invalid_request', 'name is invalid');

  const name = rawName.trim();
  const platform = requireEnum(body.platform ?? existing.platform, 'platform', PLATFORMS);
  const description = requireString(body.description ?? existing.description ?? '', 'description', 10000);
  const terms = requireString(body.terms ?? existing.terms ?? '', 'terms', 10000);
  const source = requireEnum(body.source ?? existing.source, 'source', SOURCES);
  const status = requireEnum(body.status ?? existing.status ?? 'DRAFT', 'status', PRODUCT_STATUSES);

  if (
    source === 'DONMARKETPLACE'
    && status === 'ACTIVE'
    && (!existing.id || !existing.supplier_product_id || existing.acquisition_cost_minor == null)
  ) {
    fail(
      409,
      'supplier_mapping_required',
      'Sync a valid supplier mapping and save its pricing before activation',
    );
  }

  const acquisitionCost = body.acquisitionCost !== undefined
    ? body.acquisitionCost
    : (existing.acquisition_cost_minor == null
      ? null
      : minorToDecimal(existing.acquisition_cost_minor));

  let acquisitionCostMinor = null;
  if (acquisitionCost !== null && acquisitionCost !== undefined) {
    requireString(acquisitionCost, 'acquisitionCost', 64);
    try {
      acquisitionCostMinor = decimalToMinor(acquisitionCost, { allowZero: true });
    } catch {
      fail(400, 'invalid_request', 'acquisitionCost must be decimal Naira text');
    }
  }

  const minQty = body.minQty === undefined ? Number(existing.min_qty || 1) : body.minQty;
  const maxQty = body.maxQty === undefined ? Number(existing.max_qty || 1) : body.maxQty;

  if (
    !Number.isSafeInteger(minQty)
    || minQty < 1
    || !Number.isSafeInteger(maxQty)
    || maxQty < minQty
    || maxQty > 100000
  ) {
    fail(400, 'invalid_request', 'Quantity bounds are invalid');
  }

  const sellingPrice = body.sellingPrice !== undefined ? body.sellingPrice : null;
  let sellingPriceMinor = null;

  if (source === 'OWN') {
    requireString(sellingPrice, 'sellingPrice', 64);
    try {
      sellingPriceMinor = decimalToMinor(sellingPrice);
    } catch {
      fail(400, 'invalid_request', 'sellingPrice must be a positive Naira amount');
    }
  }

  const supplierProductId = body.supplierProductId !== undefined
    ? optionalString(body.supplierProductId, 'supplierProductId', 255)
    : (existing.supplier_product_id || null);

  return {
    name,
    platform,
    description,
    terms,
    source,
    status,
    acquisitionCostMinor,
    sellingPriceMinor,
    sellingPrice: sellingPrice == null ? null : String(sellingPrice),
    minQty,
    maxQty,
    supplierProductId,
  };
}

function pricingInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    fail(400, 'invalid_request', 'Pricing rule body is invalid');
  }

  const scope = requireEnum(body.scope, 'scope', PRICING_SCOPES);
  let scopeKey = body.scopeKey;

  if (scope === 'DEFAULT') {
    scopeKey = 'logs';
  } else {
    scopeKey = requireString(scopeKey, 'scopeKey', 160).trim();
    if (!scopeKey) fail(400, 'invalid_request', 'scopeKey is invalid');
    if (scope === 'PLATFORM' && !PLATFORMS.includes(scopeKey)) {
      fail(400, 'invalid_request', 'scopeKey is invalid');
    }
  }

  const mode = requireEnum(body.mode, 'mode', PRICING_MODES);
  const value = requireString(body.value, 'value', 64);

  try {
    decimalToMinor(value, { allowZero: true });
  } catch {
    fail(400, 'invalid_request', 'Pricing value is invalid');
  }

  const valueMinor = decimalToMinor(value, { allowZero: true });
  if (mode === 'PERCENT' && valueMinor > 100000n) {
    fail(400, 'invalid_request', 'Pricing value is too large');
  }

  return { scope, scopeKey, mode, value };
}

async function findProduct(db, productId, lock = false) {
  const found = await rows(
    db,
    `SELECT p.*, 'OWN' AS source, NULL AS supplier_product_id
     FROM ej_own_products p
     WHERE p.id = ?${lock ? ' FOR UPDATE' : ''}`,
    [productId],
  );
  return found[0] || null;
}

async function findCatalogProduct(db, productId, lock = false) {
  const own = await findProduct(db, productId, lock);
  if (own) return own;

  const supplier = await rows(
    db,
    `SELECT * FROM ej_admin_products WHERE id = ?${lock ? ' FOR UPDATE' : ''}`,
    [productId],
  );
  return supplier[0] || null;
}

async function findRule(db, product) {
  const found = await rows(
    db,
    `SELECT *
     FROM ej_admin_pricing_rules
     WHERE (scope = 'PRODUCT' AND scope_key = ?)
        OR (scope = 'PLATFORM' AND scope_key = ?)
        OR (scope = 'DEFAULT' AND scope_key = 'logs')
     ORDER BY FIELD(scope, 'PRODUCT', 'PLATFORM', 'DEFAULT')
     LIMIT 1`,
    [product.id, product.platform],
  );
  return found[0] || null;
}

async function pricingFor(db, product, override, preloadedRules) {
  // OWN products use the exact selling price entered by the admin.
  // Donmarketplace products continue to use their pricing rules.
  if (product.source === 'OWN' && product.selling_price_minor != null) {
    const retailMinor = BigInt(product.selling_price_minor);
    const costMinor = product.acquisition_cost_minor == null
      ? null
      : BigInt(product.acquisition_cost_minor);

    return {
      costMinor: costMinor === null ? null : safeInt(costMinor),
      retailMinor: safeInt(retailMinor),
      grossMinor: costMinor === null ? null : safeInt(retailMinor - costMinor),
      scope: 'OWN_MANUAL',
      ruleId: null,
      version: 1,
    };
  }

  let rule = override;

  if (!rule && (product.source === 'OWN' || product.source === 'DONMARKETPLACE')) {
    // preloadedRules (Map of product id -> rule) lets list endpoints skip a query per product.
    const productRules = preloadedRules
      ? [preloadedRules.get(product.id)].filter(Boolean)
      : await rows(
        db,
        "SELECT * FROM ej_admin_pricing_rules WHERE scope='PRODUCT' AND scope_key=? LIMIT 1",
        [product.id],
      );

    rule = productRules[0] || null;
    if (String(rule?.mode || '').toUpperCase() !== 'MANUAL') rule = null;
  } else if (!rule) {
    rule = await findRule(db, product);
  }

  if (!rule) return null;

  const costMinor = product.acquisition_cost_minor == null
    ? null
    : BigInt(product.acquisition_cost_minor);

  let retailMinor;
  try {
    retailMinor = calculateRetail({
      costMinor,
      mode: rule.mode,
      value: rule.value,
    });
  } catch (error) {
    return { invalid: true, reason: error.message, rule };
  }

  if (costMinor !== null && retailMinor < costMinor) {
    return { invalid: true, reason: 'Retail price cannot be below acquisition cost', rule };
  }

  return {
    costMinor: costMinor === null ? null : safeInt(costMinor),
    retailMinor: safeInt(retailMinor),
    grossMinor: costMinor === null ? null : safeInt(retailMinor - costMinor),
    scope: rule.scope,
    ruleId: rule.id,
    version: Number(rule.version),
    rule,
  };
}

function publicProduct(product, pricing, availableCount) {
  const retailMinor = pricing && !pricing.invalid ? pricing.retailMinor : null;

  const checkoutEnabled = product.source === 'OWN'
    && product.status === 'ACTIVE'
    && retailMinor != null
    && Number(retailMinor) > 0
    && availableCount >= Math.max(1, Number(product.min_qty) || 1);

  const social = product.social_metadata_json
    ? (typeof product.social_metadata_json === 'string'
      ? JSON.parse(product.social_metadata_json)
      : product.social_metadata_json)
    : null;

  // IMPORTANT:
  // Public catalogue responses may include formatName and formatType.
  // They must never include formatWriteup or formatCredentials.
  // Those values are stored only inside encrypted inventory payloads.
  const publicSocialMetadata = social
    ? {
      category: social.category || null,
      formatName: social.formatName || null,
      formatType: social.formatType || null,
      pageType: social.pageType || null,
      country: social.country || null,
      followers: social.followers ?? null,
      instagramSubType: social.instagramSubType || null,
      vpnType: social.vpnType || null,
      tutorialType: social.tutorialType || null,
      websiteType: social.websiteType || null,
      workingToolType: social.workingToolType || null,
      toolLink: social.toolLink || null,
      ageMonths: social.ageMonths ?? null,
      username: social.username || null,
      emailAttached: Boolean(social.emailAttached),
      phoneAttached: Boolean(social.phoneAttached),
      twoFactor: Boolean(social.twoFactor),
      ogEmail: Boolean(social.ogEmail),
      verified: Boolean(social.verified),
      image: social.image || null,
    }
    : null;

  return {
    id: product.id,
    name: product.name,
    platform: product.platform,
    description: product.description,
    terms: product.terms,
    category: 'Logs',
    categorySlug: 'logs',
    logCategory: social?.category || null,
    socialMetadata: publicSocialMetadata,
    price: retailMinor == null ? null : minorToDecimal(retailMinor),
    priceMinor: retailMinor,
    available: availableCount > 0,
    _count: { inventory: availableCount },
    customLog: true,
    minQty: Number(product.min_qty),
    // Customer quantity cannot exceed the actual AVAILABLE inventory count.
    // Checkout still locks and allocates inventory transactionally.
    maxQty: Math.min(Number(product.max_qty), Math.max(0, Number(availableCount) || 0)),
    checkoutEnabled,
  };
}

function adminProduct(product, pricing, counts) {
  return {
    id: product.id,
    name: product.name,
    platform: product.platform,
    description: product.description,
    terms: product.terms,
    source: product.source,
    status: product.status,
    supplierProductId: product.supplier_product_id || null,
    acquisitionCost: product.acquisition_cost_minor == null
      ? null
      : minorToDecimal(product.acquisition_cost_minor),
    minQty: Number(product.min_qty),
    maxQty: Number(product.max_qty),
    availableCount: counts.AVAILABLE || 0,
    counts,
    socialMetadata: product.social_metadata_json
      ? (typeof product.social_metadata_json === 'string'
        ? JSON.parse(product.social_metadata_json)
        : product.social_metadata_json)
      : null,
    pricing: pricing && !pricing.invalid
      ? {
        costMinor: pricing.costMinor,
        retailMinor: pricing.retailMinor,
        grossMinor: pricing.grossMinor,
        scope: pricing.scope,
        ruleId: pricing.ruleId,
        version: pricing.version,
      }
      : null,
    createdAt: asDate(product.created_at),
  };
}

async function countStatuses(db, productId) {
  const result = await rows(
    db,
    'SELECT status, COUNT(*) AS count FROM ej_own_inventory_units WHERE product_id = ? GROUP BY status',
    [productId],
  );

  const counts = { AVAILABLE: 0, RESERVED: 0, SOLD: 0, QUARANTINED: 0 };
  for (const row of result) counts[row.status] = Number(row.count);
  return counts;
}

// One query for every product's PRODUCT-scope pricing rule.
async function loadProductRules(db) {
  const result = await rows(db, "SELECT * FROM ej_admin_pricing_rules WHERE scope='PRODUCT'");
  return new Map(result.map((rule) => [rule.scope_key, rule]));
}

// One grouped query for every product's own-inventory status counts.
async function loadStatusCounts(db) {
  const result = await rows(
    db,
    'SELECT product_id, status, COUNT(*) AS count FROM ej_own_inventory_units GROUP BY product_id, status',
  );
  const byProduct = new Map();
  for (const row of result) {
    if (!byProduct.has(row.product_id)) byProduct.set(row.product_id, { AVAILABLE: 0, RESERVED: 0, SOLD: 0, QUARANTINED: 0 });
    byProduct.get(row.product_id)[row.status] = Number(row.count);
  }
  return byProduct;
}

function parseImportLine(raw, lineNo) {
  if (Buffer.byteLength(raw, 'utf8') > 64 * 1024) {
    return { status: 'INVALID', code: 'LINE_TOO_LARGE' };
  }

  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    return { status: 'INVALID', code: 'INVALID_JSON' };
  }

  if (
    !record
    || typeof record !== 'object'
    || Array.isArray(record)
    || !record.payload
    || typeof record.payload !== 'object'
    || Array.isArray(record.payload)
  ) {
    return { status: 'INVALID', code: 'PAYLOAD_REQUIRED' };
  }

  const allowedRecord = new Set(['payload', 'sourceRef']);
  if (Object.keys(record).some((key) => !allowedRecord.has(key))) {
    return { status: 'INVALID', code: 'UNKNOWN_FIELD' };
  }

  if (
    record.sourceRef !== undefined
    && (
      typeof record.sourceRef !== 'string'
      || record.sourceRef.length > 255
      || !/^[A-Za-z0-9._:/-]*$/.test(record.sourceRef)
    )
  ) {
    return { status: 'INVALID', code: 'SOURCE_REF_INVALID' };
  }

  const payload = record.payload;
  const allowedPayload = new Set([
    'username',
    'email',
    'password',
    'recoveryEmail',
    'recoveryPassword',
    'twoFactorSecret',
    'notes',
  ]);

  if (
    Object.keys(payload).some((key) => !allowedPayload.has(key))
    || Object.keys(payload).length > 8
  ) {
    return { status: 'INVALID', code: 'UNKNOWN_FIELD' };
  }

  for (const key of Object.keys(payload)) {
    if (typeof payload[key] !== 'string' || payload[key].length > 10000) {
      return { status: 'INVALID', code: 'FIELD_INVALID' };
    }
  }

  if (
    typeof payload.password !== 'string'
    || payload.password.length === 0
    || (!payload.username && !payload.email)
  ) {
    return { status: 'INVALID', code: 'IDENTITY_OR_PASSWORD_REQUIRED' };
  }

  if (
    (payload.username !== undefined && !payload.username.trim())
    || (payload.email !== undefined && !payload.email.trim())
  ) {
    return { status: 'INVALID', code: 'IDENTITY_INVALID' };
  }

  return {
    status: 'NEW',
    code: 'OK',
    payload,
    sourceRef: record.sourceRef || null,
    lineNo,
  };
}

function parseJsonl(content, product, secret) {
  if (typeof content !== 'string') fail(400, 'invalid_request', 'content is required');
  if (Buffer.byteLength(content, 'utf8') > 2 * 1024 * 1024) {
    fail(413, 'import_too_large', 'Import is too large');
  }

  const physicalLines = content.split(/\r?\n/);
  const nonempty = physicalLines.filter((line) => line.trim() !== '');

  if (!nonempty.length || nonempty.length > 1000) {
    fail(400, 'invalid_request', 'Import must contain 1 to 1000 nonempty JSONL rows');
  }

  const diagnostics = [];
  const seenFingerprint = new Map();
  const seenIdentity = new Map();

  for (let i = 0; i < physicalLines.length; i += 1) {
    if (physicalLines[i].trim() === '') continue;

    const parsed = parseImportLine(physicalLines[i], i + 1);

    if (parsed.status !== 'NEW') {
      diagnostics.push({ line: i + 1, ...parsed });
      continue;
    }

    parsed.fingerprint = fingerprintPayload(parsed.payload, product.platform, secret);
    parsed.identity = identityFingerprint(parsed.payload, product.platform, secret);

    const prior = seenFingerprint.get(parsed.fingerprint)
      || seenIdentity.get(parsed.identity);

    if (prior) {
      parsed.status = 'DUPLICATE_IN_UPLOAD';
      parsed.code = 'DUPLICATE_IN_UPLOAD';
      parsed.duplicateOfLine = prior;
    } else {
      seenFingerprint.set(parsed.fingerprint, i + 1);
      seenIdentity.set(parsed.identity, i + 1);
    }

    diagnostics.push(parsed);
  }

  return diagnostics;
}

function diagResponse(diagnostics) {
  return diagnostics.map((item) => {
    const out = {
      line: item.lineNo || item.line,
      status: item.status,
      code: item.code,
    };
    if (item.duplicateOfLine) out.duplicateOfLine = item.duplicateOfLine;
    return out;
  });
}

function importCounts(diagnostics) {
  const invalidRows = diagnostics.filter((d) => d.status === 'INVALID').length;
  const duplicateRows = diagnostics.filter((d) => d.status.startsWith('DUPLICATE')).length;

  return {
    totalRows: diagnostics.length,
    validRows: diagnostics.filter((d) => d.status === 'NEW').length,
    invalidRows,
    duplicateRows,
  };
}

let lastPurgeAt = 0;
const PURGE_INTERVAL_MS = 60 * 1000;

async function purgeExpiredStaging(database) {
  const now = Date.now();
  if (now - lastPurgeAt < PURGE_INTERVAL_MS) return;
  lastPurgeAt = now;
  try {
    await exec(
      database,
      "UPDATE ej_own_import_rows SET payload_ciphertext = NULL WHERE import_id IN (SELECT id FROM ej_own_imports WHERE expires_at < CURRENT_TIMESTAMP(3) AND status <> 'COMMITTED')",
    );
    await exec(
      database,
      "DELETE FROM ej_own_import_rows WHERE import_id IN (SELECT id FROM ej_own_imports WHERE expires_at < CURRENT_TIMESTAMP(3) AND status <> 'COMMITTED')",
    );
  } catch (error) {
    lastPurgeAt = 0; // retry on the next request
    throw error;
  }
}

// Attempt maps would otherwise keep one entry per visitor forever. Sweep expired entries.
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
function sweepAttempts(map) {
  const now = Date.now();
  for (const [key, times] of map) {
    if (!times.length || now - times[times.length - 1] >= ATTEMPT_WINDOW_MS) map.delete(key);
  }
}
const attemptSweeper = setInterval(() => { sweepAttempts(loginAttempts); sweepAttempts(importAttempts); }, 5 * 60 * 1000);
if (typeof attemptSweeper.unref === 'function') attemptSweeper.unref();

function loginLimited(req) {
  const key = String(req.ip || req.socket?.remoteAddress || 'unknown');
  const now = Date.now();
  const recent = (loginAttempts.get(key) || [])
    .filter((time) => now - time < 15 * 60 * 1000);

  if (recent.length >= 8) return false;
  recent.push(now);
  loginAttempts.set(key, recent);
  return true;
}

function importLimited(req) {
  const key = String(req.ip || req.socket?.remoteAddress || 'unknown');
  const now = Date.now();
  const recent = (importAttempts.get(key) || [])
    .filter((time) => now - time < 15 * 60 * 1000);

  if (recent.length >= 20) return false;
  recent.push(now);
  importAttempts.set(key, recent);
  return true;
}

function createAdminRouter(options = {}) {
  const router = express.Router();
  const suppliedDb = options.db;
  const db = () => dbOf(suppliedDb);

  router.use(cookieParser());

  router.use((req, res, next) => {
    if (req.get('X-EJ-Request') !== '1') {
      return sendError(
        res,
        apiError(400, 'client_header_required', 'Client request header is required'),
      );
    }
    next();
  });

  router.use(express.json({ limit: '3mb', strict: true }));

  async function loadSession(req) {
    const token = req.cookies?.[COOKIE];
    if (!token) return null;

    const found = await rows(
      db(),
      `SELECT s.token_hash, s.csrf_hash, s.expires_at, s.last_seen_at,
              u.id, u.email, u.role
       FROM ej_admin_sessions s
       JOIN ej_admin_users u ON u.id = s.user_id
       WHERE s.token_hash = ?
         AND s.expires_at > CURRENT_TIMESTAMP(3)
         AND u.role = 'ADMIN'`,
      [hashSessionToken(token)],
    );

    if (!found[0]) return null;
    return found[0];
  }

  async function auth(req, res, next) {
    try {
      const session = await loadSession(req);
      if (!session) {
        return sendError(
          res,
          apiError(401, 'authentication_required', 'Authentication is required'),
        );
      }

      req.admin = {
        id: session.id,
        email: session.email,
        role: session.role,
        csrfHash: session.csrf_hash,
      };

      next();
    } catch (error) {
      sendError(res, error);
    }
  }

  const catalogCache = { value: null, at: 0 };

  function writeAuth(req, res, next) {
    catalogCache.value = null; // any admin write may change the public catalog
    // Clear again once the write finishes, so a public request that landed mid-write
    // cannot leave stale data cached.
    res.on('finish', () => { catalogCache.value = null; });
    jsonWrite(req);
    const supplied = req.get('X-Admin-CSRF');

    if (
      !supplied
      || !timingSafeEqualText(hashSessionToken(supplied), req.admin.csrfHash)
    ) {
      return sendError(
        res,
        apiError(403, 'csrf_failed', 'CSRF validation failed'),
      );
    }

    next();
  }

  const use = (handler) => async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      sendError(res, error);
    }
  };

  const commerceRouter = createCommerceRouter({ db: db() });

  router.use(
    '/commerce',
    auth,
    (req, res, next) => req.method === 'GET' ? next() : writeAuth(req, res, next),
    commerceRouter,
  );

  const providerRouter = require('./providers/router')
    .createProviderAdminRouter({ db: db() });

  router.use(
    '/providers',
    auth,
    (req, res, next) => req.method === 'GET' ? next() : writeAuth(req, res, next),
    providerRouter,
  );

  router.get('/session', use(async (req, res) => {
    const session = await loadSession(req);

    const body = {
      user: session
        ? { id: session.id, email: session.email, role: 'ADMIN' }
        : null,
      csrfToken: null,
      setupReady: configured(),
    };

    if (session) {
      const token = csrfToken(req.cookies[COOKIE], inventorySecret());

      if (!timingSafeEqualText(hashSessionToken(token), session.csrf_hash)) {
        return res.status(401).json({
          error: {
            code: 'authentication_required',
            message: 'Authentication is required',
          },
        });
      }

      // Best effort, and at most once a minute: the page does not need to wait for this write.
      const lastSeen = session.last_seen_at ? new Date(session.last_seen_at).getTime() : 0;
      if (Date.now() - lastSeen > 60 * 1000) {
        exec(
          db(),
          'UPDATE ej_admin_sessions SET last_seen_at = CURRENT_TIMESTAMP(3) WHERE token_hash = ?',
          [session.token_hash],
        ).catch(() => {});
      }

      body.csrfToken = token;
    }

    res.json(body);
  }));

  router.post('/login', use(async (req, res) => {
    jsonWrite(req);

    if (!loginLimited(req)) {
      fail(429, 'login_rate_limited', 'Too many login attempts');
    }

    const email = typeof req.body?.email === 'string'
      ? req.body.email.trim().toLowerCase()
      : '';

    const password = req.body?.password;

    if (!email || typeof password !== 'string') {
      fail(400, 'invalid_request', 'Email and password are required');
    }

    const found = await rows(
      db(),
      "SELECT id, email, role, password_hash FROM ej_admin_users WHERE email = ? AND role = 'ADMIN'",
      [email],
    );

    const candidate = found[0];

    const valid = candidate
      ? await scryptVerify(password, candidate.password_hash)
      : await scryptVerify(
        password,
        '$scrypt$N=16384,r=8,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      );

    if (!candidate || !valid) {
      await audit(db(), null, 'LOGIN_FAILED', null, { count: 1 });
      fail(401, 'invalid_credentials', 'Invalid credentials');
    }

    const rawToken = randomToken(32);
    const rawCsrfToken = csrfToken(rawToken, inventorySecret());

    await exec(
      db(),
      `INSERT INTO ej_admin_sessions
       (token_hash, user_id, csrf_hash, expires_at)
       VALUES (?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 8 HOUR))`,
      [
        hashSessionToken(rawToken),
        candidate.id,
        hashSessionToken(rawCsrfToken),
      ],
    );

    res.cookie(COOKIE, rawToken, {
      ...cookieOptions(),
      maxAge: 8 * 60 * 60 * 1000,
    });

    await audit(
      db(),
      { id: candidate.id, email: candidate.email },
      'LOGIN_SUCCESS',
      candidate.id,
      {},
    );

    res.json({
      user: { id: candidate.id, email: candidate.email, role: 'ADMIN' },
      csrfToken: rawCsrfToken,
    });

    // Housekeeping runs after the response so it never slows sign-in.
    exec(
      db(),
      'DELETE FROM ej_admin_sessions WHERE expires_at <= CURRENT_TIMESTAMP(3)',
    ).catch(() => {});
  }));

  router.post('/logout', auth, writeAuth, use(async (req, res) => {
    const token = req.cookies?.[COOKIE];

    if (token) {
      await exec(
        db(),
        'DELETE FROM ej_admin_sessions WHERE token_hash = ?',
        [hashSessionToken(token)],
      );
    }

    res.clearCookie(COOKIE, cookieOptions());
    res.json({ ok: true });
  }));

  router.get('/summary', auth, use(async (req, res) => {
    const [summary] = await rows(
      db(),
      `SELECT
         (SELECT COUNT(*) FROM ej_admin_products WHERE source = 'DONMARKETPLACE')
           + (SELECT COUNT(*) FROM ej_own_products) AS products,
         (SELECT COUNT(*) FROM ej_admin_inventory_units u
            JOIN ej_admin_products p ON p.id = u.product_id
            WHERE u.status = 'AVAILABLE' AND p.source = 'DONMARKETPLACE')
           + (SELECT COUNT(*) FROM ej_own_inventory_units WHERE status = 'AVAILABLE') AS available,
         (SELECT COUNT(*) FROM ej_own_imports) AS imports,
         (SELECT COUNT(*) FROM ej_admin_pricing_rules) AS pricing_rules`,
    );

    res.json({
      products: Number(summary.products),
      available: Number(summary.available),
      imports: Number(summary.imports),
      pricingRules: Number(summary.pricing_rules),
      supplier: {
        enabled: false,
        mode: 'sandbox',
        message: 'Supplier purchasing is disabled; only owned inventory can be uploaded.',
      },
    });
  }));

  router.get('/products', auth, use(async (req, res) => {
    const [products, rules, countsByProduct] = await Promise.all([
      rows(
        db(),
        `SELECT p.id,p.name,p.platform,p.description,p.terms,
                'OWN' AS source,p.status,p.acquisition_cost_minor,
                p.selling_price_minor,p.social_metadata_json,p.min_qty,
                p.max_qty,NULL AS supplier_product_id,p.created_at,p.updated_at
         FROM ej_own_products p
         UNION ALL
         SELECT id,name,platform,description,terms,source,status,
                acquisition_cost_minor,NULL AS selling_price_minor,
                NULL AS social_metadata_json,min_qty,max_qty,
                supplier_product_id,created_at,updated_at
         FROM ej_admin_products
         WHERE source='DONMARKETPLACE'
         ORDER BY created_at DESC`,
      ),
      loadProductRules(db()),
      loadStatusCounts(db()),
    ]);

    const emptyCounts = () => ({ AVAILABLE: 0, RESERVED: 0, SOLD: 0, QUARANTINED: 0 });
    const output = [];

    for (const product of products) {
      output.push(
        adminProduct(
          product,
          await pricingFor(db(), product, undefined, rules),
          countsByProduct.get(product.id) || emptyCounts(),
        ),
      );
    }

    res.json({ products: output });
  }));

  // Create SocialLog listings using the supplied SocialLogForm data model.
  //
  // Privacy rules:
  // - Format name and Format type are public catalogue metadata.
  // - Format write-up and credentials are private fulfilment content.
  // - Private content is encrypted before being stored in inventory.
  // - Private content is never added to the public product description.
  // - Public catalogue responses do not return private inventory payloads.
  router.post('/social-logs', auth, writeAuth, use(async (req, res) => {
    const body = req.body || {};
    const listings = Array.isArray(body.listings) ? body.listings : [];
    const details = body.details && typeof body.details === 'object'
      ? body.details
      : {};

    if (!listings.length || listings.length > 25) {
      fail(400, 'invalid_social_logs', 'Select between 1 and 25 SocialLog listings');
    }

    const platformValues = [
      'INSTAGRAM', 'FACEBOOK', 'TIKTOK', 'X', 'SNAPCHAT',
      'TELEGRAM', 'DISCORD', 'REDDIT', 'LINKEDIN', 'YOUTUBE',
      'GMAIL', 'OUTLOOK', 'VPN', 'TEXTPLUS', 'NEXTPLUS',
      'MAIL', 'TOOL', 'ICLOUD', 'OTHER',
    ];

    const categoryValues = [
      'FACEBOOK_PAGE',
      'FACEBOOK_COUNTRY',
      'TWITTER_FOLLOWERS',
      'INSTAGRAM_FOLLOWERS',
      'VPN',
      'TEXTPLUS_NEXTPLUS',
      'TELEGRAM_ACCOUNT',
      'TIKTOK_COUNTRY',
      'TIKTOK_FOLLOWERS',
      'TUTORIAL',
      'WEBSITE_CREATION',
      'MAIL',
      'ALL_WORKING_TOOLS',
      'ICLOUD',
      'FORMAT',
    ];

    const enumValues = {
      pageType: ['CREATE_PAGE', 'CREATED_PAGE', 'MULTI_PAGE', 'PAGE_WITH_FOLLOWERS'],
      instagramSubType: ['MONTHS_OLD', 'EMPTY_AGED', 'AGED_500'],
      vpnType: ['PIA_7D', 'EXPRESS_1M', 'HMA_1M', 'NORD_1M'],
      tutorialType: ['FACEBOOK_ADS', 'INSTAGRAM_ADS', 'TIKTOK_ADS', 'TWITTER_ADS'],
      websiteType: ['LOGS_WEBSITE', 'SMS_WEBSITE', 'BOTH_WEBSITE', 'BOOSTING_WEBSITE'],
      workingToolType: ['TOOL_1', 'TOOL_2', 'TOOL_3'],
    };

    const rawUsername = requireString(details.username || '', 'username', 160).trim();

    if (!rawUsername) {
      fail(400, 'invalid_social_log', 'Username or listing label is required');
    }

    const isNoAgeCategory = listings.every(
      (item) => ['ALL_WORKING_TOOLS', 'FORMAT'].includes(item.category),
    );

    const age = isNoAgeCategory ? 0 : Number(details.age);

    if (!isNoAgeCategory && (!Number.isFinite(age) || age <= 0 || age > 1200)) {
      fail(400, 'invalid_social_log', 'Enter a valid account age in months');
    }

    const rawPrice = String(details.price ?? '').trim();
    let priceMinor;

    try {
      priceMinor = decimalToMinor(rawPrice);
    } catch {
      fail(400, 'invalid_social_log', 'Enter a valid selling price in Naira');
    }

    const description = typeof details.description === 'string'
      ? details.description.slice(0, 2000)
      : '';

    // Read Format content separately from the public description.
    // These values are stored only inside the encrypted private payload.
    const formatWriteup = typeof details.formatWriteup === 'string'
      ? details.formatWriteup.slice(0, 20000)
      : '';

    const formatCredentials = typeof details.formatCredentials === 'string'
      ? details.formatCredentials.slice(0, 20000)
      : '';

    const image = typeof details.image === 'string'
      ? details.image.trim()
      : '';

    if (image && !/^https?:\/\//i.test(image)) {
      fail(400, 'invalid_social_log', 'Image must be an HTTP or HTTPS URL');
    }

    // All these fields are private inventory fulfilment data.
    // Never add them to publicSocialMetadata or public product descriptions.
    const privateFields = [
      'loginUsername',
      'loginEmail',
      'emailPassword',
      'accountPassword',
      'twoFactorSecret',
      'recoveryEmail',
      'recoveryPassword',
      'backupCodes',
      'cookies',
      'notes',
      'formatCredentials',
      'formatWriteup',
    ];

    const privatePayload = {};

    for (const key of privateFields) {
      const value = details[key];

      if (value !== undefined && value !== null && value !== '') {
        privatePayload[key] = typeof value === 'string'
          ? value.slice(0, 20000)
          : value;
      }
    }

    if (details.loginEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(details.loginEmail))) {
      fail(400, 'invalid_social_log', 'Login email is invalid');
    }

    if (details.recoveryEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(details.recoveryEmail))) {
      fail(400, 'invalid_social_log', 'Recovery email is invalid');
    }

    if (details.cookies) {
      if (typeof details.cookies === 'string') {
        try {
          JSON.parse(details.cookies);
        } catch {
          fail(400, 'invalid_social_log', 'Cookies must contain valid JSON');
        }
      } else if (
        typeof details.cookies !== 'object'
        || Array.isArray(details.cookies)
      ) {
        fail(400, 'invalid_social_log', 'Cookies must contain a JSON object or array');
      }
    }

    for (const key of ['toolLink']) {
      if (details[key] && !/^https?:\/\//i.test(String(details[key]))) {
        fail(400, 'invalid_social_log', `${key} must be an HTTP or HTTPS URL`);
      }
    }

    const secret = inventorySecret();
    const created = [];

    await inTransaction(db(), async (tx) => {
      const productRows = [];
      const unitRows = [];

      for (const listing of listings) {
        const platform = requireEnum(listing.platform, 'platform', platformValues);
        const category = requireEnum(listing.category, 'category', categoryValues);

        for (const [key, allowed] of Object.entries(enumValues)) {
          if (listing[key] != null && listing[key] !== '') {
            requireEnum(listing[key], key, allowed);
          }
        }

        let formatName = null;
        let formatType = null;

        if (category === 'FORMAT') {
          if (
            typeof listing.formatName !== 'string'
            || !listing.formatName.trim()
            || listing.formatName.length > 160
          ) {
            fail(400, 'invalid_social_log', 'A valid format name is required');
          }

          formatName = listing.formatName.trim();

          if (!['WRITEUP', 'CREDENTIALS'].includes(listing.formatType)) {
            fail(
              400,
              'invalid_social_log',
              'Choose whether the format is a write-up or credentials',
            );
          }

          formatType = listing.formatType;

          if (formatType === 'WRITEUP') {
            if (!formatWriteup.trim()) {
              fail(400, 'invalid_social_log', 'Write-up content is required');
            }
          }

          if (formatType === 'CREDENTIALS') {
            if (!formatCredentials.trim()) {
              fail(400, 'invalid_social_log', 'Private credential details are required');
            }
          }
        }

        if (category === 'TIKTOK_COUNTRY' && !listing.country) {
          fail(400, 'invalid_social_log', 'Country is required for TikTok country listings');
        }

        if (category === 'FACEBOOK_PAGE' && !listing.pageType) {
          fail(400, 'invalid_social_log', 'Facebook page type is required');
        }

        if (category === 'INSTAGRAM_FOLLOWERS' && !listing.instagramSubType) {
          fail(400, 'invalid_social_log', 'Instagram subtype is required');
        }

        if (category === 'VPN' && !listing.vpnType) {
          fail(400, 'invalid_social_log', 'VPN type is required');
        }

        if (category === 'TUTORIAL' && !listing.tutorialType) {
          fail(400, 'invalid_social_log', 'Tutorial type is required');
        }

        if (category === 'WEBSITE_CREATION' && !listing.websiteType) {
          fail(400, 'invalid_social_log', 'Website type is required');
        }

        if (
          category === 'ALL_WORKING_TOOLS'
          && (
            !listing.workingToolType
            || !details.toolLink
            || !/^https?:\/\//i.test(String(details.toolLink))
          )
        ) {
          fail(400, 'invalid_social_log', 'Working tools require a type and valid tool link');
        }

        if (
          ['TWITTER_FOLLOWERS', 'TIKTOK_FOLLOWERS'].includes(category)
          && !Number.isFinite(Number(listing.followers))
        ) {
          fail(400, 'invalid_social_log', 'Follower tier is required');
        }

        const label = String(listing.label || rawUsername).trim().slice(0, 160)
          || rawUsername;

        const productId = id('ejl_');

        // Only non-secret catalogue information belongs in this object.
        // Do not add formatWriteup or formatCredentials here.
        const publicMeta = {
          category,
          formatName,
          formatType,
          pageType: listing.pageType || null,
          country: listing.country || (platform === 'ICLOUD' ? 'USA' : null),
          followers: listing.followers == null ? null : Number(listing.followers),
          instagramSubType: listing.instagramSubType || null,
          vpnType: listing.vpnType || null,
          tutorialType: listing.tutorialType || null,
          websiteType: listing.websiteType || null,
          workingToolType: listing.workingToolType || null,
          toolLink: category === 'ALL_WORKING_TOOLS'
            ? String(details.toolLink || '')
            : null,
          ageMonths: age,
          username: rawUsername,
          emailAttached: !!details.emailAttached,
          phoneAttached: !!details.phoneAttached,
          twoFactor: !!details.twoFactor,
          ogEmail: !!details.ogEmail,
          verified: !!details.verified,
          image: image || null,
        };

        // This is the private fulfilment record.
        // It is encrypted before being inserted into ej_own_inventory_units.
        // The commerce delivery service must extract formatWriteup or
        // formatCredentials from this record when fulfilling a completed order.
        const privateRecord = {
          username: rawUsername,
          ...(details.loginEmail
            ? { email: String(details.loginEmail) }
            : {}),
          ...privatePayload,
          ...(category === 'FORMAT' && formatType === 'WRITEUP'
            ? { formatWriteup }
            : {}),
          ...(category === 'FORMAT' && formatType === 'CREDENTIALS'
            ? { formatCredentials }
            : {}),
          ...(details.accountPassword
            ? { password: String(details.accountPassword) }
            : {}),
          ...(details.loginUsername
            ? { loginUsername: String(details.loginUsername) }
            : {}),
          ...(details.emailPassword
            ? { emailPassword: String(details.emailPassword) }
            : {}),
        };

        const variantKey = String(
          listing.pageType
          || listing.country
          || listing.followers
          || listing.instagramSubType
          || listing.vpnType
          || listing.tutorialType
          || listing.websiteType
          || listing.workingToolType
          || category,
        );

        const fingerprint = fingerprintPayload(
          {
            ...privateRecord,
            __listingVariant: `${category}:${variantKey}`,
          },
          platform,
          secret,
        );

        const identity = identityFingerprint(
          privateRecord,
          `${platform}:${category}:${variantKey}`,
          secret,
        );

        productRows.push([
          productId,
          label,
          platform,
          category === 'FORMAT' ? '' : description,
          '',
          'ACTIVE',
          null,
          1,
          1,
          priceMinor.toString(),
          JSON.stringify(publicMeta),
        ]);

        unitRows.push([
          id('eju_'),
          productId,
          'AVAILABLE',
          null,
          encryptPayload(privateRecord, secret),
          fingerprint,
          identity,
        ]);

        created.push(productId);
      }

      await insertBatches(
        tx,
        'ej_own_products',
        ['id', 'name', 'platform', 'description', 'terms', 'status',
         'acquisition_cost_minor', 'min_qty', 'max_qty', 'selling_price_minor',
         'social_metadata_json'],
        productRows,
      );

      await insertBatches(
        tx,
        'ej_own_inventory_units',
        ['id', 'product_id', 'status', 'source_ref', 'payload_ciphertext',
         'fingerprint_hmac', 'identity_hmac'],
        unitRows,
      );

      await auditMany(tx, req.admin, 'SOCIAL_LOG_CREATED', created, { status: 'ACTIVE', count: 1 });
    });

    const createdRows = await rows(
      db(),
      `SELECT p.*, 'OWN' AS source, NULL AS supplier_product_id FROM ej_own_products p WHERE p.id IN (${inList(created)})`,
      created,
    );
    const byId = new Map(createdRows.map((row) => [row.id, row]));
    const products = [];

    for (const productId of created) {
      const product = byId.get(productId);
      products.push(
        adminProduct(
          product,
          await pricingFor(db(), product),
          { AVAILABLE: 1, RESERVED: 0, SOLD: 0, QUARANTINED: 0 },
        ),
      );
    }

    res.status(201).json({
      products,
      count: products.length,
    });
  }));

  router.post('/products', auth, writeAuth, use(async (req, res) => {
    const input = productInput({ ...req.body, source: 'OWN' }, {});
    const productId = id('ejl_');

    await inTransaction(db(), async (tx) => {
      await tx.query(
        `INSERT INTO ej_own_products
         (
           id, name, platform, description, terms, status,
           acquisition_cost_minor, min_qty, max_qty, selling_price_minor
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          productId,
          input.name,
          input.platform,
          input.description,
          input.terms,
          input.status,
          input.acquisitionCostMinor == null
            ? null
            : input.acquisitionCostMinor.toString(),
          input.minQty,
          input.maxQty,
          input.sellingPriceMinor == null
            ? null
            : input.sellingPriceMinor.toString(),
        ],
      );

      const created = {
        id: productId,
        platform: input.platform,
        source: 'OWN',
        acquisition_cost_minor: input.acquisitionCostMinor,
        selling_price_minor: input.sellingPriceMinor,
      };

      const pricing = await pricingFor(tx, created);

      if (!pricing || pricing.invalid) {
        fail(
          422,
          'invalid_selling_price',
          pricing?.reason || 'Enter a valid selling price',
        );
      }

      await audit(tx, req.admin, 'PRODUCT_CREATED', productId, {
        status: input.status,
      });
    });

    const product = await findProduct(db(), productId);

    res.status(201).json({
      product: adminProduct(
        product,
        await pricingFor(db(), product),
        await countStatuses(db(), productId),
      ),
    });
  }));

  router.patch('/products/:id', auth, writeAuth, use(async (req, res) => {
    let product;

    await inTransaction(db(), async (tx) => {
      const existing = await findProduct(tx, req.params.id, true);

      if (!existing) fail(404, 'not_found', 'Product not found');

      const input = productInput(req.body, existing);

      if (
        input.platform !== existing.platform
        || input.source !== existing.source
      ) {
        const inventory = await rows(
          tx,
          'SELECT COUNT(*) AS count FROM ej_own_inventory_units WHERE product_id = ?',
          [existing.id],
        );

        const staging = await rows(
          tx,
          `SELECT COUNT(*) AS count
           FROM ej_own_import_rows r
           JOIN ej_own_imports i ON i.id = r.import_id
           WHERE i.product_id = ?`,
          [existing.id],
        );

        if (
          Number(inventory[0].count) > 0
          || Number(staging[0].count) > 0
        ) {
          fail(
            409,
            'product_scope_locked',
            'Platform or source cannot change after inventory or staging exists',
          );
        }
      }

      const candidate = {
        ...existing,
        platform: input.platform,
        acquisition_cost_minor: input.acquisitionCostMinor,
        selling_price_minor: input.sellingPriceMinor,
        source: 'OWN',
        status: input.status,
      };

      if (input.source !== 'OWN') {
        fail(
          400,
          'invalid_product_source',
          'Manually managed products must use the OWN catalogue',
        );
      }

      await tx.query(
        `UPDATE ej_own_products
         SET name=?, platform=?, description=?, terms=?, status=?,
             acquisition_cost_minor=?, min_qty=?, max_qty=?, selling_price_minor=?
         WHERE id=?`,
        [
          input.name,
          input.platform,
          input.description,
          input.terms,
          input.status,
          input.acquisitionCostMinor == null
            ? null
            : input.acquisitionCostMinor.toString(),
          input.minQty,
          input.maxQty,
          input.sellingPriceMinor == null
            ? null
            : input.sellingPriceMinor.toString(),
          existing.id,
        ],
      );

      const pricing = await pricingFor(tx, candidate);

      if (!pricing || pricing.invalid) {
        fail(
          422,
          'invalid_selling_price',
          pricing?.reason || 'Enter a valid selling price',
        );
      }

      await audit(tx, req.admin, 'PRODUCT_UPDATED', existing.id, {
        status: input.status,
      });

      product = await findProduct(tx, existing.id);
    });

    res.json({
      product: adminProduct(
        product,
        await pricingFor(db(), product),
        await countStatuses(db(), product.id),
      ),
    });
  }));

  // Don Logs use an explicit per-product retail override.
  // This is separate from Own SocialLogs pricing.
  router.patch('/products/:id/don-price', auth, writeAuth, use(async (req, res) => {
    const rawPrice = requireString(req.body?.sellingPrice, 'sellingPrice', 64);
    let sellingMinor;

    try {
      sellingMinor = decimalToMinor(rawPrice);
    } catch {
      fail(400, 'invalid_request', 'Selling price must be a positive Naira amount');
    }

    await inTransaction(db(), async (tx) => {
      const found = await rows(
        tx,
        "SELECT * FROM ej_admin_products WHERE id=? AND source='DONMARKETPLACE' FOR UPDATE",
        [req.params.id],
      );

      const product = found[0];

      if (!product) fail(404, 'not_found', 'Don Logs product not found');

      if (!product.supplier_product_id || product.acquisition_cost_minor == null) {
        fail(
          409,
          'supplier_mapping_required',
          'Sync this Don Log again to retrieve its API price',
        );
      }

      const apiCost = BigInt(product.acquisition_cost_minor);

      if (sellingMinor < apiCost) {
        fail(
          422,
          'selling_price_below_api',
          'Your selling price cannot be below the Donmarketplace API price',
        );
      }

      const ruleId = id('ejr_');

      await tx.query(
        `INSERT INTO ej_admin_pricing_rules
         (id,scope,scope_key,mode,value,version)
         VALUES (?,'PRODUCT',?,'MANUAL',?,1)
         ON CONFLICT (scope, scope_key) DO UPDATE SET
           mode='MANUAL',
           value=EXCLUDED.value,
           version=ej_admin_pricing_rules.version+1`,
        [ruleId, product.id, rawPrice],
      );

      await tx.query(
        "UPDATE ej_admin_products SET status='ACTIVE' WHERE id=?",
        [product.id],
      );

      await audit(
        tx,
        req.admin,
        'DON_LOG_PRICE_SET_AND_ACTIVATED',
        product.id,
        { status: 'ACTIVE', scope: 'PRODUCT' },
      );
    });

    const product = (await rows(
      db(),
      "SELECT * FROM ej_admin_products WHERE id=? AND source='DONMARKETPLACE'",
      [req.params.id],
    ))[0];

    res.json({
      product: adminProduct(
        product,
        await pricingFor(db(), product),
        await countStatuses(db(), product.id),
      ),
    });
  }));

  router.patch('/products/:id/don-activation', auth, writeAuth, use(async (req, res) => {
    if (req.body?.active !== false) {
      fail(400, 'invalid_request', 'Only deactivation is supported by this action');
    }

    await inTransaction(db(), async (tx) => {
      const found = await rows(
        tx,
        "SELECT id,status FROM ej_admin_products WHERE id=? AND source='DONMARKETPLACE' FOR UPDATE",
        [req.params.id],
      );

      const product = found[0];

      if (!product) fail(404, 'not_found', 'Don Logs product not found');

      await tx.query(
        "UPDATE ej_admin_products SET status='DRAFT' WHERE id=?",
        [product.id],
      );

      await audit(tx, req.admin, 'DON_LOG_DEACTIVATED', product.id, {
        fromStatus: product.status,
        toStatus: 'DRAFT',
      });
    });

    const product = (await rows(
      db(),
      "SELECT * FROM ej_admin_products WHERE id=? AND source='DONMARKETPLACE'",
      [req.params.id],
    ))[0];

    res.json({
      product: adminProduct(
        product,
        await pricingFor(db(), product),
        await countStatuses(db(), product.id),
      ),
    });
  }));

  router.get('/pricing-rules', auth, use(async (req, res) => {
    const rules = await rows(
      db(),
      `SELECT id, scope, scope_key, mode, value, version, updated_at
       FROM ej_admin_pricing_rules
       ORDER BY scope, scope_key`,
    );

    res.json({
      rules: rules.map((rule) => ({
        id: rule.id,
        scope: rule.scope,
        scopeKey: rule.scope_key,
        mode: rule.mode,
        value: rule.value,
        version: Number(rule.version),
        updatedAt: asDate(rule.updated_at),
      })),
    });
  }));

  router.post('/pricing-rules', auth, writeAuth, use(async (req, res) => {
    const input = pricingInput(req.body);

    const connectionResult = await inTransaction(db(), async (tx) => {
      if (
        input.scope === 'PRODUCT'
        && !(await findCatalogProduct(tx, input.scopeKey, true))
      ) {
        fail(400, 'invalid_request', 'Product scope key is invalid');
      }

      const proposedId = id('ejr_');

      await tx.query(
        `INSERT IGNORE INTO ej_admin_pricing_rules
         (id, scope, scope_key, mode, value, version)
         VALUES (?, ?, ?, ?, ?, 1)`,
        [proposedId, input.scope, input.scopeKey, input.mode, input.value],
      );

      const current = (await rows(
        tx,
        'SELECT * FROM ej_admin_pricing_rules WHERE scope=? AND scope_key=? FOR UPDATE',
        [input.scope, input.scopeKey],
      ))[0];

      const created = current.id === proposedId;

      const rule = {
        id: current.id,
        ...input,
        version: created ? 1 : Number(current.version) + 1,
        created,
      };

      if (!created) {
        await tx.query(
          'UPDATE ej_admin_pricing_rules SET mode=?, value=?, version=? WHERE id=?',
          [rule.mode, rule.value, rule.version, rule.id],
        );
      }

      const affected = await tx.query(
        "SELECT p.*, 'OWN' AS source FROM ej_own_products p WHERE status='ACTIVE' FOR UPDATE",
      );

      const supplierAffected = await tx.query(
        "SELECT * FROM ej_admin_products WHERE status='ACTIVE' AND source='DONMARKETPLACE' FOR UPDATE",
      );

      const rules = await loadProductRules(tx);

      for (const product of [...affected[0], ...supplierAffected[0]]) {
        const price = await pricingFor(tx, product, undefined, rules);

        if (!price || price.invalid) {
          fail(
            422,
            'invalid_publish_price',
            price?.reason || 'Rule would invalidate an active product',
          );
        }
      }

      await audit(tx, req.admin, 'PRICING_RULE_UPSERTED', rule.id, {
        scope: rule.scope,
        scopeKey: rule.scopeKey,
        version: rule.version,
      });

      return rule;
    });

    res.status(connectionResult.created ? 201 : 200).json({
      rule: {
        id: connectionResult.id,
        scope: connectionResult.scope,
        scopeKey: connectionResult.scopeKey,
        mode: connectionResult.mode,
        value: connectionResult.value,
        version: connectionResult.version,
      },
    });
  }));

  router.delete('/pricing-rules/:id', auth, writeAuth, use(async (req, res) => {
    const found = (await rows(
      db(),
      'SELECT * FROM ej_admin_pricing_rules WHERE id=?',
      [req.params.id],
    ))[0];

    if (!found) fail(404, 'not_found', 'Pricing rule not found');

    await inTransaction(db(), async (tx) => {
      await tx.query(
        'DELETE FROM ej_admin_pricing_rules WHERE id=?',
        [found.id],
      );

      const rules = await loadProductRules(tx);

      const affected = await tx.query(
        "SELECT p.*, 'OWN' AS source FROM ej_own_products p WHERE status='ACTIVE'",
      );

      const supplierAffected = await tx.query(
        "SELECT * FROM ej_admin_products WHERE status='ACTIVE' AND source='DONMARKETPLACE'",
      );

      for (const product of [...affected[0], ...supplierAffected[0]]) {
        const price = await pricingFor(tx, product, undefined, rules);

        if (!price || price.invalid) {
          fail(
            422,
            'invalid_publish_price',
            price?.reason || 'Rule deletion would invalidate an active product',
          );
        }
      }

      await audit(tx, req.admin, 'PRICING_RULE_DELETED', found.id, {
        scope: found.scope,
        scopeKey: found.scope_key,
        version: Number(found.version),
      });
    });

    res.json({ ok: true });
  }));

  router.post('/pricing/preview', auth, writeAuth, use(async (req, res) => {
    const body = req.body || {};
    let product = null;

    if (body.productId !== undefined) {
      product = await findCatalogProduct(
        db(),
        requireString(body.productId, 'productId', 64),
      );

      if (!product) fail(404, 'not_found', 'Product not found');
    }

    if (body.cost !== null && body.cost !== undefined) {
      requireString(body.cost, 'cost', 64);
    }

    let cost;

    try {
      cost = body.cost === null || body.cost === undefined
        ? (product?.acquisition_cost_minor == null
          ? null
          : BigInt(product.acquisition_cost_minor))
        : decimalToMinor(body.cost, { allowZero: true });
    } catch {
      fail(400, 'invalid_request', 'cost must be decimal Naira text');
    }

    let rule = body.rule;

    if (!rule) {
      const platform = body.platform
        ? requireEnum(body.platform, 'platform', PLATFORMS)
        : product?.platform || 'Other';

      rule = await findRule(db(), product || { id: '', platform });
    }

    if (!rule) {
      return res.json({ pricing: null, reason: 'No pricing rule selected' });
    }

    const normalized = {
      mode: requireEnum(rule.mode, 'rule.mode', PRICING_MODES),
      value: requireString(rule.value, 'rule.value', 64),
      scope: rule.scope || 'PRODUCT',
      id: rule.id || null,
      version: Number(rule.version || 0),
    };

    try {
      const retailMinor = calculateRetail({
        costMinor: cost,
        mode: normalized.mode,
        value: normalized.value,
      });

      if (cost !== null && retailMinor < cost) {
        return res.json({
          pricing: null,
          reason: 'Retail price cannot be below acquisition cost',
        });
      }

      return res.json({
        pricing: {
          costMinor: cost === null ? null : safeInt(cost),
          retailMinor: safeInt(retailMinor),
          grossMinor: cost === null ? null : safeInt(retailMinor - cost),
          scope: normalized.scope,
          ruleId: normalized.id,
          version: normalized.version,
        },
      });
    } catch (error) {
      return res.json({ pricing: null, reason: error.message });
    }
  }));

  router.post('/imports/validate', auth, writeAuth, use(async (req, res) => {
    if (!importLimited(req)) {
      fail(429, 'import_rate_limited', 'Too many imports');
    }

    await purgeExpiredStaging(db());

    const body = req.body || {};
    const productId = requireString(body.productId, 'productId', 64);
    const product = await findProduct(db(), productId);

    if (
      !product
      || product.source !== 'OWN'
      || product.status === 'ARCHIVED'
    ) {
      fail(
        422,
        'invalid_product',
        'Only non-archived owned products can receive inventory',
      );
    }

    if (body.format !== 'jsonl' || body.authorizationConfirmed !== true) {
      fail(400, 'authorization_required', 'JSONL authorization confirmation is required');
    }

    const secret = inventorySecret();
    const diagnostics = parseJsonl(body.content, product, secret);
    const unique = diagnostics.filter((d) => d.status === 'NEW');

    if (unique.length) {
      const fps = unique.map((d) => d.fingerprint);
      const identities = unique.map((d) => d.identity);

      const existing = await rows(
        db(),
        'SELECT fingerprint_hmac, identity_hmac FROM ej_own_inventory_units WHERE fingerprint_hmac IN (?) OR identity_hmac IN (?)',
        [fps, identities],
      );

      const existingFingerprints = new Set(
        existing.map((r) => r.fingerprint_hmac),
      );

      const existingIdentities = new Set(
        existing.map((r) => r.identity_hmac),
      );

      for (const item of unique) {
        if (
          existingFingerprints.has(item.fingerprint)
          || existingIdentities.has(item.identity)
        ) {
          item.status = 'DUPLICATE_EXISTING';
          item.code = 'DUPLICATE_EXISTING';
        }
      }
    }

    const counts = importCounts(diagnostics);
    const status = counts.invalidRows || counts.duplicateRows
      ? 'INVALID'
      : 'VALIDATED';

    const importId = id('eji_');
    const commitToken = randomToken(32);
    const expiresAt = new Date(Date.now() + IMPORT_TTL_MS);

    await inTransaction(db(), async (tx) => {
      await tx.query(
        `INSERT INTO ej_own_imports
         (
           id, product_id, created_by, status, total_rows,
           valid_rows, invalid_rows, duplicate_rows,
           commit_token_hash, expires_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          importId,
          productId,
          req.admin.id,
          status,
          counts.totalRows,
          counts.validRows,
          counts.invalidRows,
          counts.duplicateRows,
          hashSessionToken(commitToken),
          expiresAt,
        ],
      );

      await insertBatches(
        tx,
        'ej_own_import_rows',
        ['import_id', 'line_no', 'status', 'source_ref', 'payload_ciphertext',
         'fingerprint_hmac', 'identity_hmac', 'diagnostic_code', 'duplicate_of_line'],
        diagnostics.map((item) => [
          importId,
          item.lineNo || item.line,
          item.status,
          item.sourceRef || null,
          status === 'VALIDATED' && item.status === 'NEW'
            ? encryptPayload(item.payload, secret)
            : null,
          item.fingerprint || null,
          item.identity || null,
          item.code,
          item.duplicateOfLine || null,
        ]),
      );

      await audit(tx, req.admin, 'IMPORT_VALIDATED', importId, {
        validRows: counts.validRows,
        invalidRows: counts.invalidRows,
        duplicateRows: counts.duplicateRows,
      });
    });

    res.status(201).json({
      id: importId,
      status,
      totalRows: counts.totalRows,
      validRows: counts.validRows,
      invalidRows: counts.invalidRows,
      duplicateRows: counts.duplicateRows,
      canCommit: status === 'VALIDATED',
      expiresAt: expiresAt.toISOString(),
      commitToken,
      diagnostics: diagResponse(diagnostics),
    });
  }));

  router.post('/imports/:id/commit', auth, writeAuth, use(async (req, res) => {
    await purgeExpiredStaging(db());

    const token = requireString(req.body?.commitToken, 'commitToken', 256);
    const tokenHash = hashSessionToken(token);
    const secret = inventorySecret();

    const result = await inTransaction(db(), async (tx) => {
      const found = (await tx.query(
        `SELECT i.*, 'OWN' AS source, p.status AS product_status
         FROM ej_own_imports i
         JOIN ej_own_products p ON p.id=i.product_id
         WHERE i.id=?
           AND i.commit_token_hash=?
           AND i.created_by=?
         FOR UPDATE`,
        [req.params.id, tokenHash, req.admin.id],
      ))[0][0];

      if (!found) fail(404, 'not_found', 'Import not found');

      if (found.status === 'COMMITTED') {
        return {
          id: found.id,
          status: 'COMMITTED',
          added: Number(found.added),
          replayed: true,
        };
      }

      if (
        found.status !== 'VALIDATED'
        || found.expires_at <= new Date()
        || found.product_status === 'ARCHIVED'
        || found.source !== 'OWN'
      ) {
        fail(409, 'import_not_committable', 'Import is not committable');
      }

      await findProduct(tx, found.product_id, true);

      const staged = (await tx.query(
        "SELECT * FROM ej_own_import_rows WHERE import_id=? AND status='NEW' ORDER BY line_no FOR UPDATE",
        [found.id],
      ))[0];

      const fingerprints = staged
        .map((row) => row.fingerprint_hmac)
        .filter(Boolean);

      const identities = staged
        .map((row) => row.identity_hmac)
        .filter(Boolean);

      if (
        !fingerprints.length
        || !identities.length
        || staged.length !== Number(found.valid_rows)
      ) {
        fail(409, 'duplicate_inventory', 'Import staging is incomplete or invalid');
      }

      if (
        new Set(fingerprints).size !== fingerprints.length
        || new Set(identities).size !== identities.length
      ) {
        fail(409, 'duplicate_inventory', 'Import staging contains duplicates');
      }

      const existing = (await tx.query(
        'SELECT fingerprint_hmac, identity_hmac FROM ej_own_inventory_units WHERE fingerprint_hmac IN (?) OR identity_hmac IN (?) FOR UPDATE',
        [fingerprints, identities],
      ))[0];

      if (existing.length) {
        fail(409, 'duplicate_inventory', 'Inventory duplicate prevented commit');
      }

      let added = 0;

      try {
        const unitRows = staged.map((row) => {
          const payload = decryptPayload(row.payload_ciphertext, secret);
          return [
            id('eju_'),
            found.product_id,
            'AVAILABLE',
            row.source_ref,
            encryptPayload(payload, secret),
            row.fingerprint_hmac,
            row.identity_hmac,
          ];
        });

        await insertBatches(
          tx,
          'ej_own_inventory_units',
          ['id', 'product_id', 'status', 'source_ref', 'payload_ciphertext',
           'fingerprint_hmac', 'identity_hmac'],
          unitRows,
        );

        added = unitRows.length;
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
          fail(409, 'duplicate_inventory', 'Inventory duplicate prevented commit');
        }
        throw error;
      }

      await tx.query(
        'UPDATE ej_own_import_rows SET payload_ciphertext=NULL WHERE import_id=?',
        [found.id],
      );

      await tx.query(
        "UPDATE ej_own_imports SET status='COMMITTED', added=? WHERE id=?",
        [added, found.id],
      );

      await audit(tx, req.admin, 'IMPORT_COMMITTED', found.id, { added });

      return {
        id: found.id,
        status: 'COMMITTED',
        added,
        replayed: false,
      };
    });

    res.json(result);
  }));

  router.get('/imports', auth, use(async (req, res) => {
    await purgeExpiredStaging(db());

    const imports = await rows(
      db(),
      `SELECT i.*, p.name AS product_name
       FROM ej_own_imports i
       JOIN ej_own_products p ON p.id=i.product_id
       WHERE i.created_by=?
       ORDER BY i.created_at DESC`,
      [req.admin.id],
    );

    res.json({
      imports: imports.map((item) => ({
        id: item.id,
        productId: item.product_id,
        productName: item.product_name,
        status: item.status,
        totalRows: Number(item.total_rows),
        validRows: Number(item.valid_rows),
        invalidRows: Number(item.invalid_rows),
        duplicateRows: Number(item.duplicate_rows),
        added: Number(item.added),
        createdAt: asDate(item.created_at),
        expiresAt: asDate(item.expires_at),
      })),
    });
  }));

  router.get('/inventory', auth, use(async (req, res) => {
    const conditions = [];
    const params = [];

    if (req.query.productId) {
      conditions.push('u.product_id=?');
      params.push(String(req.query.productId));
    }

    if (req.query.status) {
      requireEnum(
        String(req.query.status),
        'status',
        ['AVAILABLE', 'RESERVED', 'SOLD', 'QUARANTINED'],
      );
      conditions.push('u.status=?');
      params.push(String(req.query.status));
    }

    const [ownResult, supplierResult] = await Promise.all([rows(
      db(),
      `SELECT u.id, u.product_id, p.name AS product_name, p.platform,
              u.status, u.created_at, u.source_ref
       FROM ej_own_inventory_units u
       JOIN ej_own_products p ON p.id=u.product_id
       ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
       ORDER BY u.created_at DESC
       LIMIT 1000`,
      params,
    ), rows(
      db(),
      `SELECT u.id, u.product_id, p.name AS product_name, p.platform,
              u.status, u.created_at, u.source_ref
       FROM ej_admin_inventory_units u
       JOIN ej_admin_products p ON p.id=u.product_id
       WHERE p.source='DONMARKETPLACE'
       ${conditions.length
        ? `AND ${conditions.map((condition) => condition.replaceAll('u.', 'u.')).join(' AND ')}`
        : ''}
       ORDER BY u.created_at DESC
       LIMIT 1000`,
      params,
    )]);

    const result = [...ownResult, ...supplierResult]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 1000);

    res.json({
      units: result.map((unit) => ({
        id: unit.id,
        productId: unit.product_id,
        productName: unit.product_name,
        platform: unit.platform,
        status: unit.status,
        createdAt: asDate(unit.created_at),
        sourceRef: unit.source_ref || null,
      })),
    });
  }));

  router.patch('/inventory/:id/status', auth, writeAuth, use(async (req, res) => {
    const status = requireEnum(req.body?.status, 'status', UNIT_STATUSES);

    await inTransaction(db(), async (tx) => {
      let table = 'ej_own_inventory_units';

      let unit = (await rows(
        tx,
        'SELECT * FROM ej_own_inventory_units WHERE id=? FOR UPDATE',
        [req.params.id],
      ))[0];

      if (!unit) {
        table = 'ej_admin_inventory_units';

        unit = (await rows(
          tx,
          'SELECT * FROM ej_admin_inventory_units WHERE id=? FOR UPDATE',
          [req.params.id],
        ))[0];
      }

      if (!unit) fail(404, 'not_found', 'Inventory unit not found');

      if (!UNIT_STATUSES.includes(unit.status)) {
        fail(
          409,
          'status_transition_denied',
          'Sold or reserved inventory cannot be reactivated',
        );
      }

      if (unit.status === status) return;

      const [result] = await tx.query(
        `UPDATE ${table} SET status=? WHERE id=? AND status=?`,
        [status, unit.id, unit.status],
      );

      if (result.affectedRows !== 1) {
        fail(
          409,
          'status_transition_denied',
          'Inventory changed; refresh before retrying',
        );
      }

      await audit(tx, req.admin, 'INVENTORY_STATUS_CHANGED', unit.id, {
        fromStatus: unit.status,
        toStatus: status,
      });
    });

    res.json({ ok: true, status });
  }));

  router.get('/audit', auth, use(async (req, res) => {
    const events = await rows(
      db(),
      `SELECT id, action, actor_email, target_id, detail_json, created_at
       FROM ej_admin_audit_events
       ORDER BY created_at DESC
       LIMIT 1000`,
    );

    res.json({
      events: events.map((event) => ({
        id: String(event.id),
        action: event.action,
        actorEmail: event.actor_email || null,
        targetId: event.target_id || null,
        detail: typeof event.detail_json === 'string'
          ? JSON.parse(event.detail_json)
          : (event.detail_json || {}),
        createdAt: asDate(event.created_at),
      })),
    });
  }));

  // The storefront calls this on every landing/marketplace view. Cache it briefly; any admin write clears it.
  router.get('/catalog', use(async (req, res) => {
    if (catalogCache.value && Date.now() - catalogCache.at < 10_000) {
      return res.json(catalogCache.value);
    }

    const products = await rows(
      db(),
      `SELECT p.*, 'OWN' AS source,
              COUNT(CASE WHEN u.status='AVAILABLE' THEN 1 END) AS available_count
       FROM ej_own_products p
       LEFT JOIN ej_own_inventory_units u ON u.product_id=p.id
       WHERE p.status='ACTIVE'
       GROUP BY p.id
       ORDER BY p.created_at DESC`,
    );

    // Only load rules when a product actually needs them (OWN products with a selling price never do).
    const rules = products.some((p) => p.selling_price_minor == null)
      ? await loadProductRules(db())
      : new Map();
    const output = [];

    for (const product of products) {
      const pricing = await pricingFor(db(), product, undefined, rules);

      if (!pricing || pricing.invalid || pricing.retailMinor <= 0) {
        continue;
      }

      output.push(
        publicProduct(product, pricing, Number(product.available_count)),
      );
    }

    catalogCache.value = { products: output };
    catalogCache.at = Date.now();
    res.json(catalogCache.value);
  }));

  router.get('/catalog/:id', use(async (req, res) => {
    const result = await rows(
      db(),
      `SELECT p.*, 'OWN' AS source,
              COUNT(CASE WHEN u.status='AVAILABLE' THEN 1 END) AS available_count
       FROM ej_own_products p
       LEFT JOIN ej_own_inventory_units u ON u.product_id=p.id
       WHERE p.id=? AND p.status='ACTIVE'
       GROUP BY p.id`,
      [req.params.id],
    );

    const product = result[0];

    if (!product) fail(404, 'not_found', 'Product not found');

    const pricing = await pricingFor(db(), product);

    if (!pricing || pricing.invalid) {
      fail(404, 'not_found', 'Product not found');
    }

    res.json({
      product: publicProduct(
        product,
        pricing,
        Number(product.available_count),
      ),
    });
  }));

  router.get('/supplier', auth, use(async (req, res) => {
    res.json({
      mode: 'sandbox',
      purchasesEnabled: false,
      status: 'pending-stock',
      message: 'Supplier calls and purchases are disabled.',
    });
  }));

  router.use((error, req, res, next) => {
    if (error?.type === 'entity.parse.failed') {
      return sendError(
        res,
        apiError(400, 'invalid_json', 'Invalid JSON'),
      );
    }

    return sendError(res, error);
  });

  return router;
}

module.exports = {
  createAdminRouter,
  isReady,
  configured,
  parseJsonl,
  parseImportLine,
  pricingInput,
  productInput,
  publicProduct,
  adminProduct,
  sendError,
  decimalToMinor,
  minorToDecimal,
  calculateRetail,
  fingerprintPayload,
  identityFingerprint,
  encryptPayload,
  decryptPayload,
  scryptHash,
  scryptVerify,
  csrfToken,
};