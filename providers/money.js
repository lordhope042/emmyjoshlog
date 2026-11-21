'use strict';

function decimalParts(value) {
  const text = String(value);
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) throw new Error('Provider amount is invalid');
  const [whole, fraction = ''] = text.split('.');
  return { digits: BigInt(`${whole}${fraction}`), scale: fraction.length };
}
function ceilProviderToMinor(amount, rate) {
  const a = decimalParts(amount); const r = decimalParts(rate);
  const numerator = a.digits * r.digits * 100n;
  const denominator = 10n ** BigInt(a.scale + r.scale);
  return (numerator + denominator - 1n) / denominator;
}
function retailFromMarkup(costMinor, markup) {
  const cost = BigInt(costMinor);
  const value = decimalParts(markup.value);
  if (markup.mode === 'FIXED') return cost + (value.digits * 100n) / (10n ** BigInt(value.scale));
  if (markup.mode === 'PERCENT') {
    const denominator = 100n * 10n ** BigInt(value.scale);
    return cost + ((cost * value.digits + denominator - 1n) / denominator);
  }
  throw new Error('Provider markup mode is invalid');
}
function asPositiveMinor(value) { const n = BigInt(value); if (n <= 0n) throw new Error('Price must be positive'); return n; }
function jsonSafeMinor(value) { return String(BigInt(value)); }
function opaqueSelection(selection) { return Object.fromEntries(Object.entries(selection || {}).filter(([key, value]) => !/key|token|secret|password/i.test(key) && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'))); }
module.exports = { decimalParts, ceilProviderToMinor, retailFromMarkup, asPositiveMinor, jsonSafeMinor, opaqueSelection };
