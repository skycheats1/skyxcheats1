// src by SKY CHEATS. Copy right SKY CHEATS
// Manual key stock (replaces the old supplier / reseller API).
//
//   keyStock/{sku}      { keys: string[]  (oldest first), added, sold, updatedAt, soldOutNotified }
//   productStatus/{sku} { stockCount }    (mirror of keys.length so the catalog can show "out of stock" without reading keys)
//
// Every product + duration has its own sku, so every duration has its own stock.
import admin from 'firebase-admin';
import { db } from './firebase.js';
import { invalidateMaintenanceCache } from './sky_storage_product.js';
import { telegramNotify, esc } from './telegram.js';

export const MAX_KEYS_PER_ADD = 500;
export const MAX_KEYS_PER_SKU = 5000; // Firestore docs are capped at 1 MB
const MAX_KEY_LEN = 500;

export class StockError extends Error {
  constructor(message, status = 400, code = 'STOCK_ERROR') { super(message); this.status = status; this.code = code; }
}

export const stockRef = (sku) => db().collection('keyStock').doc(sku);
export const statusRef = (sku) => db().collection('productStatus').doc(sku);

// Trim, drop blanks / control characters, drop duplicates inside the batch.
export function cleanKeys(input) {
  const arr = Array.isArray(input) ? input : String(input ?? '').split(/\r?\n/);
  const seen = new Set();
  const out = [];
  for (const raw of arr) {
    const k = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (!k) continue;
    if (k.length > MAX_KEY_LEN) throw new StockError(`A key is longer than ${MAX_KEY_LEN} characters`);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

// Add keys to one duration's stock. Keys that are already in stock are skipped (never sold twice).
export async function addKeys(sku, input) {
  const keys = cleanKeys(input);
  if (!keys.length) throw new StockError('Enter at least one key');
  if (keys.length > MAX_KEYS_PER_ADD) throw new StockError(`Add at most ${MAX_KEYS_PER_ADD} keys at a time`);

  const result = await db().runTransaction(async (tx) => {
    const snap = await tx.get(stockRef(sku));
    const have = snap.exists && Array.isArray(snap.data().keys) ? snap.data().keys : [];
    const haveSet = new Set(have);
    const fresh = keys.filter((k) => !haveSet.has(k));
    if (have.length + fresh.length > MAX_KEYS_PER_SKU) throw new StockError(`One duration can hold at most ${MAX_KEYS_PER_SKU} keys`);
    if (fresh.length) {
      const next = [...have, ...fresh];
      tx.set(stockRef(sku), {
        keys: next,
        added: admin.firestore.FieldValue.increment(fresh.length),
        updatedAt: Date.now(),
        soldOutNotified: false, // re-arm the "sold out" Telegram alert
      }, { merge: true });
      tx.set(statusRef(sku), { stockCount: next.length, updatedAt: Date.now() }, { merge: true });
    }
    return { added: fresh.length, duplicates: keys.length - fresh.length, stockCount: have.length + fresh.length };
  });
  invalidateMaintenanceCache();
  return result;
}

// Remove one key from stock (typo fix).
export async function removeKey(sku, key) {
  const target = String(key ?? '');
  const result = await db().runTransaction(async (tx) => {
    const snap = await tx.get(stockRef(sku));
    const have = snap.exists && Array.isArray(snap.data().keys) ? snap.data().keys : [];
    const next = have.filter((k) => k !== target);
    if (next.length === have.length) throw new StockError('That key is not in stock any more', 404, 'KEY_NOT_FOUND');
    tx.set(stockRef(sku), { keys: next, updatedAt: Date.now() }, { merge: true });
    tx.set(statusRef(sku), { stockCount: next.length, updatedAt: Date.now() }, { merge: true });
    return { stockCount: next.length };
  });
  invalidateMaintenanceCache();
  return result;
}

export async function listKeys(sku) {
  const snap = await stockRef(sku).get();
  const d = snap.exists ? snap.data() : {};
  const keys = Array.isArray(d.keys) ? d.keys : [];
  return { keys, stockCount: keys.length, added: Number(d.added || 0), sold: Number(d.sold || 0) };
}

// Used INSIDE a Firestore transaction (all reads must already be done): takes the oldest key and writes the new stock.
// `snap` is the keyStock/{sku} snapshot read earlier in the same transaction.
export function takeKeyInTx(tx, sku, snap) {
  const have = snap.exists && Array.isArray(snap.data().keys) ? snap.data().keys : [];
  if (!have.length) throw new StockError('This duration is out of stock.', 409, 'OUT_OF_STOCK');
  const [key, ...rest] = have;
  tx.set(stockRef(sku), { keys: rest, sold: admin.firestore.FieldValue.increment(1), updatedAt: Date.now() }, { merge: true });
  tx.set(statusRef(sku), { stockCount: rest.length, updatedAt: Date.now() }, { merge: true });
  return { key, remaining: rest.length };
}

// Put a key back (an order failed after the key was taken). Goes to the FRONT so order is kept.
export async function returnKey(sku, key) {
  try {
    await db().runTransaction(async (tx) => {
      const snap = await tx.get(stockRef(sku));
      const have = snap.exists && Array.isArray(snap.data().keys) ? snap.data().keys : [];
      if (have.includes(key)) return;
      const next = [key, ...have];
      tx.set(stockRef(sku), { keys: next, sold: admin.firestore.FieldValue.increment(-1), updatedAt: Date.now(), soldOutNotified: false }, { merge: true });
      tx.set(statusRef(sku), { stockCount: next.length, updatedAt: Date.now() }, { merge: true });
    });
    invalidateMaintenanceCache();
  } catch (e) { console.error('[keyStock] could not return key to stock', sku, e?.message || e); }
}

// ---- Telegram: tell the admin to add stock ----------------------------------------------------------------------
// Uses TELEGRAM_STOCK_BOT_TOKEN / TELEGRAM_STOCK_CHAT_ID when set, otherwise the purchase-log bot (already configured).
const stockPurpose = () => (process.env.TELEGRAM_STOCK_BOT_TOKEN ? 'stock' : 'purchase');
const productLabel = (p, sku) => `${p?.row || p?.name || sku}${p?.duration ? ` — ${p.duration}` : ''}`;

// Called after the LAST key of a duration was sold. Sends once per sold-out (re-armed when stock is added again).
export async function notifySoldOut(sku, product) {
  try {
    const claimed = await db().runTransaction(async (tx) => {
      const snap = await tx.get(stockRef(sku));
      const d = snap.exists ? snap.data() : {};
      if (d.soldOutNotified === true) return false;
      tx.set(stockRef(sku), { soldOutNotified: true }, { merge: true });
      return true;
    });
    if (!claimed) return;
    await telegramNotify(
      `🚨 <b>OUT OF STOCK — please add stock</b>\n` +
      `📦 ${esc(productLabel(product, sku))}\n` +
      `🧾 SKU: <code>${esc(sku)}</code>\n` +
      `The last key was just sold. This duration now shows "out of stock" in the store.\n` +
      `👉 Admin panel → Products → <b>Add stock</b>`,
      stockPurpose(),
    );
  } catch (e) { console.error('[keyStock] sold-out alert failed', e?.message || e); }
}

// A customer tried to buy a duration that is empty. At most one alert per duration every 6 hours.
const lastAttemptAlert = new Map();
const ATTEMPT_ALERT_MS = 6 * 60 * 60 * 1000;
export function notifyEmptyAttempt(sku, product) {
  const now = Date.now();
  if (now - (lastAttemptAlert.get(sku) || 0) < ATTEMPT_ALERT_MS) return;
  lastAttemptAlert.set(sku, now);
  telegramNotify(
    `⚠️ <b>A customer tried to buy an out-of-stock duration</b>\n` +
    `📦 ${esc(productLabel(product, sku))}\n` +
    `🧾 SKU: <code>${esc(sku)}</code>\n` +
    `👉 Admin panel → Products → <b>Add stock</b>`,
    stockPurpose(),
  ).catch(() => {});
}
