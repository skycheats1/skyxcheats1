// Supplier product feed (PI API) -> "auto add product" for the admin panel.
//
//   POST https://repromax5.onrender.com/api/pi/v1   (form-encoded: pi_key, action=products)
//   -> { success, products: [{ name, pid, image, durations: [{ duration, price }] }] }   (price = our cost, NRP)
//
// The key stays on the server: set PI_KEY (and optionally PI_ENDPOINT) in the backend environment.
import { normDuration, apiLabel } from './apiMatch.js';

export const PI_DEFAULT_ENDPOINT = 'https://repromax5.onrender.com/api/pi/v1';
const TIMEOUT_MS = Number(process.env.PI_TIMEOUT_MS) || 30_000;

export class SupplierFeedError extends Error {
  constructor(message, status = 502) { super(message); this.name = 'SupplierFeedError'; this.status = status; }
}

const clean = (v, n = 200) => String(v ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

// Fetch + normalise the supplier catalogue. Never returns the key; never throws raw supplier text to the client.
export async function fetchSupplierProducts(fetchImpl = fetch) {
  const key = process.env.PI_KEY;
  if (!key) throw new SupplierFeedError('Supplier feed is not configured — set PI_KEY in the backend environment.', 503);
  const url = process.env.PI_ENDPOINT || PI_DEFAULT_ENDPOINT;

  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ pi_key: key, action: 'products' }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new SupplierFeedError(e?.name === 'TimeoutError' ? 'Supplier feed timed out — try again.' : 'Could not reach the supplier feed.');
  }

  let data = null;
  try { data = JSON.parse(await res.text()); } catch (_) { /* not JSON */ }
  if (!res.ok || !data || !data.success) {
    const why = clean(data?.error || data?.code || `HTTP ${res.status}`, 120);
    console.error('[supplierFeed] failed:', res.status, why);
    throw new SupplierFeedError(`Supplier feed refused the request (${why}).`);
  }
  return normaliseFeed(data.products);
}

export function normaliseFeed(list) {
  const out = [];
  for (const p of Array.isArray(list) ? list : []) {
    const pid = String(p?.pid ?? '').trim();
    const name = clean(p?.name, 120);
    if (!pid || !name) continue;
    const seen = new Set();
    const durations = [];
    for (const d of Array.isArray(p.durations) ? p.durations : []) {
      const duration = String(d?.duration ?? '').trim();
      const price = Number(d?.price);
      const norm = normDuration(duration);
      if (!duration || !norm || seen.has(norm) || !Number.isFinite(price) || price <= 0) continue;
      seen.add(norm);
      durations.push({ duration, price });
    }
    if (durations.length) out.push({ pid, name, image: String(p.image ?? '').trim(), durations });
  }
  return out;
}

// cost + markup% -> selling price (whole NRP, rounded up so we never sell below the margin we asked for)
export const markupPrice = (cost, pct) => Math.ceil(Number(cost) * (1 + Number(pct) / 100) - 1e-9);

export function cleanMarkups(input = {}) {
  const pick = (v, dflt) => {
    const n = v === undefined || v === null || v === '' ? dflt : Number(v);
    return Number.isFinite(n) && n >= 0 && n <= 1000 ? n : null;
  };
  const user = pick(input.user, 30), reseller = pick(input.reseller, 15), pro = pick(input.pro, 8);
  if (user === null || reseller === null || pro === null) return null;
  return { user, reseller, pro };
}

// Mark each supplier product / duration as already imported (same pid + same duration label) so imports never duplicate.
export function annotateFeed(feed, existing) {
  const byPid = new Map();
  for (const p of existing) {
    const k = String(p.pid ?? '').trim();
    if (!byPid.has(k)) byPid.set(k, []);
    byPid.get(k).push(p);
  }
  return feed.map((sp) => {
    const have = byPid.get(sp.pid) || [];
    const durations = sp.durations.map((d) => ({
      ...d,
      exists: have.some((h) => normDuration(apiLabel(h)) === normDuration(d.duration) || normDuration(h.duration) === normDuration(d.duration)),
    }));
    const added = durations.filter((d) => d.exists).length;
    return { ...sp, durations, state: added === 0 ? 'new' : added === durations.length ? 'imported' : 'partial' };
  });
}

// Build the customProducts docs to write. Pure: no I/O. `existing` = current customProducts rows for those pids.
export function planImport({ feed, pids, existing, tags, markups, now = Date.now() }) {
  const annotated = annotateFeed(feed, existing);
  const wanted = new Set(pids.map((x) => String(x).trim()));
  const docs = [];
  const skipped = [];
  const missing = [...wanted].filter((p) => !feed.some((f) => f.pid === p));

  for (const sp of annotated) {
    if (!wanted.has(sp.pid)) continue;
    const imageOk = /^https:\/\/\S+$/i.test(sp.image) && sp.image.length <= 500;
    if (!imageOk) { skipped.push({ pid: sp.pid, name: sp.name, reason: 'supplier gave no usable https image' }); continue; }
    let i = existing.filter((e) => String(e.pid ?? '').trim() === sp.pid).length;
    for (const d of sp.durations) {
      if (d.exists) { skipped.push({ pid: sp.pid, name: sp.name, duration: d.duration, reason: 'already added' }); continue; }
      i += 1;
      const price = markupPrice(d.price, markups.user);
      const priceReseller = Math.min(price, markupPrice(d.price, markups.reseller));
      const priceProReseller = Math.min(priceReseller, markupPrice(d.price, markups.pro));
      const sku = `custom_${sp.pid}_${i}_${now.toString(36)}${i}`;
      docs.push({
        sku,
        doc: {
          pid: sp.pid, row: sp.name, name: `${sp.name} ${d.duration}`.slice(0, 160), duration: d.duration,
          price, priceReseller, priceProReseller, image: sp.image, tags, createdAt: now,
          source: 'supplier-feed', supplierCost: d.price,
        },
      });
    }
  }
  return { docs, skipped, missing };
}
