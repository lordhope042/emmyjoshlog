'use strict';

const router = require('express').Router();
const crypto = require('node:crypto');
const express = require('express');
const prisma = require('../db');
const pocketfi = require('../services/pocketfi');

// POCKETFI_SIGNATURE_HEADER may be written PHP-style (http_pocketfi_signature) but Node
// exposes the real header lowercased with dashes (pocketfi-signature). Accept both forms.
function signatureFrom(headers, configured) {
  const given = String(configured || '').trim().toLowerCase();
  const normalized = given.replace(/^http_/, '').replace(/_/g, '-');
  for (const name of [given, normalized, 'pocketfi-signature', 'x-pocketfi-signature', 'x-signature', 'signature']) {
    const value = name ? headers[name] : undefined;
    if (typeof value === 'string' && value.trim()) return { name, value };
  }
  // Last resort: any header with "signature" in its name.
  for (const [name, value] of Object.entries(headers)) {
    if (/signature/i.test(name) && typeof value === 'string' && value.trim()) return { name, value };
  }
  return { name: '', value: '' };
}

// What PocketFi may have signed. Every candidate must still pass the HMAC check, so adding forms here never
// weakens security: only the holder of the secret can produce a matching signature.
//   raw       the exact bytes received
//   compact   the same JSON with no whitespace (PocketFi sends pretty-printed JSON, which suggests the
//             signature may be computed over the compact form)
//   php       compact with escaped slashes / \uXXXX, as PHP's json_encode writes by default
// If a parser upstream already consumed the stream, only the parsed object is left, so it is re-serialised.
function phpEscape(json) {
  return json
    .replace(/\//g, '\\/')
    .replace(/[\u0080-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function candidateBodies(req) {
  const list = [];
  let raw = null;
  if (Buffer.isBuffer(req.body) && req.body.length) raw = req.body;
  else if (Buffer.isBuffer(req.rawBody) && req.rawBody.length) raw = req.rawBody;
  else if (typeof req.rawBody === 'string' && req.rawBody) raw = Buffer.from(req.rawBody, 'utf8');
  if (raw) list.push(['raw', raw]);

  let parsed = null;
  if (raw) {
    try { parsed = JSON.parse(raw.toString('utf8')); } catch { parsed = null; }
  } else if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) && Object.keys(req.body).length) {
    parsed = req.body;
  }
  if (parsed && typeof parsed === 'object') {
    const compact = JSON.stringify(parsed);
    list.push(['compact', Buffer.from(compact, 'utf8')]);
    list.push(['php', Buffer.from(phpEscape(compact), 'utf8')]);
  }
  return list;
}

// Diagnostic only: which configured credential (if any) produces the signature that arrived.
// Only names are returned, never values, and nothing here is ever accepted as valid.
function keyDiagnostics(candidates, signature, cfg) {
  const given = (signature || '').trim().replace(/^sha512\s*[=:]\s*/i, '').toLowerCase();
  const keys = {
    secretKey: cfg.secretKey,
    webhookSecret: cfg.webhookSecret,
    publicKey: cfg.publicKey,
    publicKeyToken: String(cfg.publicKey || '').split('|').pop(),
    businessId: cfg.businessId,
  };
  const matches = [];
  for (const [kind, body] of candidates) {
    for (const [name, key] of Object.entries(keys)) {
      if (!key) continue;
      const digest = crypto.createHmac('sha512', key).update(body).digest('hex');
      if (digest === given) matches.push(`${name}@${kind}`);
    }
  }
  return matches;
}

function eventIdFor(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function providerError(error) {
  return error && (error.code === 'P2002' || error.code === 'P2003');
}

function decimalString(value) {
  if (value && typeof value.toString === 'function') return value.toString();
  return String(value);
}

function paymentMeta(payment) {
  const raw = payment?.rawEvent;
  return raw && typeof raw === 'object' ? (raw.pocketfi || raw) : null;
}

function samePaymentDetails(payment, transfer, userId) {
  const meta = paymentMeta(payment);
  return Boolean(
    payment && payment.status === 'SUCCESS' &&
    meta && String(meta.account_number || '') === transfer.accountNumber &&
    String(meta.business_id || '') === transfer.businessId &&
    String(meta.user_id || '') === String(userId) &&
    String(meta.amount_minor || '') === transfer.creditDecimal,
  );
}

async function findEvent(eventId) {
  return prisma.webhookEvent.findUnique({ where: { eventId } });
}

async function storeOrResumeEvent(eventId, safePayload) {
  try {
    return { event: await prisma.webhookEvent.create({
      data: {
        eventId,
        type: 'pocketfi.transfer',
        status: 'RECEIVED',
        payload: safePayload,
      },
    }), created: true };
  } catch (error) {
    if (!providerError(error)) throw error;
    const event = await findEvent(eventId);
    if (!event) throw error;
    return { event, created: false };
  }
}

async function setEvent(eventId, status) {
  return prisma.webhookEvent.update({
    where: { eventId },
    data: { status, processedAt: new Date() },
  });
}

function retained(res, reason) {
  return res.status(200).json({
    message: 'success',
    credited: false,
    reconciliationRequired: true,
    reason,
  });
}

// This route is mounted before the legacy JSON parser. Signature verification
// always uses the exact bytes received from PocketFi, including in development.
router.post('/pocketfi', express.raw({ type: () => true, limit: '100kb' }), async (req, res) => {
  const cfg = pocketfi.pocketfiConfig();
  const sig = signatureFrom(req.headers, cfg.signatureHeader);
  const candidates = candidateBodies(req);
  const verified = candidates.find(([, body]) => pocketfi.verifyWebhookSignature(body, sig.value, cfg));
  if (!verified) {
    // Never log secrets, signatures or bodies: only shapes, so the cause can be told from the logs.
    console.warn('[pocketfi] webhook rejected (invalid signature).', JSON.stringify({
      signatureHeader: sig.name || null,
      signatureLength: sig.value.length,
      contentType: req.headers['content-type'] || null,
      bodySource: candidates.map(([kind, body]) => `${kind}:${body.length}B`),
      keyMatchesSignature: keyDiagnostics(candidates, sig.value, cfg),
      secretConfigured: Boolean(cfg.webhookSecret || cfg.secretKey),
      secretLength: (cfg.webhookSecret || cfg.secretKey).length,
      headerNames: sig.name ? undefined : Object.keys(req.headers),
    }));
    return res.status(400).json({ message: 'Invalid signature' });
  }
  const raw = verified[1];

  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    return res.status(400).json({ message: 'Invalid JSON' });
  }

  const eventId = eventIdFor(raw);
  const safePayload = pocketfi.sanitizeWebhookPayload(payload);
  let eventRecord;
  try {
    eventRecord = await storeOrResumeEvent(eventId, safePayload);
  } catch (error) {
    console.error('PocketFi webhook event storage failed', (/^[A-Z0-9_]{1,50}$/.test(String(error.code || '')) ? error.code : 'PROCESSING_FAILED'));
    return res.status(500).json({ message: 'Event storage failed' });
  }

  // Only PROCESSED is a duplicate. FAILED events are deliberately resumed so
  // a provider retry can finish after a rolled-back transaction.
  if (!eventRecord.created && eventRecord.event.status === 'PROCESSED') {
    return res.status(200).json({ message: 'success', duplicate: true });
  }
  if (!eventRecord.created && eventRecord.event.status === 'CONFLICT') {
    return retained(res, 'provider_reference_conflict');
  }

  let transfer;
  try {
    transfer = pocketfi.parseWebhookTransfer(payload);
    const creditMinor = cfg.creditBasis === 'gross' ? transfer.grossMinor : transfer.settlementMinor;
    transfer.creditMinor = creditMinor;
    transfer.creditDecimal = pocketfi.minorToDecimal(creditMinor);
  } catch (error) {
    try { await setEvent(eventId, 'RECONCILIATION'); } catch {}
    return retained(res, 'documented_transfer_shape_required');
  }

  // The official payload has no event/status field. A signed payload is kept
  // for reconciliation, but cannot credit without an explicit operator/env
  // acknowledgement that this documented shape is final.
  if (!cfg.enabled || !cfg.transferEventsConfirmed) {
    try { await setEvent(eventId, 'RECONCILIATION'); } catch {}
    return retained(res, cfg.enabled ? 'transfer_finality_not_confirmed' : 'pocketfi_disabled');
  }
  if (!cfg.businessId || String(cfg.businessId) !== transfer.businessId) {
    try { await setEvent(eventId, 'RECONCILIATION'); } catch {}
    return retained(res, 'business_mismatch');
  }
  if (!['settlement', 'gross'].includes(cfg.creditBasis)) {
    try { await setEvent(eventId, 'RECONCILIATION'); } catch {}
    return retained(res, 'credit_policy_invalid');
  }

  let virtualAccount;
  try {
    virtualAccount = await prisma.virtualAccount.findFirst({
      where: { provider: 'pocketfi', accountNumber: transfer.accountNumber, status: 'ACTIVE' },
    });
  } catch (error) {
    try { await setEvent(eventId, 'FAILED'); } catch {}
    console.error('PocketFi virtual-account lookup failed', (/^[A-Z0-9_]{1,50}$/.test(String(error.code || '')) ? error.code : 'PROCESSING_FAILED'));
    return res.status(500).json({ message: 'Processing failed' });
  }
  if (!virtualAccount || virtualAccount.currency !== 'NGN') {
    try { await setEvent(eventId, 'RECONCILIATION'); } catch {}
    return retained(res, 'virtual_account_unmatched');
  }

  // A provider reference is idempotent only when every credit-relevant detail
  // matches. Reusing it with a different amount/account/business is a conflict.
  let priorPayment;
  try {
    priorPayment = await prisma.payment.findUnique({ where: { providerReference: transfer.providerReference } });
  } catch {
    try { await setEvent(eventId, 'FAILED'); } catch {}
    return res.status(500).json({ message: 'Processing failed' });
  }
  if (priorPayment) {
    if (samePaymentDetails(priorPayment, transfer, virtualAccount.userId)) {
      try { await setEvent(eventId, 'PROCESSED'); } catch {}
      return res.status(200).json({ message: 'success', duplicate: true });
    }
    try { await setEvent(eventId, 'CONFLICT'); } catch {}
    return retained(res, 'provider_reference_conflict');
  }

  const metadata = {
    pocketfi: {
      account_number: transfer.accountNumber,
      business_id: transfer.businessId,
      user_id: String(virtualAccount.userId),
      amount_minor: transfer.creditDecimal,
      credit_basis: cfg.creditBasis,
    },
  };

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const concurrentPayment = await tx.payment.findUnique({ where: { providerReference: transfer.providerReference } });
      if (concurrentPayment) return { duplicate: true, conflict: !samePaymentDetails(concurrentPayment, transfer, virtualAccount.userId) };

      const wallet = await tx.wallet.findUnique({ where: { userId: virtualAccount.userId } });
      if (!wallet || wallet.currency !== 'NGN') {
        const error = new Error('Wallet is unavailable');
        error.code = 'POCKETFI_WALLET_UNAVAILABLE';
        throw error;
      }
      await tx.payment.create({
        data: {
          userId: virtualAccount.userId,
          provider: 'pocketfi',
          providerReference: transfer.providerReference,
          amount: transfer.creditDecimal,
          currency: 'NGN',
          status: 'SUCCESS',
          rawEvent: metadata,
        },
      });
      await tx.wallet.update({
        where: { userId: virtualAccount.userId },
        data: { balance: { increment: transfer.creditDecimal } },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          userId: virtualAccount.userId,
          type: 'WALLET_CREDIT',
          amount: transfer.creditDecimal,
          currency: 'NGN',
          reference: `DEP-${transfer.providerReference}`,
          providerReference: transfer.providerReference,
          status: 'COMPLETED',
          description: `Wallet deposit via ${virtualAccount.bankName} transfer`,
        },
      });
      await tx.notification.create({
        data: {
          userId: virtualAccount.userId,
          type: 'WALLET_DEPOSIT',
          title: 'Deposit confirmed',
          body: `Your wallet has been credited with NGN ${transfer.creditDecimal}.`,
        },
      });
      return { duplicate: false };
    });

    if (outcome.conflict) {
      await setEvent(eventId, 'CONFLICT');
      return retained(res, 'provider_reference_conflict');
    }
    if (outcome.duplicate) {
      const after = await prisma.payment.findUnique({ where: { providerReference: transfer.providerReference } });
      if (samePaymentDetails(after, transfer, virtualAccount.userId)) {
        await setEvent(eventId, 'PROCESSED');
        return res.status(200).json({ message: 'success', duplicate: true });
      }
      await setEvent(eventId, 'CONFLICT');
      return retained(res, 'provider_reference_conflict');
    }
    await setEvent(eventId, 'PROCESSED');
    return res.status(200).json({ message: 'success', credited: true, creditBasis: cfg.creditBasis, amount: transfer.creditDecimal });
  } catch (error) {
    try { await setEvent(eventId, 'FAILED'); } catch {}
    console.error('PocketFi webhook processing failed', (/^[A-Z0-9_]{1,50}$/.test(String(error.code || '')) ? error.code : 'PROCESSING_FAILED'));
    return res.status(500).json({ message: 'Processing failed' });
  }
});

module.exports = router;