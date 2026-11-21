'use strict';

const crypto = require('node:crypto');
const { getPool } = require('../db');
const { toPostgres } = require('../sql-translate');
const {
  encryptPayload, decryptPayload, decimalToMinor, minorToDecimal,
  randomToken, calculateRetail,
} = require('../crypto');

const OWN = 'OWN';
const EXTERNAL_SOURCES = new Set(['DONMARKETPLACE', 'NUMBER']);
const PROVIDERS = new Set(['DONMARKETPLACE', '5SIM', 'SMSBOWER']);
const MAX_DB_MINOR = 99999999999999n;
const SECRET = () => process.env.INVENTORY_ENCRYPTION_KEY_V1;
const TERMINAL_EXTERNAL = new Set(['REFUNDED', 'FAILED']);

function fail(status, code, message) { const e = new Error(message); e.status = status; e.code = code; throw e; }
function id(prefix) { return `${prefix}${randomToken(16)}`; }
function rows(result) { return Array.isArray(result) && Array.isArray(result[0]) ? result[0] : (Array.isArray(result) ? result : []); }
function resultOf(result) { return Array.isArray(result) && result[0] && !Array.isArray(result[0]) ? result[0] : (Array.isArray(result) ? result[1] || {} : result || {}); }
async function q(db, sql, params = []) { return rows(await db.query(sql, params)); }
async function exec(db, sql, params = []) { return resultOf(await db.query(sql, params)); }
function affected(result) { return Number(result?.affectedRows ?? result?.count ?? 0); }
function nowIso() { return new Date().toISOString(); }
function unwrapDb(db) { return db || getPool(); }
function requireSecret() { if (typeof SECRET() !== 'string' || SECRET().length < 32) fail(500, 'encryption_not_configured', 'Inventory encryption is not configured'); return SECRET(); }
function jsonValue(value) { return value == null ? null : JSON.stringify(value); }

function normalizeIdempotencyKey(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 255) fail(400, 'invalid_idempotency_key', 'Idempotency-Key must be between 1 and 255 characters');
  return value;
}
function normalizeQuantity(quantity) {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100000) fail(400, 'invalid_quantity', 'Quantity is invalid');
  return quantity;
}
function normalizeMinor(value, field) {
  try {
    const minor = typeof value === 'bigint'
      ? value
      : typeof value === 'number' && Number.isSafeInteger(value)
        ? BigInt(value)
        : typeof value === 'string' && /^\d+$/.test(value)
          ? BigInt(value)
          : decimalToMinor(String(value), { allowZero: true });
    if (minor < 0n || minor > MAX_DB_MINOR) fail(400, 'invalid_money', `${field} is outside the supported money range`);
    return minor;
  } catch (error) {
    if (error?.code === 'invalid_money') throw error;
    fail(400, 'invalid_money', `${field} is invalid`);
  }
}
function positiveMinor(value, field) {
  const minor = normalizeMinor(value, field);
  if (minor <= 0n) fail(400, 'invalid_money', `${field} must be positive`);
  return minor;
}
function money(value) { return minorToDecimal(typeof value === 'bigint' ? value : BigInt(String(value))); }
function parseNaira(value, field, currency = 'NGN') {
  if (String(currency || '').toUpperCase() !== 'NGN') fail(409, 'currency_mismatch', `${field} must use NGN`);
  try { return decimalToMinor(String(value), { allowZero: true }); } catch { fail(400, 'invalid_money', `${field} is not a valid Naira amount`); }
}
function assertSafeAdd(left, right, field = 'amount') {
  const a = normalizeMinor(left, `${field} balance`); const b = normalizeMinor(right, field);
  if (a + b > MAX_DB_MINOR) fail(409, 'amount_overflow', `${field} exceeds the supported range`);
  return a + b;
}
function hashRequest(value) {
  const canonical = (v) => v === null || typeof v !== 'object' ? v : Array.isArray(v) ? v.map(canonical) : Object.keys(v).sort().reduce((o, k) => { o[k] = canonical(v[k]); return o; }, {});
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function orderShape(order, items = []) {
  if (!order) return null;
  return {
    id: order.id, userId: order.userId ?? order.user_id,
    orderReference: order.orderReference ?? order.order_reference,
    subtotal: order.subtotal, fees: order.fees ?? '0.00', total: order.total,
    currency: order.currency || 'NGN', status: order.status,
    createdAt: order.createdAt ?? order.created_at, updatedAt: order.updatedAt ?? order.updated_at, items,
  };
}
function itemShape(item) {
  return {
    id: item.id, orderId: item.orderId ?? item.order_id, productId: item.productId ?? item.product_id,
    productNameSnapshot: item.productNameSnapshot ?? item.product_name_snapshot,
    unitPrice: item.unitPrice ?? item.unit_price, quantity: Number(item.quantity), lineTotal: item.lineTotal ?? item.line_total,
  };
}
function externalRecord(value, options = {}) {
  if (!value) return null;
  let requestPayload = value.requestPayload ?? value.request_payload ?? null;
  if (typeof requestPayload === 'string') { try { requestPayload = JSON.parse(requestPayload); } catch { requestPayload = null; } }
  const record = {
    orderId: value.orderId ?? value.order_id, userId: value.userId ?? value.user_id, state: value.state,
    source: value.source, provider: value.provider, providerRef: value.providerRef ?? value.provider_ref ?? null,
    supplierKey: value.supplierKey ?? value.supplier_key ?? null, requestPayload,
    quantity: Number(value.quantity), retailMinor: value.retailMinor ?? value.retail_minor,
    costMinor: value.costMinor ?? value.cost_minor, currency: value.currency || 'NGN',
    uncertainCode: value.uncertainCode ?? value.uncertain_code ?? null,
    idempotencyKey: value.idempotencyKey ?? value.idempotency_key,
  };
  if (options.includeSession && value.session_state_ciphertext) {
    try { record.session = decryptPayload(value.session_state_ciphertext, requireSecret()); } catch { fail(500, 'session_decryption_failed', 'Provider session could not be decrypted'); }
  } else if (options.includeSession && value.sessionCiphertext) {
    try { record.session = decryptPayload(value.sessionCiphertext, requireSecret()); } catch { fail(500, 'session_decryption_failed', 'Provider session could not be decrypted'); }
  }
  return record;
}

function memoryState(db) { return db.__commerceMemory; }
function createMemoryCommerceDb(seed = {}) {
  const state = {
    users: new Map((seed.users || []).map(x => [x.id, x])),
    products: new Map((seed.products || []).map(x => [x.id, { status: 'ACTIVE', currency: 'NGN', ...x }])),
    inventory: new Map((seed.inventory || []).map(x => [x.id, { status: 'AVAILABLE', ...x }])),
    wallets: new Map(Object.entries(seed.wallets || {})),
    orders: new Map(), orderMeta: new Map(), ordersByKey: new Map(), ledger: [],
  };
  const db = { __commerceMemory: state };
  return db;
}
function memoryFindOrder(state, orderId, userId) { const order = state.orders.get(orderId); return order && (!userId || order.userId === userId) ? order : null; }
function memoryReplay(state, input, requestHash) {
  const key = `${input.userId}|${input.idempotencyKey}`; const orderId = state.ordersByKey.get(key); if (!orderId) return null;
  const order = state.orders.get(orderId); const meta = state.orderMeta.get(orderId);
  if (!meta || meta.requestHash !== requestHash) fail(409, 'idempotency_mismatch', 'Idempotency key was already used for a different request');
  return { order, replayed: true, record: externalRecord(meta) };
}
function makeMemoryOrder(state, input) {
  const order = { id: id('ord_'), userId: input.userId, orderReference: `EJL-${randomToken(6).toUpperCase()}`,
    subtotal: money(input.totalMinor), fees: '0.00', total: money(input.totalMinor), currency: input.currency || 'NGN',
    status: input.status, createdAt: nowIso(), updatedAt: nowIso(), items: [] };
  order.items.push({ id: id('item_'), orderId: order.id, productId: input.productId, productNameSnapshot: input.productName,
    unitPrice: money(input.unitMinor), quantity: input.quantity, lineTotal: money(input.totalMinor) });
  state.orders.set(order.id, order); state.orderMeta.set(order.id, input.meta);
  state.ordersByKey.set(`${input.userId}|${input.idempotencyKey}`, order.id);
  state.ledger.push({ reference: order.orderReference, type: 'PURCHASE_DEBIT', userId: input.userId, amount: order.total, currency: order.currency, status: 'COMPLETED' });
  return order;
}
function memoryProduct(state, productId) {
  const product = state.products.get(productId); if (!product || product.status !== 'ACTIVE') fail(404, 'not_found', 'Product not found');
  if (String(product.currency || 'NGN').toUpperCase() !== 'NGN') fail(409, 'currency_mismatch', 'Product currency is not supported');
  const unitMinor = product.priceMinor !== undefined ? normalizeMinor(product.priceMinor, 'price') : parseNaira(product.price, 'price', product.currency || 'NGN');
  return { ...product, unitMinor, currency: 'NGN', categorySlug: product.categorySlug || (String(productId).startsWith('ejl_') ? 'logs' : 'logs') };
}
function memoryOwnProduct(state, productId, quantity) {
  if (!/^ejl_[A-Za-z0-9_-]+$/.test(String(productId))) return null;
  const product = memoryProduct(state, productId); if (product.status !== 'ACTIVE') return null;
  if (product.minQty != null && quantity < Number(product.minQty)) fail(400, 'invalid_quantity', 'Quantity is below the product minimum');
  if (product.maxQty != null && quantity > Number(product.maxQty)) fail(400, 'invalid_quantity', 'Quantity is above the product maximum');
  return product;
}

/*
 * Extract one buyer delivery line from a decrypted own-inventory payload.
 *
 * Supported payload shapes, in priority order:
 *   1. Plain string payload.
 *   2. Free-text fields: formatWriteup, formatCredentials (top level or under
 *      details), then the legacy delivery, stockReference and value.
 *   3. Structured credential payloads, e.g.
 *        { username: '...', backupCodes: ['...', '...'] }
 *      These are rendered as readable text from an explicit allowlist of
 *      fields, so unrelated private fields are never exposed and the buyer
 *      never receives a raw JSON object.
 */
const CREDENTIAL_FIELDS = [
  ['username', 'Username'],
  ['loginUsername', 'Login Username'],
  ['email', 'Login Email'],
  ['password', 'Account Password'],
  ['emailPassword', 'Email Password'],
  ['recoveryEmail', 'Recovery Email'],
  ['recoveryPassword', 'Recovery Password'],
  ['twoFactorSecret', '2FA Secret'],
  ['cookies', 'Cookies'],
];
const BACKUP_CODE_KEYS = ['backupCodes', 'backup_codes'];

function scalarText(value) {
  if (typeof value === 'string') return value.trim() ? value.trim() : null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function structuredDelivery(payload) {
  const sources = [payload];
  if (payload.details && typeof payload.details === 'object' && !Array.isArray(payload.details)) {
    sources.push(payload.details);
  }

  const lines = [];

  for (const [key, label] of CREDENTIAL_FIELDS) {
    for (const source of sources) {
      const text = scalarText(source[key]);
      if (text) {
        lines.push(`${label}: ${text}`);
        break;
      }
    }
  }

  for (const source of sources) {
    const raw = BACKUP_CODE_KEYS.map(k => source[k]).find(v => v != null);
    if (raw == null) continue;
    const codes = Array.isArray(raw)
      ? raw.map(scalarText).filter(Boolean)
      : [scalarText(raw)].filter(Boolean);
    if (codes.length) {
      lines.push(`Backup Codes: ${codes.join(', ')}`);
      break;
    }
  }

  return lines.length ? lines.join('\n') : null;
}

function ownInventoryDelivery(payload) {
  if (typeof payload === 'string') {
    return payload.trim() ? payload : null;
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const candidates = [
    payload.formatWriteup,
    payload.formatCredentials,
    payload.details?.formatWriteup,
    payload.details?.formatCredentials,
    payload.delivery,
    payload.stockReference,
    payload.value,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate;
    }
  }

  return structuredDelivery(payload);
}

function memoryDeliveryLine(unit) {
  const line = ownInventoryDelivery(unit);
  if (!line) fail(409, 'encrypted_delivery_unavailable', 'Inventory delivery is unavailable');
  return line;
}

function memoryCheckout(input) {
  const state = memoryState(input.db); const key = normalizeIdempotencyKey(input.idempotencyKey); const quantity = normalizeQuantity(input.quantity);
  const productId = String(input.productId); const source = OWN;
  const requestHash = hashRequest({ source, productId, quantity, expectedUnitPriceMinor: input.expectedUnitPriceMinor ?? null });
  const replay = memoryReplay(state, { userId: input.userId, idempotencyKey: key }, requestHash); if (replay) return replay;
  const product = memoryOwnProduct(state, productId, quantity) || memoryProduct(state, productId);
  if (input.expectedUnitPriceMinor !== undefined && normalizeMinor(input.expectedUnitPriceMinor, 'expectedUnitPriceMinor') !== product.unitMinor) fail(409, 'price_changed', 'Product price changed; refresh before checkout');
  const inventory = [...state.inventory.values()].filter(x => x.productId === productId && x.status === 'AVAILABLE').slice(0, quantity);
  if (inventory.length !== quantity) fail(409, 'insufficient_stock', 'Product unavailable');
  const totalMinor = product.unitMinor * BigInt(quantity); normalizeMinor(totalMinor, 'total');
  const balance = normalizeMinor(state.wallets.get(input.userId) || 0, 'wallet balance'); if (balance < totalMinor) fail(422, 'insufficient_balance', 'Insufficient wallet balance');
  state.wallets.set(input.userId, money(balance - totalMinor)); inventory.forEach(unit => { unit.status = 'SOLD'; });
  const meta = { orderId: null, userId: input.userId, source, idempotencyKey: key, requestHash, state: 'COMPLETED', quantity,
    currency: 'NGN', deliveryCiphertext: encryptPayload({ lines: inventory.map(memoryDeliveryLine) }, requireSecret()) };
  const order = makeMemoryOrder(state, { ...input, productId, idempotencyKey: key, totalMinor, unitMinor: product.unitMinor, productName: product.name, currency: 'NGN', status: 'COMPLETED', meta }); meta.orderId = order.id;
  return { order, replayed: false };
}

async function txDb(database, callback) {
  if (database?.__commerceMemory) return callback(database);
  if (database?.$transaction) return database.$transaction(async tx => callback(prismaSql(tx)));
  const pool = unwrapDb(database);
  if (pool.getConnection) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const connection = await pool.getConnection();
      try { await connection.beginTransaction(); const value = await callback(connection); await connection.commit(); return value; }
      catch (e) {
        try { await connection.rollback(); } catch {}
        if (!['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT', '40001', '40P01'].includes(e.code) && !['40001', '40P01'].includes(e?.meta?.code) || attempt === 2) throw e;
        await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)));
      } finally { connection.release(); }
    }
  }
  return callback(pool);
}
function prismaSql(prisma) {
  return { query: async (sql, params = []) => {
    const read = /^(SELECT|WITH)\b/i.test(sql.trim());
    const text = toPostgres(sql);
    if (read) return [await prisma.$queryRawUnsafe(text, ...params)];
    const result = await prisma.$executeRawUnsafe(text, ...params); return [{ affectedRows: Number(result) }];
  } };
}
// Non-transactional reads/writes may receive a raw Prisma client, which has no .query();
// wrap it so the SQL helpers work. Pools and the in-memory db pass through unchanged.
function asSql(db) {
  const raw = unwrapDb(db);
  if (!raw.__commerceMemory && typeof raw.query !== 'function' && typeof raw.$queryRawUnsafe === 'function') return prismaSql(raw);
  return raw;
}
async function retryDuplicate(callback) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { return await callback(); } catch (e) { if (!(e?.code === 'ER_DUP_ENTRY' || e?.code === '23505' || e?.meta?.code === '23505') || attempt) throw e; }
  }
  return null;
}
async function findOrderSql(db, orderId, userId, lock = false) {
  const where = userId ? 'WHERE o.id=? AND o.userId=?' : 'WHERE o.id=?';
  const found = await q(db, `SELECT o.* FROM \`Order\` o ${where}${lock ? ' FOR UPDATE' : ''}`, userId ? [orderId, userId] : [orderId]);
  if (!found[0]) return null; const items = await q(db, 'SELECT * FROM OrderItem WHERE orderId=? ORDER BY id', [orderId]);
  return { raw: found[0], order: orderShape(found[0], items.map(itemShape)) };
}
async function findMeta(db, orderId, lock = false) { const result = await q(db, `SELECT * FROM ej_checkout_orders WHERE order_id=?${lock ? ' FOR UPDATE' : ''}`, [orderId]); return result[0] || null; }

async function ensureLegacyProduct(db, product) {
  const categorySlug = product.categorySlug === 'virtual-numbers' ? 'virtual-numbers' : 'logs';
  const categoryName = categorySlug === 'virtual-numbers' ? 'Virtual Numbers' : 'Logs';
  let category = (await q(db, 'SELECT id FROM ProductCategory WHERE slug=? LIMIT 1', [categorySlug]))[0];
  if (!category) {
    const categoryId = `ejcat_${categorySlug.replace(/[^a-z0-9]+/g, '_')}`;
    await exec(db, 'INSERT IGNORE INTO ProductCategory (id,name,slug,description,status) VALUES (?,?,?,?,?)', [categoryId, categoryName, categorySlug, 'Secure digital products', 'ACTIVE']);
    category = (await q(db, 'SELECT id FROM ProductCategory WHERE slug=? LIMIT 1', [categorySlug]))[0];
  }
  if (!category) fail(500, 'category_missing', 'Product category is unavailable');
  const price = money(positiveMinor(product.unitMinor, 'price'));
  const description = String(product.description || '').slice(0, 191);
  const existing = (await q(db, 'SELECT id FROM Product WHERE id=? LIMIT 1', [product.id]))[0];
  if (!existing) {
    await exec(db, 'INSERT INTO Product (id,categoryId,name,slug,description,price,currency,status,updatedAt) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP(3))', [product.id, category.id, String(product.name).slice(0, 191), `product-${product.id}`.slice(0, 191), description, price, 'NGN', 'ACTIVE']);
  } else {
    // The current mirror price is allowed to move; OrderItem.unitPrice is the immutable snapshot.
    await exec(db, 'UPDATE Product SET categoryId=?,name=?,description=?,price=?,currency=?,status=?,updatedAt=CURRENT_TIMESTAMP(3) WHERE id=?', [category.id, String(product.name).slice(0, 191), description, price, 'NGN', 'ACTIVE', product.id]);
  }
}
async function adminProductSql(db, productId, lock = false) {
  const product = (await q(db, `SELECT id,name,platform,description,'OWN' AS source,status,acquisition_cost_minor,selling_price_minor,min_qty,max_qty FROM ej_own_products WHERE id=?${lock ? ' FOR UPDATE' : ''}`, [productId]))[0];
  if (!product) return null;
  let unitMinor;
  if (product.selling_price_minor != null) { unitMinor = normalizeMinor(String(product.selling_price_minor), 'price'); }
  else {
    const rule = (await q(db, "SELECT mode,value FROM ej_admin_pricing_rules WHERE scope='PRODUCT' AND scope_key=? LIMIT 1", [product.id]))[0];
    if (!rule || String(rule.mode).toUpperCase() !== 'MANUAL') return null;
    let cost = product.acquisition_cost_minor == null ? null : normalizeMinor(String(product.acquisition_cost_minor), 'acquisition cost');
    try { unitMinor = calculateRetail({ costMinor: cost, mode: 'MANUAL', value: String(rule.value) }); } catch { return null; }
    unitMinor = normalizeMinor(unitMinor, 'price'); if (cost != null && unitMinor < cost) return null;
  }
  return { id: product.id, name: product.name, description: product.description, unitMinor, currency: 'NGN', status: product.status,
    source: product.source, minQty: Number(product.min_qty || 1), maxQty: Number(product.max_qty || 1), categorySlug: /number/i.test(String(product.platform || '')) ? 'virtual-numbers' : 'logs' };
}
async function legacyProductSql(db, productId, lock = false) {
  const result = await q(db, `SELECT id,name,description,price,currency,status FROM Product WHERE id=?${lock ? ' FOR UPDATE' : ''}`, [productId]);
  if (!result[0]) return null; const p = result[0];
  const unitMinor = positiveMinor(parseNaira(p.price, 'price', p.currency || 'NGN'), 'price');
  return { id: p.id, name: p.name, description: p.description, unitMinor, currency: String(p.currency || 'NGN').toUpperCase(), status: p.status, categorySlug: null };
}
async function resolveOwnProduct(db, productId, quantity = 1) {
  if (!/^ejl_[A-Za-z0-9_-]+$/.test(String(productId))) return null;
  const admin = await adminProductSql(db, productId, true); if (!admin || admin.source !== OWN || admin.status !== 'ACTIVE') return null;
  if (quantity < admin.minQty || quantity > admin.maxQty) fail(400, 'invalid_quantity', 'Quantity is outside the product bounds');
  await ensureLegacyProduct(db, admin); return admin;
}
async function idempotentSql(db, input, requestHash) {
  const found = await q(db, 'SELECT * FROM ej_checkout_orders WHERE user_id=? AND idempotency_key=? FOR UPDATE', [input.userId, input.idempotencyKey]);
  if (!found[0]) return null;
  if (found[0].request_hash !== requestHash) fail(409, 'idempotency_mismatch', 'Idempotency key was already used for a different request');
  const item = await findOrderSql(db, found[0].order_id, input.userId); if (!item) fail(500, 'order_record_missing', 'Order record is incomplete');
  return { order: item.order, replayed: true, record: externalRecord(found[0]) };
}
async function debitWallet(db, userId, totalMinor, expectedCurrency = 'NGN') {
  const total = normalizeMinor(totalMinor, 'total'); const wallet = (await q(db, 'SELECT id,balance,currency FROM Wallet WHERE userId=? FOR UPDATE', [userId]))[0];
  if (!wallet) fail(422, 'wallet_missing', 'Wallet is unavailable');
  if (String(wallet.currency || '').toUpperCase() !== String(expectedCurrency || 'NGN').toUpperCase()) fail(409, 'currency_mismatch', 'Wallet and product currencies do not match');
  parseNaira(wallet.balance, 'wallet balance', wallet.currency); if (parseNaira(wallet.balance, 'wallet balance', wallet.currency) < total) fail(422, 'insufficient_balance', 'Insufficient wallet balance');
  const result = await exec(db, 'UPDATE Wallet SET balance=balance-?,updatedAt=CURRENT_TIMESTAMP(3) WHERE id=? AND balance>=?', [money(total), wallet.id, money(total)]);
  if (affected(result) !== 1) fail(422, 'insufficient_balance', 'Insufficient wallet balance'); return wallet.id;
}
async function insertOrderSql(db, input) {
  const orderId = id('ord_'); const reference = `EJL-${randomToken(6).toUpperCase()}`; const total = money(input.totalMinor);
  await exec(db, 'INSERT INTO `Order` (id,userId,orderReference,subtotal,fees,total,currency,status,updatedAt) VALUES (?,?,?,?,?,?,?, ?,CURRENT_TIMESTAMP(3))', [orderId, input.userId, reference, total, '0.00', total, input.currency || 'NGN', input.status]);
  await exec(db, 'INSERT INTO OrderItem (id,orderId,productId,productNameSnapshot,unitPrice,quantity,lineTotal) VALUES (?,?,?,?,?,?,?)', [id('item_'), orderId, input.productId, String(input.productName).slice(0, 191), money(input.unitMinor), input.quantity, total]);
  await exec(db, 'INSERT INTO WalletTransaction (id,walletId,userId,type,amount,currency,reference,status,description) VALUES (?,?,?,?,?,?,?,?,?)', [id('wtx_'), input.walletId, input.userId, 'PURCHASE_DEBIT', total, input.currency || 'NGN', reference, 'COMPLETED', `Purchase: ${String(input.productName).slice(0, 160)} x${input.quantity}`]);
  return { orderId, reference };
}

/*
 * Allocates own inventory and extracts only the intended delivery value.
 * Format write-ups, credentials, and structured username/backup-code
 * payloads are retrieved from the encrypted payload.
 */
async function allocateOwnSql(db, productId, quantity, orderId) {
  const units = await q(
    db,
    "SELECT id,payload_ciphertext FROM ej_own_inventory_units WHERE product_id=? AND status='AVAILABLE' ORDER BY created_at,id LIMIT ? FOR UPDATE",
    [productId, quantity]
  );

  if (units.length < quantity) {
    fail(409, 'insufficient_stock', 'Product unavailable');
  }

  const lines = [];

  for (const unit of units) {
    let payload;
    try {
      payload = decryptPayload(unit.payload_ciphertext, requireSecret());
    } catch (err) {
      const c = unit.payload_ciphertext;
      console.error('DECRYPT DETAIL', {
        reason: err.message,
        type: typeof c,
        isBuffer: Buffer.isBuffer(c),
        isUint8: c instanceof Uint8Array,
        length: c?.length,
        head: typeof c === 'string' ? c.slice(0, 30) : Buffer.isBuffer(c) ? c.toString('utf8', 0, 30) : String(c).slice(0, 30),
      });
      fail(500, 'inventory_decryption_failed', 'Inventory could not be decrypted');
    }

    const line = ownInventoryDelivery(payload);

    if (!line) {
      // Diagnostic: logs key names and value types only, never the values themselves.
      const names = ['formatWriteup', 'formatCredentials', 'delivery', 'stockReference', 'value', 'username', 'email', 'password', 'backupCodes'];
      const shape = (o) => o && typeof o === 'object'
        ? Object.fromEntries(Object.keys(o).map(k => [k, Array.isArray(o[k]) ? 'array' : o[k] === null ? 'null' : typeof o[k]]))
        : typeof o;
      console.error('DELIVERY SHAPE', {
        unitId: unit.id,
        productId,
        payload: shape(payload),
        details: shape(payload?.details),
        candidates: names.map(n => [n, typeof payload?.[n], typeof payload?.details?.[n]]),
      });
      fail(409, 'encrypted_delivery_unavailable', 'Inventory delivery is unavailable');
    }

    lines.push(line);

    const changed = await exec(
      db,
      "UPDATE ej_own_inventory_units SET status='SOLD' WHERE id=? AND status='AVAILABLE'",
      [unit.id]
    );

    if (affected(changed) !== 1) {
      fail(409, 'inventory_changed', 'Inventory changed; retry checkout');
    }

    const legacyId = `ejpi_${unit.id}`;

    await exec(
      db,
      'INSERT IGNORE INTO ProductInventory (id,productId,stockReference,status,reservedAt,soldAt) VALUES (?,?,?,?,CURRENT_TIMESTAMP(3),CURRENT_TIMESTAMP(3))',
      [legacyId, productId, unit.id, 'SOLD']
    );

    await exec(
      db,
      "UPDATE ProductInventory SET status='DISABLED',soldAt=CURRENT_TIMESTAMP(3) WHERE id=? AND status IN ('AVAILABLE','RESERVED','SOLD')",
      [legacyId]
    );

    await exec(
      db,
      'INSERT IGNORE INTO ej_checkout_allocations (order_id,admin_unit_id,legacy_inventory_id,status) VALUES (?,?,?,?)',
      [orderId, unit.id, legacyId, 'SOLD']
    );
  }

  return {
    lines,
    allocation: units.map(unit => ({
      adminUnitId: unit.id,
      legacyInventoryId: `ejpi_${unit.id}`,
    })),
  };
}

async function allocateLegacySql(db, productId, quantity, orderId) {
  const units = await q(db, "SELECT id,stockReference FROM ProductInventory WHERE productId=? AND status='AVAILABLE' ORDER BY createdAt,id LIMIT ? FOR UPDATE", [productId, quantity]);
  if (units.length < quantity) fail(409, 'insufficient_stock', 'Product unavailable');
  const lines = [];
  for (const unit of units) {
    const reserved = await exec(db, "UPDATE ProductInventory SET status='RESERVED',reservedAt=CURRENT_TIMESTAMP(3) WHERE id=? AND status='AVAILABLE'", [unit.id]);
    if (affected(reserved) !== 1) fail(409, 'inventory_changed', 'Inventory changed; retry checkout');
    if (typeof unit.stockReference !== 'string' || !unit.stockReference.trim()) fail(409, 'delivery_unavailable', 'Inventory delivery is unavailable');
    lines.push(unit.stockReference);
    const sold = await exec(db, "UPDATE ProductInventory SET status='SOLD',soldAt=CURRENT_TIMESTAMP(3) WHERE id=? AND status='RESERVED'", [unit.id]);
    if (affected(sold) !== 1) fail(409, 'inventory_changed', 'Inventory changed; retry checkout');
    await exec(db, 'INSERT INTO ej_checkout_allocations (order_id,admin_unit_id,legacy_inventory_id,status) VALUES (?,?,?,?)', [orderId, null, unit.id, 'SOLD']);
  }
  return { lines, allocation: units.map(unit => ({ adminUnitId: null, legacyInventoryId: unit.id })) };
}

async function createCheckout(input) {
  if (!input.userId || !input.productId) fail(400, 'invalid_request', 'userId and productId are required');
  const key = normalizeIdempotencyKey(input.idempotencyKey); const quantity = normalizeQuantity(input.quantity);
  const db = unwrapDb(input.db); if (db.__commerceMemory) return memoryCheckout({ ...input, idempotencyKey: key, quantity, db });
  const source = OWN;
  const requestHash = hashRequest({ source, productId: input.productId, quantity, expectedUnitPriceMinor: input.expectedUnitPriceMinor ?? null });
  return retryDuplicate(() => txDb(db, async tx => {
    const replay = await idempotentSql(tx, { ...input, idempotencyKey: key }, requestHash); if (replay) return replay;
    let product = await resolveOwnProduct(tx, input.productId, quantity); const own = Boolean(product);
    if (!product) product = await legacyProductSql(tx, input.productId, true);
    if (!product || product.status !== 'ACTIVE') fail(404, 'not_found', 'Product not found');
    if (input.expectedUnitPriceMinor !== undefined && normalizeMinor(input.expectedUnitPriceMinor, 'expectedUnitPriceMinor') !== product.unitMinor) fail(409, 'price_changed', 'Product price changed; refresh before checkout');
    const totalMinor = product.unitMinor * BigInt(quantity); normalizeMinor(totalMinor, 'total'); const walletId = await debitWallet(tx, input.userId, totalMinor, product.currency);
    const inserted = await insertOrderSql(tx, { ...input, idempotencyKey: key, productId: product.id, productName: product.name, quantity, unitMinor: product.unitMinor, totalMinor, walletId, currency: 'NGN', status: 'PROCESSING' });
    const allocation = own ? await allocateOwnSql(tx, product.id, quantity, inserted.orderId) : await allocateLegacySql(tx, product.id, quantity, inserted.orderId);
    const deliveryCiphertext = encryptPayload({ lines: allocation.lines }, requireSecret());
    await exec(tx, "UPDATE `Order` SET status='COMPLETED',updatedAt=CURRENT_TIMESTAMP(3) WHERE id=? AND status='PROCESSING'", [inserted.orderId]);
    const meta = { orderId: inserted.orderId, userId: input.userId, source, idempotencyKey: key, requestHash, state: 'COMPLETED', quantity, retailMinor: totalMinor.toString(), costMinor: null, currency: 'NGN' };
    await exec(tx, 'INSERT INTO ej_checkout_orders (order_id,user_id,source,idempotency_key,request_hash,state,quantity,retail_minor,currency,metadata_json,allocation_ciphertext,delivery_ciphertext) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [inserted.orderId, input.userId, source, key, requestHash, 'COMPLETED', quantity, totalMinor.toString(), 'NGN', jsonValue(meta), encryptPayload({ allocation: allocation.allocation }, requireSecret()), deliveryCiphertext]);
    const found = await findOrderSql(tx, inserted.orderId, input.userId); return { order: found.order, replayed: false };
  }));
}

async function reserveExternalOrder(input) {
  if (!input.userId || !EXTERNAL_SOURCES.has(input.source) || !PROVIDERS.has(input.provider)) fail(400, 'invalid_request', 'Invalid external order fields');
  const key = normalizeIdempotencyKey(input.idempotencyKey); const quantity = normalizeQuantity(input.quantity || 1);
  const retailMinor = positiveMinor(input.retailMinor, 'retailMinor'); const costMinor = normalizeMinor(input.costMinor, 'costMinor');
  const currency = String(input.currency || 'NGN').toUpperCase(); if (currency !== 'NGN') fail(409, 'currency_mismatch', 'Only NGN orders are supported');
  const requestPayload = input.requestPayload && typeof input.requestPayload === 'object' ? input.requestPayload : {};
  const requestHash = hashRequest({ source: input.source, productId: input.productId || null, productName: input.productName, categorySlug: input.categorySlug, quantity, retailMinor: retailMinor.toString(), costMinor: costMinor.toString(), currency, provider: input.provider, requestPayload });
  const db = unwrapDb(input.db);
  if (db.__commerceMemory) {
    const state = memoryState(db); const replay = memoryReplay(state, { userId: input.userId, idempotencyKey: key }, requestHash); if (replay) return replay;
    const total = retailMinor * BigInt(quantity); normalizeMinor(total, 'total'); const balance = normalizeMinor(state.wallets.get(input.userId) || 0, 'wallet balance'); if (balance < total) fail(422, 'insufficient_balance', 'Insufficient wallet balance'); state.wallets.set(input.userId, money(balance - total));
    const meta = { orderId: null, userId: input.userId, source: input.source, idempotencyKey: key, requestHash, state: 'RESERVED', provider: input.provider, quantity, retailMinor: retailMinor.toString(), costMinor: costMinor.toString(), currency, requestPayload };
    const order = makeMemoryOrder(state, { ...input, productId: input.productId || `provider-${input.provider}`, productName: input.productName || input.provider, idempotencyKey: key, unitMinor: retailMinor, totalMinor: total, currency, status: 'PROCESSING', meta }); meta.orderId = order.id;
    return { order, replayed: false, record: externalRecord(meta) };
  }
  return retryDuplicate(() => txDb(db, async tx => {
    const replay = await idempotentSql(tx, { ...input, idempotencyKey: key }, requestHash); if (replay) return replay;
    let product = input.productId ? await legacyProductSql(tx, input.productId, true) : null;
    if (product && product.status !== 'ACTIVE') fail(409, 'product_unavailable', 'Product is unavailable');
    if (product && product.currency !== currency) fail(409, 'currency_mismatch', 'Product and order currencies do not match');
    if (!product) { product = { id: input.productId || id('provider_'), name: input.productName || input.provider, description: '', unitMinor: retailMinor, currency, status: 'ACTIVE', categorySlug: input.categorySlug === 'virtual-numbers' ? 'virtual-numbers' : 'logs' }; await ensureLegacyProduct(tx, product); }
    else { await ensureLegacyProduct(tx, { ...product, name: input.productName || product.name, unitMinor: retailMinor, currency, categorySlug: input.categorySlug === 'virtual-numbers' ? 'virtual-numbers' : 'logs' }); product.unitMinor = retailMinor; }
    const totalMinor = retailMinor * BigInt(quantity); normalizeMinor(totalMinor, 'total'); const walletId = await debitWallet(tx, input.userId, totalMinor, currency);
    const inserted = await insertOrderSql(tx, { ...input, idempotencyKey: key, productId: product.id, productName: product.name, quantity, unitMinor: retailMinor, totalMinor, walletId, currency, status: 'PROCESSING' });
    const meta = { orderId: inserted.orderId, userId: input.userId, source: input.source, idempotencyKey: key, requestHash, state: 'RESERVED', provider: input.provider, supplierKey: input.supplierKey || null, quantity, retailMinor: retailMinor.toString(), costMinor: costMinor.toString(), currency };
    await exec(tx, 'INSERT INTO ej_checkout_orders (order_id,user_id,source,idempotency_key,request_hash,provider,supplier_key,state,quantity,retail_minor,cost_minor,currency,request_payload,metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [inserted.orderId, input.userId, input.source, key, requestHash, input.provider, input.supplierKey || null, 'RESERVED', quantity, retailMinor.toString(), costMinor.toString(), currency, jsonValue(requestPayload), jsonValue(meta)]);
    const found = await findOrderSql(tx, inserted.orderId, input.userId); return { order: found.order, replayed: false, record: externalRecord(meta) };
  }));
}

async function getExternalOrder(orderId, options = {}) {
  const db = asSql(options.db);
  if (db.__commerceMemory) { const state = memoryState(db); const order = memoryFindOrder(state, orderId, options.userId); return order ? externalRecord(state.orderMeta.get(orderId), { includeSession: options.internal === true || Boolean(options.userId) }) : null; }
  const meta = await findMeta(db, orderId); if (!meta || (options.userId && meta.user_id !== options.userId)) return null;
  return externalRecord(meta, { includeSession: options.internal === true || Boolean(options.userId) });
}
async function claimExternalDispatch(orderId, db) {
  const database = unwrapDb(db);
  if (database.__commerceMemory) { const state = memoryState(database); const meta = state.orderMeta.get(orderId); if (!meta) return { claimed: false, record: null }; if (meta.state !== 'RESERVED') return { claimed: false, record: externalRecord(meta) }; meta.state = 'DISPATCHED'; return { claimed: true, record: externalRecord(meta) }; }
  return txDb(database, async tx => { const result = await exec(tx, "UPDATE ej_checkout_orders SET state='DISPATCHED',updated_at=CURRENT_TIMESTAMP(3) WHERE order_id=? AND state='RESERVED'", [orderId]); return { claimed: affected(result) === 1, record: externalRecord(await findMeta(tx, orderId)) }; });
}
function validateDelivery(delivery, quantity) {
  if (!Array.isArray(delivery) || delivery.length !== Number(quantity) || delivery.some(line => typeof line !== 'string' || !line.trim())) fail(409, 'delivery_count_mismatch', 'Delivery must contain one non-empty string per purchased unit');
}
async function completeExternalOrder(orderId, input = {}, db) {
  const database = unwrapDb(db || input.db); const desired = input.state === 'WAITING' ? 'WAITING' : 'COMPLETED';
  if (input.state !== undefined && !['WAITING', 'COMPLETED'].includes(input.state)) fail(400, 'invalid_state', 'Invalid external completion state');
  if (database.__commerceMemory) {
    const state = memoryState(database); const order = memoryFindOrder(state, orderId); const meta = state.orderMeta.get(orderId); if (!order || !meta) fail(404, 'not_found', 'Order not found');
    if (TERMINAL_EXTERNAL.has(meta.state) || TERMINAL_EXTERNAL.has(order.status)) fail(409, 'terminal_order', 'Terminal order cannot be changed');
    if (meta.state === 'COMPLETED') return { order };
    if (desired === 'COMPLETED' && meta.source === 'DONMARKETPLACE') validateDelivery(input.delivery, meta.quantity);
    if (input.delivery !== undefined) validateDelivery(input.delivery, meta.quantity);
    if (input.delivery !== undefined) meta.deliveryCiphertext = encryptPayload({ lines: input.delivery }, requireSecret());
    if (input.session !== undefined) meta.sessionCiphertext = encryptPayload(input.session, requireSecret());
    meta.providerRef = input.providerRef || meta.providerRef || null; meta.state = desired; order.status = desired === 'COMPLETED' ? 'COMPLETED' : 'PROCESSING'; return { order };
  }
  return txDb(database, async tx => {
    const meta = await findMeta(tx, orderId, true); const found = await findOrderSql(tx, orderId, null, true); if (!meta || !found) fail(404, 'not_found', 'Order not found');
    if (TERMINAL_EXTERNAL.has(meta.state) || TERMINAL_EXTERNAL.has(found.raw.status)) fail(409, 'terminal_order', 'Terminal order cannot be changed');
    if (meta.state === 'COMPLETED') return { order: found.order };
    if (desired === 'COMPLETED' && meta.source === 'DONMARKETPLACE') validateDelivery(input.delivery, meta.quantity);
    if (input.delivery !== undefined) validateDelivery(input.delivery, meta.quantity);
    const deliveryCipher = input.delivery === undefined ? null : encryptPayload({ lines: input.delivery }, requireSecret());
    const sessionCipher = input.session === undefined ? null : encryptPayload(input.session, requireSecret());
    await exec(tx, 'UPDATE ej_checkout_orders SET provider_ref=COALESCE(?,provider_ref),state=?,delivery_ciphertext=COALESCE(?,delivery_ciphertext),session_state_ciphertext=COALESCE(?,session_state_ciphertext),updated_at=CURRENT_TIMESTAMP(3) WHERE order_id=?', [input.providerRef || null, desired, deliveryCipher, sessionCipher, orderId]);
    await exec(tx, 'UPDATE `Order` SET status=?,updatedAt=CURRENT_TIMESTAMP(3) WHERE id=? AND status NOT IN (\'REFUNDED\',\'FAILED\')', [desired === 'COMPLETED' ? 'COMPLETED' : 'PROCESSING', orderId]);
    const updated = await findOrderSql(tx, orderId); return { order: updated.order };
  });
}
async function markExternalUncertain(orderId, input = {}, db) {
  const database = asSql(db || input.db);
  if (database.__commerceMemory) { const meta = memoryState(database).orderMeta.get(orderId); if (!meta) fail(404, 'not_found', 'Order not found'); if (!TERMINAL_EXTERNAL.has(meta.state) && meta.state !== 'COMPLETED') { meta.state = 'RECONCILIATION'; meta.uncertainCode = input.code || 'UNKNOWN'; meta.providerRef = input.providerRef || meta.providerRef || null; } return { record: externalRecord(meta) }; }
  await exec(database, "UPDATE ej_checkout_orders SET state='RECONCILIATION',uncertain_code=?,provider_ref=COALESCE(?,provider_ref),updated_at=CURRENT_TIMESTAMP(3) WHERE order_id=? AND state NOT IN ('REFUNDED','COMPLETED','FAILED')", [input.code || 'UNKNOWN', input.providerRef || null, orderId]);
  return { record: externalRecord(await findMeta(database, orderId)) };
}

function requireActorReason(input, repeat = false) {
  if (typeof input.actorId !== 'string' || !input.actorId.trim() || input.actorId.length > 191) fail(400, 'invalid_actor', 'A valid refund actor is required');
  if (!repeat && (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.trim().length > 500)) fail(400, 'invalid_reason', 'A refund reason is required');
  return repeat ? null : input.reason.trim();
}
async function refundSqlTx(tx, input, found, meta, trusted) {
  if (meta.source !== OWN && !trusted) fail(409, 'external_refund_unconfirmed', 'External refund requires trusted coordinator confirmation');
  const total = parseNaira(found.raw.total, 'order total', found.raw.currency); const orderCurrency = String(found.raw.currency || '').toUpperCase();
  const purchase = await q(tx, 'SELECT id,userId,amount,currency,reference,status FROM WalletTransaction WHERE reference=? AND type=\'PURCHASE_DEBIT\' FOR UPDATE', [found.raw.orderReference]);
  if (purchase.length !== 1) fail(409, 'ledger_conflict', 'Original purchase debit is missing or ambiguous');
  const debit = purchase[0]; if (debit.userId !== found.raw.userId || String(debit.currency).toUpperCase() !== orderCurrency || debit.status !== 'COMPLETED' || parseNaira(debit.amount, 'purchase debit', debit.currency) !== total) fail(409, 'ledger_conflict', 'Original purchase debit does not match the order');
  const reference = `REF-${found.raw.id}`; const existing = await q(tx, 'SELECT id,userId,amount,currency,reference,status FROM WalletTransaction WHERE reference=? AND type=\'REFUND\' FOR UPDATE', [reference]);
  const wallet = (await q(tx, 'SELECT id,balance,currency FROM Wallet WHERE userId=? FOR UPDATE', [found.raw.userId]))[0]; if (!wallet) fail(422, 'wallet_missing', 'Wallet is unavailable');
  if (String(wallet.currency).toUpperCase() !== orderCurrency) fail(409, 'currency_mismatch', 'Wallet and order currencies do not match');
  if (existing.length > 1) fail(409, 'ledger_conflict', 'Refund ledger is ambiguous');
  if (existing[0]) {
    const refund = existing[0]; if (refund.userId !== found.raw.userId || String(refund.currency).toUpperCase() !== orderCurrency || refund.status !== 'COMPLETED' || parseNaira(refund.amount, 'refund', refund.currency) !== total) fail(409, 'ledger_conflict', 'Existing refund ledger conflicts with the immutable order');
  } else {
    const balance = parseNaira(wallet.balance, 'wallet balance', wallet.currency); assertSafeAdd(balance, total, 'wallet balance');
    await exec(tx, 'UPDATE Wallet SET balance=balance+?,updatedAt=CURRENT_TIMESTAMP(3) WHERE id=?', [money(total), wallet.id]);
    await exec(tx, 'INSERT INTO WalletTransaction (id,walletId,userId,type,amount,currency,reference,status,description) VALUES (?,?,?,?,?,?,?,?,?)', [id('wtx_'), wallet.id, found.raw.userId, 'REFUND', money(total), orderCurrency, reference, 'COMPLETED', input.reason]);
  }
  const allocations = await q(tx, 'SELECT admin_unit_id,legacy_inventory_id FROM ej_checkout_allocations WHERE order_id=? FOR UPDATE', [input.orderId]);
  for (const a of allocations) { if (a.admin_unit_id) await exec(tx, "UPDATE ej_own_inventory_units SET status='QUARANTINED' WHERE id=? AND status IN ('SOLD','RESERVED','AVAILABLE')", [a.admin_unit_id]); if (a.legacy_inventory_id) await exec(tx, "UPDATE ProductInventory SET status='DISABLED' WHERE id=? AND status IN ('SOLD','RESERVED','AVAILABLE')", [a.legacy_inventory_id]); }
  await exec(tx, "UPDATE `Order` SET status='REFUNDED',updatedAt=CURRENT_TIMESTAMP(3) WHERE id=? AND status<>'REFUNDED'", [input.orderId]);
  await exec(tx, 'UPDATE ej_checkout_orders SET state=\'REFUNDED\',refund_reference=?,refund_reason=?,updated_at=CURRENT_TIMESTAMP(3) WHERE order_id=?', [reference, input.reason, input.orderId]);
  return { order: (await findOrderSql(tx, input.orderId)).order, replayed: Boolean(existing[0]) };
}
async function refundOrder(input = {}) {
  const database = unwrapDb(input.db); if (!input.orderId) fail(400, 'invalid_request', 'orderId is required');
  if (database.__commerceMemory) {
    const state = memoryState(database); const order = memoryFindOrder(state, input.orderId); const meta = state.orderMeta.get(input.orderId); if (!order || !meta) fail(404, 'not_found', 'Order not found');
    const repeat = order.status === 'REFUNDED'; if (repeat) { requireActorReason(input, true); return { order, replayed: true }; }
    const trusted = input.trustedCoordinator === true && input.providerRefundConfirmed === true; if (meta.source !== OWN && !trusted) fail(409, 'external_refund_unconfirmed', 'External refund requires trusted coordinator confirmation');
    const reason = requireActorReason(input, false);
    const total = parseNaira(order.total, 'order total', order.currency); const debit = state.ledger.find(x => x.reference === order.orderReference && x.type === 'PURCHASE_DEBIT'); if (!debit || debit.userId !== order.userId || debit.currency !== order.currency || parseNaira(debit.amount, 'purchase debit', debit.currency) !== total) fail(409, 'ledger_conflict', 'Original purchase debit does not match the immutable order');
    const reference = `REF-${order.id}`; const existing = state.ledger.find(x => x.reference === reference && x.type === 'REFUND'); if (existing && (existing.userId !== order.userId || existing.currency !== order.currency || parseNaira(existing.amount, 'refund', existing.currency) !== total)) fail(409, 'ledger_conflict', 'Existing refund ledger conflicts with the immutable order');
    if (!existing) { const balance = parseNaira(state.wallets.get(order.userId) || 0, 'wallet balance', order.currency); state.wallets.set(order.userId, money(assertSafeAdd(balance, total, 'wallet balance'))); state.ledger.push({ reference, type: 'REFUND', userId: order.userId, amount: money(total), currency: order.currency, status: 'COMPLETED', actorId: input.actorId, reason }); }
    for (const unit of state.inventory.values()) if (unit.orderId === order.id) unit.status = 'QUARANTINED';
    order.status = 'REFUNDED'; meta.state = 'REFUNDED'; meta.refundReference = reference; meta.refundReason = reason; return { order, replayed: Boolean(existing) };
  }
  if (!input.actorId) fail(400, 'invalid_actor', 'A valid refund actor is required');
  return txDb(database, async tx => {
    const found = await findOrderSql(tx, input.orderId, null, true); const meta = await findMeta(tx, input.orderId, true); if (!found || !meta) fail(404, 'not_found', 'Order not found');
    const repeat = found.raw.status === 'REFUNDED'; if (repeat) { requireActorReason(input, true); return { order: found.order, replayed: true }; }
    const trusted = input.trustedCoordinator === true && input.providerRefundConfirmed === true;
    if (meta.source !== OWN && !trusted) fail(409, 'external_refund_unconfirmed', 'External refund requires trusted coordinator confirmation');
    const reason = requireActorReason(input, false); return refundSqlTx(tx, { ...input, reason }, found, meta, trusted);
  });
}
async function failExternalOrder(orderId, input = {}, db) {
  const database = unwrapDb(db || input.db); const trusted = input.trustedCoordinator === true && input.knownBusinessFailure === true;
  const definitive = input.definitive === true && trusted;
  if (database.__commerceMemory) {
    const state = memoryState(database); const order = memoryFindOrder(state, orderId); const meta = state.orderMeta.get(orderId); if (!order || !meta) fail(404, 'not_found', 'Order not found');
    if (TERMINAL_EXTERNAL.has(meta.state) || order.status === 'REFUNDED') fail(409, 'terminal_order', 'Terminal order cannot be changed');
    if (!definitive) { meta.state = 'RECONCILIATION'; meta.uncertainCode = input.reason || 'BUSINESS_FAILURE_UNVERIFIED'; return { order, record: externalRecord(meta) }; }
    meta.state = 'FAILED'; order.status = 'FAILED';
    return { order, record: externalRecord(meta) };
  }
  return txDb(database, async tx => {
    const found = await findOrderSql(tx, orderId, null, true); const meta = await findMeta(tx, orderId, true); if (!found || !meta) fail(404, 'not_found', 'Order not found');
    if (TERMINAL_EXTERNAL.has(meta.state) || ['REFUNDED', 'FAILED'].includes(found.raw.status)) fail(409, 'terminal_order', 'Terminal order cannot be changed');
    if (!definitive) { await exec(tx, "UPDATE ej_checkout_orders SET state='RECONCILIATION',uncertain_code=?,updated_at=CURRENT_TIMESTAMP(3) WHERE order_id=?", [input.reason || 'BUSINESS_FAILURE_UNVERIFIED', orderId]); return { order: found.order, record: externalRecord(await findMeta(tx, orderId)) }; }
    await exec(tx, "UPDATE ej_checkout_orders SET state='FAILED',uncertain_code=?,updated_at=CURRENT_TIMESTAMP(3) WHERE order_id=?", [input.reason || 'BUSINESS_FAILURE', orderId]); await exec(tx, "UPDATE `Order` SET status='FAILED',updatedAt=CURRENT_TIMESTAMP(3) WHERE id=? AND status NOT IN ('REFUNDED','FAILED')", [orderId]);
    return { order: (await findOrderSql(tx, orderId)).order, record: externalRecord(await findMeta(tx, orderId)) };
  });
}
async function getOrderDelivery(input = {}) {
  if (typeof input.userId !== 'string' || !input.userId.trim()) fail(404, 'not_found', 'Order not found');
  const database = asSql(input.db);
  if (database.__commerceMemory) { const state = memoryState(database); const order = memoryFindOrder(state, input.orderId, input.userId); if (!order) fail(404, 'not_found', 'Order not found'); if (order.status !== 'COMPLETED') fail(409, 'delivery_unavailable', 'Delivery is unavailable for this order state'); const meta = state.orderMeta.get(order.id); return { orderId: order.id, status: order.status, lines: meta?.deliveryCiphertext ? decryptPayload(meta.deliveryCiphertext, requireSecret()).lines : [] }; }
  const found = await findOrderSql(database, input.orderId, input.userId); if (!found) fail(404, 'not_found', 'Order not found'); if (found.raw.status !== 'COMPLETED') fail(409, 'delivery_unavailable', 'Delivery is unavailable for this order state');
  const meta = await findMeta(database, input.orderId); if (!meta?.delivery_ciphertext) return { orderId: input.orderId, status: found.raw.status, lines: [] }; return { orderId: input.orderId, status: found.raw.status, lines: decryptPayload(meta.delivery_ciphertext, requireSecret()).lines };
}

module.exports = {
  createCheckout: async (input) => {
    try { return await createCheckout(input); }
    catch (e) {
      console.error('CHECKOUT FAILED', { code: e.code, message: e.message, sqlMessage: e.sqlMessage, sql: e.sql });
      throw e;
    }
  },
  reserveExternalOrder, claimExternalDispatch, getExternalOrder,
  completeExternalOrder, markExternalUncertain, failExternalOrder, refundOrder, getOrderDelivery,
  createMemoryCommerceDb, hashRequest, orderShape, itemShape, normalizeIdempotencyKey,
};