'use strict';

const crypto = require('node:crypto');
const { getPool } = require('../db');

function databaseOf(db) { return db || getPool(); }
async function rows(db, sql, params = []) { const result = await databaseOf(db).query(sql, params); return result[0]; }
function quoteId() { return `eq_${crypto.randomBytes(18).toString('base64url')}`; }
function normalizeQuote(row) {
  if (!row) return null;
  let selection = row.selection_json;
  if (typeof selection === 'string') { try { selection = JSON.parse(selection); } catch { selection = {}; } }
  return { ...row, id: row.quote_id, quoteId: row.quote_id, selection: selection || {}, costMinor: String(row.cost_minor), retailMinor: String(row.retail_minor), currency: row.currency, expiresAt: new Date(row.expires_at).toISOString() };
}
async function createQuote(db, input, ttlSeconds = 300) {
  const id = quoteId();
  const expires = new Date(Date.now() + Math.max(30, Math.min(Number(ttlSeconds) || 300, 900)) * 1000);
  await databaseOf(db).query('INSERT INTO ej_provider_quotes (quote_id, user_id, provider, kind, product_id, selection_json, cost_minor, retail_minor, currency, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, input.userId || null, input.provider, input.kind, String(input.productId), JSON.stringify(input.selection || {}), String(input.costMinor), String(input.retailMinor), input.currency, expires]);
  return normalizeQuote({ quote_id: id, user_id: input.userId || null, provider: input.provider, kind: input.kind, product_id: String(input.productId), selection_json: JSON.stringify(input.selection || {}), cost_minor: String(input.costMinor), retail_minor: String(input.retailMinor), currency: input.currency, expires_at: expires });
}
// Quote rows are short-lived. Expired rows are deleted in small batches now and then so the
// table cannot grow without bound (no scheduled job required).
async function purgeExpiredQuotes(db) {
  try { await databaseOf(db).query('DELETE FROM ej_provider_quotes WHERE expires_at < (CURRENT_TIMESTAMP(3) - INTERVAL 1 HOUR) LIMIT 1000'); } catch { /* best effort */ }
}
// Creates many quotes with a few multi-row INSERTs instead of one query per quote.
async function createQuotes(db, inputs, ttlSeconds = 300) {
  if (!inputs.length) return [];
  if (Math.random() < 0.05) await purgeExpiredQuotes(db);
  const expires = new Date(Date.now() + Math.max(30, Math.min(Number(ttlSeconds) || 300, 900)) * 1000);
  const created = inputs.map((input) => ({ id: quoteId(), input }));
  for (let start = 0; start < created.length; start += 200) {
    const chunk = created.slice(start, start + 200);
    const params = [];
    for (const { id, input } of chunk) params.push(id, input.userId || null, input.provider, input.kind, String(input.productId), JSON.stringify(input.selection || {}), String(input.costMinor), String(input.retailMinor), input.currency, expires);
    await databaseOf(db).query(`INSERT INTO ej_provider_quotes (quote_id, user_id, provider, kind, product_id, selection_json, cost_minor, retail_minor, currency, expires_at) VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`, params);
  }
  return created.map(({ id, input }) => normalizeQuote({ quote_id: id, user_id: input.userId || null, provider: input.provider, kind: input.kind, product_id: String(input.productId), selection_json: JSON.stringify(input.selection || {}), cost_minor: String(input.costMinor), retail_minor: String(input.retailMinor), currency: input.currency, expires_at: expires }));
}
async function findQuote(db, id, userId, kind) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) return null;
  const params = [id, userId];
  let sql = 'SELECT * FROM ej_provider_quotes WHERE quote_id = ? AND user_id = ? AND expires_at > CURRENT_TIMESTAMP(3)';
  if (kind) { sql += ' AND kind = ?'; params.push(kind); }
  const result = await rows(db, sql, params);
  return normalizeQuote(result[0]);
}
module.exports = { createQuote, createQuotes, findQuote, normalizeQuote, quoteId, purgeExpiredQuotes };
