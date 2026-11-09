// src by SKY CHEATS. Copy right SKY CHEATS
// Supplier (reseller API v1) client.  POST https://repromax5.onrender.com/api/reseller/v1
//
// Body (application/x-www-form-urlencoded): api_key, action=buy, product_id, duration, quantity (1-100),
//   android_id (DEVICE products only), request_id (unique per order - REUSE the same id when retrying).
// Header: x-master-key.
//
// Supplier error codes:
//   401 INVALID_CREDENTIALS      wrong api_key / master key
//   402 INSUFFICIENT_BALANCE     our supplier wallet is empty
//   404 PRODUCT_NOT_FOUND        check product_id + duration
//   409 OUT_OF_STOCK / PRODUCT_MAINTENANCE   try again later
//   429 RATE_LIMITED             slow down
//   502 PROVIDER_UNAVAILABLE     nothing was charged
//
// Because request_id makes a buy idempotent, a timeout / network error / 5xx can be retried safely with the SAME
// request_id: the supplier returns the original order instead of selling a second key.

export const UPSTREAM_DEFAULT_ENDPOINT = 'https://repromax5.onrender.com/api/reseller/v1';
const TIMEOUT_MS = Number(process.env.RESELLER_TIMEOUT_MS) || 90_000; // big bulk orders can take a while
const MAX_ATTEMPTS = Math.max(1, Number(process.env.RESELLER_MAX_ATTEMPTS) || 3);
const RETRY_BASE_MS = Number(process.env.RESELLER_RETRY_BASE_MS) || 1500;

// status -> { code, retry, charged, user }  (charged: 'no' = supplier guarantees nothing was charged, 'maybe' = unknown)
const BY_STATUS = {
  401: { code: 'INVALID_CREDENTIALS', retry: false, charged: 'no', user: 'Supplier connection error. Please try again later.' },
  402: { code: 'INSUFFICIENT_BALANCE', retry: false, charged: 'no', user: 'This product is temporarily unavailable. Please try again later.' },
  404: { code: 'PRODUCT_NOT_FOUND', retry: false, charged: 'no', user: 'This product is temporarily unavailable. Please try again later.' },
  409: { code: 'OUT_OF_STOCK', retry: false, charged: 'no', user: 'This duration is out of stock or under maintenance. Please try again later.' },
  429: { code: 'RATE_LIMITED', retry: true, charged: 'no', user: 'Supplier is busy (too many requests). Please try again in a minute.' },
  502: { code: 'PROVIDER_UNAVAILABLE', retry: true, charged: 'no', user: 'Supplier server is temporarily unavailable. Please try again later.' },
};
const BY_CODE = {
  INVALID_CREDENTIALS: 401, INSUFFICIENT_BALANCE: 402, PRODUCT_NOT_FOUND: 404, OUT_OF_STOCK: 409,
  PRODUCT_MAINTENANCE: 409, RATE_LIMITED: 429, PROVIDER_UNAVAILABLE: 502,
};

export class UpstreamError extends Error {
  // charged: 'no' -> safe to refund right away; 'maybe' -> the buy may have gone through (needs a retry with the SAME request_id or a manual check)
  constructor(message, { status = 0, code = 'UPSTREAM_ERROR', charged = 'maybe', retry = false, detail = '' } = {}) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status;
    this.code = code;
    this.charged = charged;
    this.retry = retry;
    this.detail = detail; // raw supplier text for logs / admin alerts only - never shown to users
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (v, n = 150) => String(v ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

// Build a fresh, unique request_id for one order. Pass the SAME value to every retry of that order.
export const makeRequestId = (seed) => `vx-${String(seed).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60)}`;

// Pull the delivered key(s) out of whatever shape the supplier answers with.
function extractKeys(data) {
  const pools = [data, data?.data, data?.result, data?.order];
  for (const d of pools) {
    if (!d || typeof d !== 'object') continue;
    const list = d.keys ?? d.licenses ?? d.items;
    if (Array.isArray(list) && list.length) {
      return list.map((k) => (k && typeof k === 'object' ? (k.key ?? k.license ?? k.value) : k)).map((k) => String(k ?? '').trim()).filter(Boolean);
    }
    if (typeof list === 'string' && list.trim()) return list.split(/[\r\n,]+/).map((s) => s.trim()).filter(Boolean);
    const one = d.key ?? d.license;
    if (one) return [String(one).trim()].filter(Boolean);
  }
  return [];
}

async function attemptBuy({ url, headers, body }) {
  let response;
  try {
    response = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' });
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    throw new UpstreamError(timedOut ? 'Supplier is slow to answer. Please try again.' : 'Could not reach the supplier. Please try again.', {
      code: timedOut ? 'TIMEOUT' : 'NETWORK', charged: 'maybe', retry: true, detail: err?.message || String(err),
    });
  }

  const text = await response.text();
  const status = response.status;
  console.log('[Reseller] HTTP', status, 'raw response (first 300 chars):', text.slice(0, 300).replace(/"key"\s*:\s*"[^"]*"/g, '"key":"***"'));

  let data = null;
  try { data = JSON.parse(text); } catch (_) { /* not JSON */ }
  const looksHtml = /^\s*(<!doctype|<html|<head|<body|<center|<\?xml)/i.test(text);
  const upMsg = clean(data?.message || data?.error || (looksHtml ? '' : text));
  const upCode = String(data?.code || (typeof data?.error === 'string' && /^[A-Z_]+$/.test(data.error) ? data.error : '') || '').toUpperCase();

  // Error from the supplier: the documented status table (or its code name) decides what it means.
  const errStatus = BY_STATUS[status] ? status : (!response.ok ? (BY_CODE[upCode] || 0) : 0);
  if (!response.ok || data?.success === false || upCode in BY_CODE) {
    const st = BY_STATUS[status] ? status : (BY_CODE[upCode] || errStatus);
    const info = BY_STATUS[st];
    if (info) throw new UpstreamError(info.user, { status, code: upCode || info.code, charged: info.charged, retry: info.retry, detail: upMsg });
    // 5xx we do not know (500/503/504, gateway HTML pages): the buy may or may not have happened -> retry with the same request_id.
    if (status >= 500) throw new UpstreamError('Supplier server is temporarily unavailable. Please try again later.', { status, code: 'UPSTREAM_5XX', charged: 'maybe', retry: true, detail: upMsg });
    // Other 4xx / success:false: the request was refused, nothing sold.
    throw new UpstreamError(upMsg || 'The supplier refused this order.', { status, code: upCode || 'REJECTED', charged: 'no', retry: false, detail: upMsg });
  }

  const keys = extractKeys(data);
  if (keys.length) return keys;
  // Plain-text key: only for a 2xx, non-HTML, single short token.
  if (!data && !looksHtml && text.trim() && text.trim().length < 100 && !/[<>]/.test(text)) return [text.trim()];

  // 2xx but no key: unreadable / empty. The order might exist on the supplier side -> retry with the same request_id.
  throw new UpstreamError(data ? 'Supplier did not return a key. Please try again later.' : 'Supplier returned an unreadable response. Please try again later.', {
    status, code: data ? 'NO_KEY' : 'UNREADABLE', charged: 'maybe', retry: true, detail: text.slice(0, 200).replace(/"key"\s*:\s*"[^"]*"/g, '"key":"***"'),
  });
}

/**
 * Buy key(s) from the supplier.
 *   product   { pid, duration }   (duration exactly as listed in the supplier's Product Reference Table)
 *   androidId only for DEVICE products
 *   opts      { quantity = 1 (1..100), requestId (REQUIRED, unique per order, same on every retry), onRetry(attempt, err) }
 * Returns string[] of keys.  Throws UpstreamError (see .charged / .code / .retry).
 */
export async function fetchRealKeys(product, androidId = null, { quantity = 1, requestId, onRetry } = {}) {
  const API_KEY = process.env.RESELLER_API_KEY;
  const MASTER_KEY = process.env.RESELLER_MASTER_KEY;
  const API_URL = process.env.RESELLER_ENDPOINT || UPSTREAM_DEFAULT_ENDPOINT;
  if (!API_KEY) throw new UpstreamError('Supplier is not configured.', { code: 'NOT_CONFIGURED', charged: 'no', detail: 'RESELLER_API_KEY missing' });
  if (!MASTER_KEY) throw new UpstreamError('Supplier is not configured.', { code: 'NOT_CONFIGURED', charged: 'no', detail: 'RESELLER_MASTER_KEY missing' });
  if (!requestId) throw new UpstreamError('Internal error: missing request id.', { code: 'NO_REQUEST_ID', charged: 'no' });

  const qty = Math.floor(Number(quantity));
  if (!(qty >= 1 && qty <= 100)) throw new UpstreamError('Quantity must be between 1 and 100.', { code: 'BAD_QUANTITY', charged: 'no' });

  const form = new URLSearchParams();
  form.append('api_key', API_KEY);
  form.append('action', 'buy');
  form.append('product_id', String(product.pid));
  form.append('duration', String(product.duration).trim());
  form.append('quantity', String(qty));
  if (androidId) form.append('android_id', androidId);
  form.append('request_id', requestId);

  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', 'x-master-key': MASTER_KEY };
  console.log(`[Reseller] Request: POST ${API_URL} pid=${product.pid}, duration=${JSON.stringify(product.duration)}, qty=${qty}, request_id=${requestId}${androidId ? ', android_id=' + androidId : ''}`);

  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const keys = await attemptBuy({ url: API_URL, headers, body: form.toString() });
      if (keys.length !== qty) console.error(`[Reseller] asked for ${qty} key(s), got ${keys.length}, request_id=${requestId}`);
      console.log('[Reseller] Key(s) fetched successfully');
      return keys;
    } catch (e) {
      lastErr = e;
      if (!(e instanceof UpstreamError)) throw e;
      console.error(`[Reseller] attempt ${attempt}/${MAX_ATTEMPTS} failed: ${e.code} (HTTP ${e.status}) ${e.detail || ''}`);
      if (!e.retry || attempt === MAX_ATTEMPTS) break;
      try { onRetry?.(attempt, e); } catch (_) { /* progress callback must never break a buy */ }
      await sleep(RETRY_BASE_MS * attempt * (e.code === 'RATE_LIMITED' ? 2 : 1)); // same request_id -> idempotent
    }
  }
  throw lastErr;
}

// Single-key helper kept for older callers.
export async function fetchRealKey(sku, product, androidId = null, requestId) {
  const keys = await fetchRealKeys(product, androidId, { quantity: 1, requestId });
  return keys[0];
}
