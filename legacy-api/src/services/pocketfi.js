'use strict';

const { toPostgres } = require('../../../backend/sql-translate');
const crypto = require('node:crypto');

const OFFICIAL_LIVE_BASE = 'https://api.pocketfi.ng/api/v1';
const OFFICIAL_SANDBOX_BASE = 'https://api.pocketfi.ng/api/test';
const BANKS = new Set(['saveheaven', 'paga', 'kuda', '9psb', 'palmpay']);
const OPERATION_STATES = new Set(['REQUESTED', 'DISPATCHED', 'UNKNOWN', 'SUCCEEDED']);

function pocketfiConfig(overrides = {}) {
  const env = overrides.env || process.env;
  const mode = String(overrides.mode || env.POCKETFI_MODE || 'sandbox').trim().toLowerCase();
  const configuredBase = overrides.baseUrl !== undefined
    ? overrides.baseUrl
    : (env.POCKETFI_BASE_URL || '');
  const baseUrl = String(configuredBase || (mode === 'live' ? OFFICIAL_LIVE_BASE : OFFICIAL_SANDBOX_BASE)).replace(/\/+$/, '');
  const bank = String(overrides.bank || env.POCKETFI_BANK || 'kuda').trim().toLowerCase();
  const creditBasis = String(overrides.creditBasis || env.POCKETFI_CREDIT_BASIS || 'settlement').trim().toLowerCase();
  const signatureHeader = String(overrides.signatureHeader || env.POCKETFI_SIGNATURE_HEADER || 'http_pocketfi_signature').trim().toLowerCase();
  return {
    mode,
    baseUrl,
    // PocketFi has no separate API token. The public key (the "id|token" value)
    // is the Bearer token for API calls; the secret key is the HMAC key for
    // webhook signatures.
    secretKey: String(overrides.secretKey !== undefined ? overrides.secretKey : (env.POCKETFI_SECRET_KEY || '')).trim(),
    publicKey: String(overrides.publicKey !== undefined ? overrides.publicKey : (env.POCKETFI_PUBLIC_KEY || '')).trim(),
    businessId: String(overrides.businessId !== undefined ? overrides.businessId : (env.POCKETFI_BUSINESS_ID || '')).trim(),
    bank,
    enabled: overrides.enabled !== undefined ? Boolean(overrides.enabled) : env.POCKETFI_ENABLED === 'true',
    transferEventsConfirmed: overrides.transferEventsConfirmed !== undefined
      ? Boolean(overrides.transferEventsConfirmed)
      : env.POCKETFI_TRANSFER_EVENTS_CONFIRMED === 'true',
    creditBasis,
    signatureHeader,
  };
}

function invalid(message, status = 500, code = 'POCKETFI_CONFIGURATION_ERROR') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function reconciliationError(state = 'UNKNOWN', cause) {
  const error = invalid('PocketFi account creation requires reconciliation before retrying', 409, 'POCKETFI_RECONCILIATION_REQUIRED');
  error.reconciliationRequired = true;
  error.operationState = state;
  if (cause) error.cause = cause;
  return error;
}

function decimalToMinor(value, { allowZero = false } = {}) {
  const text = typeof value === 'number' ? String(value) : String(value ?? '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error('Invalid NGN decimal');
  const [whole, fraction = ''] = text.split('.');
  const minor = BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
  if (!allowZero && minor <= 0n) throw new Error('Amount must be positive');
  return minor;
}

function minorToDecimal(minor) {
  const value = typeof minor === 'bigint' ? minor : BigInt(String(minor));
  if (value < 0n) throw new Error('Minor amount cannot be negative');
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
}

function hashFingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function randomOperationId() {
  return `pfiop_${crypto.randomBytes(24).toString('hex')}`;
}

function assertProviderConfig(config) {
  if (!config.enabled) throw invalid('PocketFi virtual accounts are disabled', 503, 'POCKETFI_DISABLED');
  if (!config.publicKey || !config.secretKey || !config.businessId) {
    throw invalid('PocketFi is not configured', 503, 'POCKETFI_NOT_CONFIGURED');
  }
  let url;
  try { url = new URL(config.baseUrl); } catch { throw invalid('PocketFi base URL is invalid', 503, 'POCKETFI_BASE_URL_INVALID'); }
  if (!['sandbox', 'live'].includes(config.mode) || url.protocol !== 'https:' || url.hostname !== 'api.pocketfi.ng' || url.username || url.password || url.search || url.hash || url.port || url.pathname !== (config.mode === 'live' ? '/api/v1' : '/api/test')) throw invalid('PocketFi URL must match its official sandbox/live environment', 503, 'POCKETFI_BASE_URL_INVALID');
  if (!BANKS.has(config.bank)) throw invalid('Configured PocketFi bank is not supported', 503, 'POCKETFI_BANK_INVALID');
  // The account endpoint requires NIN and BVN for Palmpay. This customer API
  // intentionally has no KYC collection fields, so it must never fabricate or
  // silently select that bank.
  if (config.bank === 'palmpay') throw invalid('Palmpay requires NIN and BVN and is disabled for this endpoint', 503, 'POCKETFI_PALMPAY_KYC_REQUIRED');
  if (!['settlement', 'gross'].includes(config.creditBasis)) throw invalid('POCKETFI_CREDIT_BASIS must be settlement or gross', 503, 'POCKETFI_CREDIT_BASIS_INVALID');
}

function splitName(user) {
  const first = typeof user.firstName === 'string' ? user.firstName.trim() : '';
  const last = typeof user.lastName === 'string' ? user.lastName.trim() : '';
  if (first && last) return { firstName: first, lastName: last };
  const fullName = String(user.fullName || '').trim().replace(/\s+/g, ' ');
  const parts = fullName.split(' ');
  if (parts.length < 2 || !parts[0] || !parts.slice(1).join(' ')) throw invalid('A first and last name are required for PocketFi', 422, 'POCKETFI_NAME_REQUIRED');
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

async function rawRows(db, sql, ...params) {
  if (!db || typeof db.$queryRawUnsafe !== 'function') throw new Error('PocketFi database adapter must provide $queryRawUnsafe');
  return db.$queryRawUnsafe(toPostgres(sql), ...params);
}

async function rawExecute(db, sql, ...params) {
  if (!db || typeof db.$executeRawUnsafe !== 'function') throw new Error('PocketFi database adapter must provide $executeRawUnsafe');
  return db.$executeRawUnsafe(toPostgres(sql), ...params);
}

async function inPrismaTransaction(db, callback) {
  if (!db || typeof db.$transaction !== 'function') throw new Error('PocketFi database adapter must provide $transaction');
  return db.$transaction(callback);
}

async function findOperation(db, userId, forUpdate = false) {
  const rows = await rawRows(db, `SELECT operation_id, user_id, state, bank, request_fingerprint, provider_http_status, error_code FROM ej_pocketfi_operations WHERE user_id = ?${forUpdate ? ' FOR UPDATE' : ''}`, userId);
  return rows[0] || null;
}

async function reserveOperation(db, { userId, bank, requestFingerprint }) {
  return inPrismaTransaction(db, async (tx) => {
    const account = await tx.virtualAccount.findUnique({ where: { userId } });
    if (account) return { account, operation: null, shouldDispatch: false };

    const operationId = randomOperationId();
    await rawExecute(tx, `INSERT IGNORE INTO ej_pocketfi_operations (operation_id, user_id, state, bank, request_fingerprint) VALUES (?, ?, 'REQUESTED', ?, ?)`, operationId, userId, bank, requestFingerprint);
    const operation = await findOperation(tx, userId, true);
    if (!operation) throw new Error('PocketFi operation could not be persisted');
    return { account: null, operation, shouldDispatch: operation.operation_id === operationId && operation.state === 'REQUESTED' };
  });
}

async function claimDispatch(db, operationId) {
  const affected = await rawExecute(db, `UPDATE ej_pocketfi_operations SET state = 'DISPATCHED', updated_at = CURRENT_TIMESTAMP(3) WHERE operation_id = ? AND state = 'REQUESTED'`, operationId);
  if (Number(affected) === 1) return true;
  const rows = await rawRows(db, 'SELECT state FROM ej_pocketfi_operations WHERE operation_id = ?', operationId);
  const state = rows[0]?.state;
  if (!OPERATION_STATES.has(state)) throw new Error('Invalid PocketFi operation state');
  return false;
}

async function updateOperation(db, operationId, state, fields = {}) {
  if (!OPERATION_STATES.has(state)) throw new Error('Invalid PocketFi operation state');
  await rawExecute(db, `UPDATE ej_pocketfi_operations SET state = ?, provider_http_status = ?, error_code = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE operation_id = ?`, state, fields.providerHttpStatus ?? null, fields.errorCode ?? null, operationId);
}

async function responseJson(response) {
  if (response?.body?.[Symbol.asyncIterator]) {
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk); size += bytes.length;
      if (size > 1024 * 1024) throw invalid('PocketFi response exceeded its size limit', 502, 'POCKETFI_INVALID_RESPONSE');
      chunks.push(bytes);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw invalid('PocketFi returned invalid JSON', 502, 'POCKETFI_INVALID_RESPONSE'); }
  }
  if (response && typeof response.text === 'function') {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > 1024 * 1024) throw invalid('PocketFi response exceeded its size limit', 502, 'POCKETFI_INVALID_RESPONSE');
    try { return text ? JSON.parse(text) : {}; } catch { throw invalid('PocketFi returned invalid JSON', 502, 'POCKETFI_INVALID_RESPONSE'); }
  }
  if (response && typeof response.json === 'function') return response.json();
  throw invalid('PocketFi returned no response body', 502, 'POCKETFI_INVALID_RESPONSE');
}

function accountFromResponse(data, bank) {
  if (!data || data.status !== true || !Array.isArray(data.banks)) throw invalid('PocketFi account response did not match the documented shape', 502, 'POCKETFI_RESPONSE_INVALID');
  const bankResult = data.banks.find((item) => String(item?.bankName || '').trim().toLowerCase() === bank);
  if (!bankResult || !String(bankResult.accountNumber || '').trim() || !String(bankResult.accountName || '').trim()) {
    throw invalid('PocketFi account response did not include the configured bank account', 502, 'POCKETFI_RESPONSE_INVALID');
  }
  return {
    providerCustomerReference: null,
    providerAccountReference: null,
    accountNumber: String(bankResult.accountNumber).trim(),
    bankName: String(bankResult.bankName).trim(),
    accountName: String(bankResult.accountName).trim(),
  };
}

async function callCreateAccount(config, body, fetchImpl) {
  const response = await fetchImpl(`${config.baseUrl}/virtual-accounts/create`, {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.publicKey}`,
    },
    body: JSON.stringify(body),
  });
  if (Number(response.headers?.get?.('content-length') || 0) > 1024 * 1024) throw invalid('PocketFi response exceeded its size limit', 502, 'POCKETFI_INVALID_RESPONSE');
  const data = await responseJson(response);
  if (!response.ok) {
    const error = invalid('PocketFi virtual-account creation failed', 502, 'POCKETFI_PROVIDER_ERROR');
    error.providerHttpStatus = Number(response.status) || null;
    error.providerMessage = String(data?.message || data?.error || '').slice(0, 300);
    throw error;
  }
  return accountFromResponse(data, config.bank);
}

async function createDedicatedAccount({ user, fullName, email, phoneNumber, reference, db, fetchImpl, config: overrides } = {}) {
  const cfg = pocketfiConfig(overrides || {});
  assertProviderConfig(cfg);
  const customer = user || { fullName, email, phoneNumber, id: reference };
  const userId = String(customer.id || reference || '').trim();
  if (!userId) throw invalid('PocketFi account creation requires a customer id', 422, 'POCKETFI_USER_REQUIRED');
  const names = splitName(customer);
  const phone = String(phoneNumber || customer.phoneNumber || '').trim();
  const customerEmail = String(email || customer.email || '').trim().toLowerCase();
  if (!phone || !customerEmail) throw invalid('PocketFi account creation requires customer phone and email', 422, 'POCKETFI_CONTACT_REQUIRED');
  if (!db) throw invalid('PocketFi account creation requires the application database', 500, 'POCKETFI_DATABASE_REQUIRED');

  const body = {
    first_name: names.firstName,
    last_name: names.lastName,
    phone,
    email: customerEmail,
    businessId: cfg.businessId,
    bank: cfg.bank,
  };
  const requestFingerprint = hashFingerprint(body);
  const reserved = await reserveOperation(db, { userId, bank: cfg.bank, requestFingerprint });
  if (reserved.account) return reserved.account;
  const operation = reserved.operation;
  if (!operation) throw new Error('PocketFi operation missing');
  if (operation.state === 'SUCCEEDED') throw reconciliationError(operation.state);
  if (operation.state !== 'REQUESTED' || !reserved.shouldDispatch) throw reconciliationError(operation.state);

  const claimed = await claimDispatch(db, operation.operation_id);
  if (!claimed) {
    const current = await findOperation(db, userId);
    throw reconciliationError(current?.state || 'UNKNOWN');
  }

  let result;
  try {
    result = await callCreateAccount(cfg, body, fetchImpl || globalThis.fetch);
  } catch (error) {
    console.error('[pocketfi] create account failed:', error.code || 'POCKETFI_TRANSPORT_UNKNOWN', error.providerHttpStatus || '', error.providerMessage || error.message);
    await updateOperation(db, operation.operation_id, 'UNKNOWN', { providerHttpStatus: error.providerHttpStatus, errorCode: error.code || 'POCKETFI_TRANSPORT_UNKNOWN' });
    throw reconciliationError('UNKNOWN', error);
  }

  try {
    return await inPrismaTransaction(db, async (tx) => {
      const existing = await tx.virtualAccount.findUnique({ where: { userId } });
      if (existing) {
        await updateOperation(tx, operation.operation_id, 'SUCCEEDED');
        return existing;
      }
      const account = await tx.virtualAccount.create({
        data: {
          userId,
          provider: 'pocketfi',
          providerCustomerReference: result.providerCustomerReference,
          providerAccountReference: result.providerAccountReference,
          accountNumber: result.accountNumber,
          bankName: result.bankName,
          accountName: result.accountName,
          phoneNumber: phone,
          currency: 'NGN',
          status: 'ACTIVE',
        },
      });
      await updateOperation(tx, operation.operation_id, 'SUCCEEDED');
      await tx.notification.create({
        data: {
          userId,
          type: 'SECURITY',
          title: 'Virtual account created',
          body: `Your dedicated ${account.bankName} account is ready. Incoming transfers must be verified before your wallet is credited.`,
        },
      });
      return account;
    });
  } catch (error) {
    try { await updateOperation(db, operation.operation_id, 'UNKNOWN', { errorCode: 'POCKETFI_PERSISTENCE_UNKNOWN' }); } catch {}
    throw reconciliationError('UNKNOWN', error);
  }
}

function verifyWebhookSignature(rawBody, signatureHeader, overrides = {}) {
  const cfg = pocketfiConfig(overrides);
  const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ''), 'utf8');
  const supplied = String(signatureHeader || '').trim();
  if (!cfg.secretKey || !/^[0-9a-f]{128}$/i.test(supplied)) return false;
  const expected = crypto.createHmac('sha512', cfg.secretKey).update(raw).digest();
  const received = Buffer.from(supplied, 'hex');
  return received.length === expected.length && crypto.timingSafeEqual(expected, received);
}

function sanitizeWebhookPayload(event) {
  const order = event?.order || {};
  const transaction = event?.transaction || {};
  const customer = event?.customer || {};
  return {
    order: {
      amount: order.amount ?? null,
      settlement_amount: order.settlement_amount ?? null,
      fee: order.fee ?? null,
    },
    transaction: { reference: transaction.reference ?? null },
    account_number: event?.account_number ?? null,
    customer: { businessId: customer.businessId ?? null },
  };
}

function parseWebhookTransfer(event) {
  const order = event?.order;
  const transaction = event?.transaction;
  const businessId = event?.customer?.businessId;
  const providerReference = typeof transaction?.reference === 'string' ? transaction.reference.trim() : '';
  const accountNumber = typeof event?.account_number === 'string' ? event.account_number.trim() : '';
  if (!order || typeof order !== 'object' || !transaction || typeof transaction !== 'object' || !providerReference || !accountNumber || businessId === undefined || businessId === null) {
    throw invalid('PocketFi webhook does not match the documented transfer shape', 422, 'POCKETFI_WEBHOOK_SHAPE_INVALID');
  }
  let grossMinor;
  let settlementMinor;
  let feeMinor;
  try {
    grossMinor = decimalToMinor(order.amount);
    settlementMinor = decimalToMinor(order.settlement_amount);
    feeMinor = decimalToMinor(order.fee, { allowZero: true });
  } catch {
    throw invalid('PocketFi webhook amount fields are invalid', 422, 'POCKETFI_WEBHOOK_AMOUNT_INVALID');
  }
  if (settlementMinor > grossMinor || feeMinor > grossMinor) throw invalid('PocketFi webhook amount relationship is invalid', 422, 'POCKETFI_WEBHOOK_AMOUNT_INVALID');
  return {
    providerReference,
    accountNumber,
    businessId: String(businessId),
    grossMinor,
    settlementMinor,
    feeMinor,
  };
}

function webhookDetailsMatch(meta, transfer, userId) {
  return Boolean(meta && String(meta.account_number || '') === transfer.accountNumber && String(meta.business_id || '') === transfer.businessId && String(meta.user_id || '') === String(userId) && String(meta.amount_minor || '') === transfer.creditMinor);
}

module.exports = {
  BANKS,
  OFFICIAL_LIVE_BASE,
  OFFICIAL_SANDBOX_BASE,
  OPERATION_STATES,
  pocketfiConfig,
  createDedicatedAccount,
  createPocketFiService: (options = {}) => ({
    config: pocketfiConfig(options.config || options),
    createDedicatedAccount: (args) => createDedicatedAccount({ ...args, fetchImpl: options.fetchImpl, config: options.config || options }),
    verifyWebhookSignature: (rawBody, signature) => verifyWebhookSignature(rawBody, signature, options.config || options),
  }),
  verifyWebhookSignature,
  decimalToMinor,
  minorToDecimal,
  sanitizeWebhookPayload,
  parseWebhookTransfer,
  webhookDetailsMatch,
};