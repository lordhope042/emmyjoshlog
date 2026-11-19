'use strict';

const DON_BASE = 'https://donmarketplace.com/api/v1';
const FIVE_SIM_BASE = 'https://5sim.net';
const SMSBOWER_BASE = 'https://smsbower.page/stubs/handler_api.php';

function flag(value) { return value === true || value === '1' || value === 'true' || value === 'TRUE'; }
function positiveDecimal(value) {
  return typeof value === 'string' && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && !/^0+(?:\.0+)?$/.test(value);
}
function configuredMarkup(env, prefix) {
  const mode = String(env[`${prefix}_RETAIL_MODE`] || env[`${prefix}_MARKUP_MODE`] || '').toUpperCase();
  const value = env[`${prefix}_RETAIL_MARKUP`] ?? env[`${prefix}_MARKUP`] ?? env[`${prefix}_NGN_MARKUP`];
  if (!['FIXED', 'PERCENT'].includes(mode) || !positiveDecimal(String(value ?? ''))) return null;
  return { mode, value: String(value) };
}
function safeBase(value, fallback) {
  if (value === undefined || value === '') return fallback;
  try {
    const parsed = new URL(String(value));
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) return fallback;
    return String(value).replace(/\/+$/, '');
  } catch { return fallback; }
}
function donKeyForMode(env, mode) {
  const sharedKey = String(env.DONMARKETPLACE_API_KEY || '').trim();
  const sandboxKey = String(env.DONMARKETPLACE_SANDBOX_API_KEY || '').trim();
  if (mode === 'live') return /^(?:sk_live_|cp_live_)/.test(sharedKey) ? sharedKey : '';
  if (mode === 'sandbox') {
    if (/^sk_test_/.test(sandboxKey)) return sandboxKey;
    return /^sk_test_/.test(sharedKey) ? sharedKey : '';
  }
  return '';
}
function config(env = process.env) {
  const donMode = String(env.DONMARKETPLACE_MODE || 'sandbox').trim().toLowerCase();
  const donModeValid = donMode === 'sandbox' || donMode === 'live';
  const donKey = donKeyForMode(env, donMode);
  const provider = (number, label, tokenName, base, currencyName, rateName) => {
    const prefix = `PROVIDER${number}`;
    const token = String(env[tokenName] || '');
    const currency = typeof env[currencyName] === 'string' ? env[currencyName].trim().toUpperCase() : '';
    const rate = typeof env[rateName] === 'string' ? env[rateName].trim() : '';
    const markup = configuredMarkup(env, prefix);
    const enabled = flag(env[`${prefix}_ENABLED`]);
    const purchasesEnabled = flag(env[`${prefix}_PURCHASES_ENABLED`]);
    const ready = Boolean(token && /^[A-Z]{3}$/.test(currency) && positiveDecimal(rate) && markup && enabled);
    return { number, label, token, currency, rate, markup, enabled, purchasesEnabled, ready, base };
  };
  return {
    don: {
      label: 'Donmarketplace Logs', base: safeBase(env.DONMARKETPLACE_BASE_URL, DON_BASE), mode: donMode,
      modeValid: donModeValid, enabled: flag(env.DONMARKETPLACE_ENABLED) && donModeValid && Boolean(donKey),
      deliveryContractConfirmed: flag(env.DONMARKETPLACE_DELIVERY_CONTRACT_CONFIRMED),
      // Live mode is deliberately catalog-only for now. Supplier checkout remains sandbox-only.
      purchasesEnabled: donMode === 'sandbox' && flag(env.DONMARKETPLACE_PURCHASES_ENABLED) && flag(env.DONMARKETPLACE_DELIVERY_CONTRACT_CONFIRMED),
      keyConfigured: Boolean(donKey), key: donKey,
    },
    providers: {
      1: provider(1, 'Provider 1', 'PROVIDER1_5SIM_API_TOKEN', FIVE_SIM_BASE, 'PROVIDER1_CURRENCY', 'PROVIDER1_NGN_RATE'),
      2: provider(2, 'Provider 2', 'PROVIDER2_SMSBOWER_API_KEY', SMSBOWER_BASE, 'PROVIDER2_CURRENCY', 'PROVIDER2_NGN_RATE'),
    },
  };
}

module.exports = { config, flag, positiveDecimal, DON_BASE, FIVE_SIM_BASE, SMSBOWER_BASE, donKeyForMode };
