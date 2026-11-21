'use strict';

// Translates the MySQL-flavoured SQL used by the marketplace into PostgreSQL.
// It runs on every query that goes through the pool adapter (backend/db.js) and on raw SQL sent
// through Prisma, so the rest of the code can keep its existing query strings.
//
// What it converts (outside string literals and comments):
//   ?                          -> $1, $2, ...
//   `Name`                     -> "Name"
//   camelCase / Prisma tables  -> quoted, because PostgreSQL folds unquoted names to lower case
//   CURRENT_TIMESTAMP(3), NOW()-> LOCALTIMESTAMP(3)   (timestamps are stored as UTC without zone)
//   DATE_ADD / DATE_SUB(.., INTERVAL n UNIT)
//   INSERT IGNORE              -> INSERT ... ON CONFLICT DO NOTHING
//   LIKE                       -> ILIKE (MySQL's default collation is case-insensitive)
//   IFNULL                     -> COALESCE
//
// What it refuses, loudly, instead of guessing:
//   ON DUPLICATE KEY UPDATE, UPDATE ... JOIN, DELETE alias FROM ... JOIN.
//   Those must be rewritten by hand as ON CONFLICT / USING / sub-selects.

// Tables created by Prisma keep their exact (mixed-case) names in PostgreSQL.
const PRISMA_TABLES = new Set([
  'User', 'ProductCategory', 'Product', 'ProductInventory', 'VirtualAccount', 'Wallet',
  'WalletTransaction', 'Order', 'OrderItem', 'Payment', 'WebhookEvent', 'Notification',
  'SupportTicket', 'SupportMessage', 'AdminAuditLog',
]);

const cache = new Map();
const CACHE_LIMIT = 2000;

function splitSegments(sql) {
  const segments = [];
  let i = 0;
  let code = '';
  const flush = () => { if (code) { segments.push({ type: 'code', text: code }); code = ''; } };
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === "'") {
      flush();
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === '\\') { j += 2; continue; }
        if (sql[j] === "'") { if (sql[j + 1] === "'") { j += 2; continue; } break; }
        j += 1;
      }
      segments.push({ type: 'string', text: sql.slice(i, j + 1) });
      i = j + 1;
    } else if (ch === '"') {
      flush();
      const j = sql.indexOf('"', i + 1);
      const end = j === -1 ? sql.length - 1 : j;
      segments.push({ type: 'ident', text: sql.slice(i, end + 1) });
      i = end + 1;
    } else if (ch === '`') {
      flush();
      const j = sql.indexOf('`', i + 1);
      const end = j === -1 ? sql.length - 1 : j;
      segments.push({ type: 'backtick', text: sql.slice(i + 1, end) });
      i = end + 1;
    } else if (ch === '-' && next === '-') {
      flush();
      let j = sql.indexOf('\n', i);
      if (j === -1) j = sql.length;
      segments.push({ type: 'comment', text: sql.slice(i, j) });
      i = j;
    } else if (ch === '/' && next === '*') {
      flush();
      let j = sql.indexOf('*/', i + 2);
      j = j === -1 ? sql.length : j + 2;
      segments.push({ type: 'comment', text: sql.slice(i, j) });
      i = j;
    } else {
      code += ch;
      i += 1;
    }
  }
  flush();
  return segments;
}

function rewriteCode(text, state) {
  let out = text;
  if (/\bON\s+DUPLICATE\s+KEY\s+UPDATE\b/i.test(out)) throw new Error('SQL uses ON DUPLICATE KEY UPDATE; rewrite it as ON CONFLICT (...) DO UPDATE');
  if (/\bUPDATE\s+[A-Za-z_][\w]*(?:\s+(?:AS\s+)?[A-Za-z_][\w]*)?\s+(?:INNER\s+|LEFT\s+)?JOIN\b/i.test(out)) throw new Error('SQL uses UPDATE ... JOIN; rewrite it with UPDATE ... FROM or a sub-select');
  if (/\bDELETE\s+[A-Za-z_][\w]*\s+FROM\b/i.test(out)) throw new Error('SQL uses DELETE alias FROM ... JOIN; rewrite it with USING or a sub-select');

  out = out.replace(/\bINSERT\s+IGNORE\s+INTO\b/gi, () => { state.ignore = true; return 'INSERT INTO'; });
  out = out.replace(/\bCURRENT_TIMESTAMP\s*\(\s*3\s*\)/gi, 'LOCALTIMESTAMP(3)');
  out = out.replace(/\bNOW\s*\(\s*\)/gi, 'LOCALTIMESTAMP(3)');
  out = out.replace(/\bDATE_(ADD|SUB)\s*\(\s*([^,()]+(?:\([^()]*\))?)\s*,\s*INTERVAL\s+(\d+)\s+(SECOND|MINUTE|HOUR|DAY)S?\s*\)/gi,
    (_m, op, base, amount, unit) => `(${base.trim()} ${op.toUpperCase() === 'ADD' ? '+' : '-'} INTERVAL '${amount} ${unit.toLowerCase()}s')`);
  out = out.replace(/\bIFNULL\s*\(/gi, 'COALESCE(');
  out = out.replace(/\bLIKE\b/gi, 'ILIKE');
  out = out.replace(/\bNOT\s+ILIKE\b/gi, 'NOT ILIKE');

  // Quote names that PostgreSQL would otherwise fold to lower case.
  out = out.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (word) => {
    if (PRISMA_TABLES.has(word)) return `"${word}"`;
    if (/[a-z][A-Z]/.test(word)) return `"${word}"`;
    return word;
  });
  return out;
}

// MySQL FIELD(col, 'a', 'b') returns the 1-based position of col in the list. Used for custom ordering.
function rewriteField(sql) {
  return sql.replace(/\bFIELD\s*\(\s*([A-Za-z_][\w.]*)\s*((?:,\s*'(?:[^']|'')*')+)\s*\)/gi, (_m, column, list) => {
    const items = list.match(/'(?:[^']|'')*'/g) || [];
    return `(CASE ${column} ${items.map((item, index) => `WHEN ${item} THEN ${index + 1}`).join(' ')} ELSE 0 END)`;
  });
}

function toPostgres(sql) {
  const key = String(sql);
  if (cache.has(key)) return cache.get(key);
  const state = { ignore: false };
  let counter = 0;
  const rewritten = splitSegments(rewriteField(key)).map((segment) => {
    if (segment.type === 'code') return rewriteCode(segment.text, state);
    if (segment.type === 'backtick') return `"${segment.text}"`;
    return segment.text;
  });
  // Placeholders are numbered after the rewrite, in order of appearance.
  const final = splitSegments(rewritten.join('')).map((segment) => (
    segment.type === 'code' ? segment.text.replace(/\?/g, () => `$${++counter}`) : (segment.type === 'backtick' ? `"${segment.text}"` : segment.text)
  )).join('');
  const withIgnore = state.ignore ? `${final.replace(/[;\s]+$/, '')} ON CONFLICT DO NOTHING` : final;
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, withIgnore);
  return withIgnore;
}

// mysql2's query() expanded an array parameter into a comma-separated list, so `IN (?)` with an
// array worked. PostgreSQL needs one placeholder per value; this does the same expansion.
function expandArrayParams(sql, params) {
  if (!Array.isArray(params) || !params.some((value) => Array.isArray(value))) return { sql, params };
  let index = 0;
  const values = [];
  const out = splitSegments(String(sql)).map((segment) => {
    if (segment.type === 'string') return segment.text;
    if (segment.type === 'ident') return segment.text;
    if (segment.type === 'backtick') return `\`${segment.text}\``;
    if (segment.type === 'comment') return segment.text;
    return segment.text.replace(/\?/g, () => {
      const value = params[index++];
      if (Array.isArray(value)) {
        if (!value.length) return 'NULL';
        values.push(...value);
        return value.map(() => '?').join(', ');
      }
      values.push(value);
      return '?';
    });
  }).join('');
  if (values.length > 60000) throw new Error('Too many query parameters for one statement');
  return { sql: out, params: values };
}

module.exports = { toPostgres, splitSegments, expandArrayParams, PRISMA_TABLES };
