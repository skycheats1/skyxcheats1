// src by SKY CHEATS. Copy right SKY CHEATS
import express from 'express';
import crypto from 'crypto';
import { asyncHandler } from '../src/asyncHandler.js';
import { db, requireAdmin, adminCors } from '../src/firebase.js';
// src by SKY CHEATS. Copy right SKY CHEATS
import { rateLimit } from '../src/security.js';
import { cachedLoader } from '../src/cache.js';
import { CATALOG, CATALOG_RESELLER, CATALOG_PRO, getMaintenanceOverrides, invalidateMaintenanceCache, getLiveCatalog, invalidateCustomProductCache, findCustomProductFresh, getCustomProductRaw, deleteCustomProduct, invalidateWhatsappProductCache, getWhatsappProductRaw, deleteWhatsappProduct, invalidateShopSrcProductCache, getShopSrcProductRaw, deleteShopSrcProduct } from '../src/srt_storage_product.js';
import { parseFeatures, DEFAULT_FEATURES, STAGES, stageFields, timeline } from '../src/shopSrc.js';
import { telegramNotify, telegramFormat, esc } from '../src/telegram.js';
import admin from 'firebase-admin';
// src by SKY CHEATS. Copy right SKY CHEATS
import { notifyBalanceChange } from '../src/balanceAlerts.js';
import { addKeys, removeKey, listKeys, cleanKeys, StockError, statusRef, stockRef, MAX_KEYS_PER_ADD } from '../src/keyStock.js';
import { invalidateUserDoc, invalidateAllUserDocs } from '../src/userCache.js';
// src by SKY CHEATS. Copy right SKY CHEATS
import { announcementCache, announcementListCache, policyCache, leaderboardCache } from '../src/sharedCaches.js';
import { getDirectory, getStats, getRankings } from '../src/adminDirectory.js';
import { getStock, setStock, addStock } from '../src/gloryStock.js';
import { activeBan, makeBan, BAN_DURATIONS } from '../src/ban.js';
import { normalizeUrlField, RuleError } from '../src/profileRules.js';
// src by SKY CHEATS. Copy right SKY CHEATS
import { listBots, createBot, updateBot, deleteBot } from '../src/leaderboardBots.js';
import { ROLES, depositUpdate, roleChangeUpdate, proPublicState } from '../src/proTier.js';
import { announceProActivated } from '../src/proReseller.js';
import { uploadImage } from '../src/imgbb.js';

const router = express.Router();
// src by SKY CHEATS. Copy right SKY CHEATS
router.use(adminCors);
router.use(rateLimit({ windowMs: 60_000, max: 90, name: 'admin' }));
router.use(requireAdmin);

const EMPTY_USER = (uid, email = '') => ({
  // src by SKY CHEATS. Copy right SKY CHEATS
  success: true, uid, found: false,
  balance: 0, email, adminLog: [], purchases: [],
  topupRequests: [], requestStatus: 'Active', adminMessage: '',
  profileName: '', profilePhone: '', role: 'user',
});
// src by SKY CHEATS. Copy right SKY CHEATS

router.get('/lookup', asyncHandler(async (req, res) => {
  const uidParam = String(req.query.uid || '').trim();
  const emailParam = String(req.query.email || '').trim();
  if (!uidParam && !emailParam) {
    // src by SKY CHEATS. Copy right SKY CHEATS
    return res.status(400).json({ success: false, error: 'Provide a uid or email' });
  }

  let uid = uidParam;
  let snap;
// src by SKY CHEATS. Copy right SKY CHEATS

  if (uid) {
    snap = await db().collection('users').doc(uid).get();
  } else {
    const q = await db().collection('users').where('email', '==', emailParam).limit(1).get();
    // src by SKY CHEATS. Copy right SKY CHEATS
    if (q.empty) return res.json(EMPTY_USER('', emailParam));
    snap = q.docs[0];
    uid = snap.id;
  }

  // src by SKY CHEATS. Copy right SKY CHEATS
  if (!snap.exists) return res.json(EMPTY_USER(uid));

  const data = snap.data();
  res.json({
    success: true, uid, found: true,
    // src by SKY CHEATS. Copy right SKY CHEATS
    balance: Number(data.balance || 0),
    email: data.email || '',
    adminLog: [...(data.adminLog || [])].reverse().slice(0, 50),
    purchases: [...(data.purchaseHistory || [])].reverse().slice(0, 50),
    topupRequests: [...(data.topupRequests || [])].reverse().slice(0, 50),
    // src by SKY CHEATS. Copy right SKY CHEATS
    fakePaymentStrikes: Number(data.fakePayment?.count || 0),
    requestStatus: data.requestStatus || 'Active',
    adminMessage: data.adminMessage || '',
    profileName: data.profileName || '',
    profilePhone: data.profilePhone || '',
    // src by SKY CHEATS. Copy right SKY CHEATS
    role: data.role || 'user',
    proReseller: proPublicState(data),
    ban: activeBan(data),
  });
}));
// src by SKY CHEATS. Copy right SKY CHEATS

router.post('/set-role', asyncHandler(async (req, res) => {
  const uid = String(req.body?.uid || '').trim();
  const role = String(req.body?.role || '').trim();

  if (!uid) return res.status(400).json({ success: false, error: 'Provide a uid' });
  // src by SKY CHEATS. Copy right SKY CHEATS
  if (!ROLES.includes(role)) {
    return res.status(400).json({ success: false, error: 'role must be "user", "reseller" or "pro_reseller"' });
  }

  const userRef = db().collection('users').doc(uid);
  // src by SKY CHEATS. Copy right SKY CHEATS
  const snap = await userRef.get();
  if (!snap.exists) {
    return res.status(404).json({ success: false, error: 'No user found with that uid' });
  }

  // src by SKY CHEATS. Copy right SKY CHEATS
  const upd = roleChangeUpdate(snap.data(), role, 'admin-panel');
  await userRef.set({ ...upd.fields, adminLog: [...(snap.data().adminLog || []), ...upd.log] }, { merge: true });
  invalidateUserDoc(uid, { history: false });
  res.json({ success: true, uid, role });
}));
// src by SKY CHEATS. Copy right SKY CHEATS

router.post('/adjust-balance', asyncHandler(async (req, res) => {
  const uid = String(req.body?.uid || '').trim();
  const amount = parseInt(req.body?.amount, 10);
  const direction = String(req.body?.direction || 'add');
  // src by SKY CHEATS. Copy right SKY CHEATS
  const note = String(req.body?.note || '').trim();

  if (!uid) return res.status(400).json({ success: false, error: 'Provide a uid' });
  if (!amount || amount <= 0) return res.status(400).json({ success: false, error: 'Enter a valid amount' });
  if (!['add', 'deduct'].includes(direction)) {
    // src by SKY CHEATS. Copy right SKY CHEATS
    return res.status(400).json({ success: false, error: 'direction must be "add" or "deduct"' });
  }

  const userRef = db().collection('users').doc(uid);
  try {
    // src by SKY CHEATS. Copy right SKY CHEATS
    let beforeBalance = 0;
    let userEmail = '';
    let proAct = null;
    let proFields = {};
    const newBalance = await db().runTransaction(async (tx) => {
      // src by SKY CHEATS. Copy right SKY CHEATS
      const snap = await tx.get(userRef);
      const current = snap.exists ? Number(snap.data().balance || 0) : 0;
      const delta = direction === 'add' ? amount : -amount;
      const updated = current + delta;
      if (updated < 0) throw new Error('That would take the balance negative');
// src by SKY CHEATS. Copy right SKY CHEATS

      const log = snap.exists ? (snap.data().adminLog || []) : [];
      log.push({ delta, note, resultingBalance: updated, at: new Date().toISOString() });

      const pro = snap.exists && delta > 0 ? depositUpdate(snap.data(), delta, updated) : { fields: {}, log: [], activated: false };
      // src by SKY CHEATS. Copy right SKY CHEATS
      log.push(...pro.log);
      proAct = pro.activated ? { name: snap.data().profileName, deposited: pro.fields.proReseller.depositSinceApproval } : null;
      proFields = pro.fields;

      tx.set(userRef, { balance: updated, adminLog: log, ...pro.fields }, { merge: true });
      // src by SKY CHEATS. Copy right SKY CHEATS
      beforeBalance = current;
      userEmail = snap.exists ? (snap.data().email || '') : '';
      return updated;
    });
    invalidateUserDoc(uid, Object.keys(proFields).length ? { history: false } : { history: false, balance: newBalance });
    // src by SKY CHEATS. Copy right SKY CHEATS
    res.json({ success: true, newBalance, proActivated: !!proAct });
    if (proAct) announceProActivated({ uid, email: userEmail, ...proAct });

    notifyBalanceChange({
      actor: 'ADMIN', kind: direction === 'add' ? 'load' : 'deduct',
      // src by SKY CHEATS. Copy right SKY CHEATS
      uid, email: userEmail, amount, before: beforeBalance, after: newBalance, note,
    });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
// src by SKY CHEATS. Copy right SKY CHEATS
}));

router.post('/set-status', asyncHandler(async (req, res) => {
  const uid = String(req.body?.uid || '').trim();
  if (!uid) return res.status(400).json({ success: false, error: 'Provide a uid' });
// src by SKY CHEATS. Copy right SKY CHEATS

  const allowed = ['Active', 'Pending', 'Rejected', 'Banned'];
  const update = {};

  if (Object.prototype.hasOwnProperty.call(req.body, 'requestStatus')) {
    // src by SKY CHEATS. Copy right SKY CHEATS
    if (!allowed.includes(req.body.requestStatus)) {
      return res.status(400).json({ success: false, error: `requestStatus must be one of: ${allowed.join(', ')}` });
    }
    update.requestStatus = req.body.requestStatus;
  }
  // src by SKY CHEATS. Copy right SKY CHEATS
  if (Object.prototype.hasOwnProperty.call(req.body, 'adminMessage')) {
    update.adminMessage = String(req.body.adminMessage);
  }
  if (Object.keys(update).length === 0) {
    return res.status(400).json({ success: false, error: 'Nothing to update' });
  // src by SKY CHEATS. Copy right SKY CHEATS
  }

  await db().collection('users').doc(uid).set(update, { merge: true });
  invalidateUserDoc(uid, { history: false });
  res.json({ success: true });
// src by SKY CHEATS. Copy right SKY CHEATS
}));

router.post('/topup-review', asyncHandler(async (req, res) => {
  const uid = String(req.body?.uid || '').trim();
  const txCode = String(req.body?.txCode || '').trim().toUpperCase();
  // src by SKY CHEATS. Copy right SKY CHEATS
  const action = String(req.body?.action || '');

  if (!uid || !txCode) return res.status(400).json({ success: false, error: 'Provide uid and txCode' });
  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ success: false, error: 'action must be "approve" or "reject"' });
  // src by SKY CHEATS. Copy right SKY CHEATS
  }

  const userRef = db().collection('users').doc(uid);
  let approvedAmount = 0;
  let proAct = null;
  // src by SKY CHEATS. Copy right SKY CHEATS
  try {
    const newBalance = await db().runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists) throw new Error('User not found');
      const data = snap.data();
      // src by SKY CHEATS. Copy right SKY CHEATS
      const requests = data.topupRequests || [];

      let found = false;
      let amount = 0;
      const updatedRequests = requests.map((r) => {
        // src by SKY CHEATS. Copy right SKY CHEATS
        if (!found && r.txCode === txCode && r.status === 'PENDING') {
          found = true;
          amount = Number(r.amount || 0);
          approvedAmount = amount;
          return { ...r, status: action === 'approve' ? 'APPROVED' : 'REJECTED', reviewedAt: new Date().toISOString() };
        // src by SKY CHEATS. Copy right SKY CHEATS
        }
        return r;
      });

      if (!found) throw new Error('No matching PENDING request with that transaction code');
// src by SKY CHEATS. Copy right SKY CHEATS

      const update = { topupRequests: updatedRequests };
      let balance = Number(data.balance || 0);

      if (action === 'approve') {
        // src by SKY CHEATS. Copy right SKY CHEATS
        balance += amount;
        const log = data.adminLog || [];
        log.push({
          delta: amount, note: `Top-up approved (txCode: ${txCode})`,
          resultingBalance: balance, at: new Date().toISOString(),
        // src by SKY CHEATS. Copy right SKY CHEATS
        });
        const pro = depositUpdate(data, amount, balance);
        log.push(...pro.log);
        Object.assign(update, pro.fields);
        proAct = pro.activated ? { name: data.profileName, email: data.email, deposited: pro.fields.proReseller.depositSinceApproval } : null;
        // src by SKY CHEATS. Copy right SKY CHEATS
        update.balance = balance;
        update.adminLog = log;
      }

      tx.set(userRef, update, { merge: true });
      // src by SKY CHEATS. Copy right SKY CHEATS
      return balance;
    });
    invalidateUserDoc(uid, { history: false });
    res.json({ success: true, newBalance, proActivated: !!proAct });
    if (proAct) announceProActivated({ uid, ...proAct });
    // src by SKY CHEATS. Copy right SKY CHEATS
    if (action === 'approve') {
      notifyBalanceChange({
        actor: 'ADMIN', kind: 'load', title: 'TOP-UP APPROVED',
        uid, amount: approvedAmount, before: newBalance - approvedAmount, after: newBalance,
        note: `TX code: ${txCode}`,
      // src by SKY CHEATS. Copy right SKY CHEATS
      });
    } else {
      telegramNotify(telegramFormat('Balance Load Rejected', { username: uid, product: 'SKY CHEATS (OWNER)', price: 0, uid, status: 'failed', others: `TX code: ${txCode}` }), 'balance');
    }
  } catch (e) {
    // src by SKY CHEATS. Copy right SKY CHEATS
    res.status(400).json({ success: false, error: e.message });
  }
}));

router.post('/backfill-stats', asyncHandler(async (req, res) => {
  // src by SKY CHEATS. Copy right SKY CHEATS
  const snap = await db().collection('users').get();
  let updated = 0;
  const batchSize = 400;
  let batch = db().batch();
  let inBatch = 0;
// src by SKY CHEATS. Copy right SKY CHEATS

  for (const doc of snap.docs) {
    const history = doc.data().purchaseHistory || [];
    const totalKeysBought = history.length;
    const totalSpent = history.reduce((sum, h) => sum + (Number(h.price) || 0), 0);
    // src by SKY CHEATS. Copy right SKY CHEATS
    batch.set(doc.ref, { totalKeysBought, totalSpent }, { merge: true });
    inBatch++;
    updated++;
    if (inBatch >= batchSize) {
      await batch.commit();
      // src by SKY CHEATS. Copy right SKY CHEATS
      batch = db().batch();
      inBatch = 0;
    }
  }
  if (inBatch > 0) await batch.commit();
  // src by SKY CHEATS. Copy right SKY CHEATS
  invalidateAllUserDocs();
  leaderboardCache.invalidate();

  res.json({ success: true, usersUpdated: updated });
}));
// src by SKY CHEATS. Copy right SKY CHEATS

router.get('/products', asyncHandler(async (req, res) => {
  const [overrides, liveCatalog, statusSnap] = await Promise.all([
    getMaintenanceOverrides(), getLiveCatalog('user'), db().collection('productStatus').get(),
  ]);
  // Fresh stock counts (the catalog cache only needs to know "zero or not").
  const stockCounts = {};
  statusSnap.forEach((d) => { stockCounts[d.id] = Math.max(0, Math.floor(Number(d.data().stockCount) || 0)); });
  const skus = Object.keys(liveCatalog).filter((sku) => !['whatsapp', 'shopsrc'].includes(liveCatalog[sku].type));

  const products = skus.map((sku) => {
    const p = liveCatalog[sku];
    const pr = CATALOG_RESELLER[sku] || p;
    const o = overrides[sku];
    const maintenance = o ? !!o.maintenance : !!p.maintenance;
    const maintenanceMessage = maintenance
      ? (o?.maintenanceMessage || p.maintenanceMessage || 'This product is temporarily under maintenance.')
      : null;
    const stockCount = stockCounts[sku] || 0;
    const outOfStock = !!p.outOfStock || stockCount <= 0;
    const outOfStockMessage = outOfStock ? (p.outOfStockMessage || 'This duration is out of stock.') : null;
    return {
      sku, pid: p.pid, row: p.row, name: p.name, duration: p.duration, image: p.image,
      price: p.price, priceReseller: CATALOG[sku] ? pr.price : (p.priceReseller ?? p.price),
      priceProReseller: CATALOG[sku] ? (CATALOG_PRO[sku]?.price ?? o?.priceProReseller ?? pr.price) : (p.priceProReseller ?? p.priceReseller ?? p.price),
      downloadLink: p.downloadLink || '',
      tags: Array.isArray(p.tags) ? p.tags : [],
      stockCount,
      maintenance, maintenanceMessage, outOfStock, outOfStockMessage,
      custom: !CATALOG[sku],
    };
  });

  res.json({ success: true, products });
}));

router.post('/products/:sku/maintenance', asyncHandler(async (req, res) => {
  const sku = String(req.params.sku || '').trim();
  const liveCatalog = await getLiveCatalog('user');
  // src by SKY CHEATS. Copy right SKY CHEATS
  if (!CATALOG[sku] && !liveCatalog[sku]) {
    return res.status(404).json({ success: false, error: 'Unknown sku' });
  }

  const maintenance = !!req.body?.maintenance;
  // src by SKY CHEATS. Copy right SKY CHEATS
  const message = String(req.body?.message || '').trim();
  if (message.length > 300) return res.status(400).json({ success: false, error: 'Keep the message under 300 characters' });

  await db().collection('productStatus').doc(sku).set({
    maintenance,
    // src by SKY CHEATS. Copy right SKY CHEATS
    maintenanceMessage: maintenance ? (message || 'This product is temporarily under maintenance.') : null,
    updatedAt: Date.now(),
  }, { merge: true });

  invalidateMaintenanceCache();
  // src by SKY CHEATS. Copy right SKY CHEATS
  res.json({ success: true, sku, maintenance });
}));

router.post('/products/:sku/out-of-stock', asyncHandler(async (req, res) => {
  const sku = String(req.params.sku || '').trim();
  // src by SKY CHEATS. Copy right SKY CHEATS
  if (!CATALOG[sku] && !(await findCustomProductFresh(sku))) {
    return res.status(404).json({ success: false, error: 'Unknown sku' });
  }

  const outOfStock = !!req.body?.outOfStock;
  // src by SKY CHEATS. Copy right SKY CHEATS
  const message = String(req.body?.message || '').trim();
  if (message.length > 300) return res.status(400).json({ success: false, error: 'Keep the message under 300 characters' });

  await db().collection('productStatus').doc(sku).set({
    outOfStock,
    // src by SKY CHEATS. Copy right SKY CHEATS
    outOfStockMessage: outOfStock ? (message || 'Out of stock — check back soon.') : null,
    updatedAt: Date.now(),
  }, { merge: true });

  invalidateMaintenanceCache();
  // src by SKY CHEATS. Copy right SKY CHEATS
  res.json({ success: true, sku, outOfStock });
}));

const VALID_TAGS = ['NONROOT', 'ROOT', 'IOS', 'PC'];

// src by SKY CHEATS. Copy right SKY CHEATS
function normalizeTags(input) {
  const arr = Array.isArray(input) ? input : [];
  return [...new Set(arr.map((t) => String(t || '').trim().toUpperCase()))].filter((t) => VALID_TAGS.includes(t));
}

// src by SKY CHEATS. Copy right SKY CHEATS
// Short url-safe id for a product line (used inside the sku). No supplier "pid" is needed any more.
const slug = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'p';

router.post('/products/create', asyncHandler(async (req, res) => {
  const image = String(req.body?.image || '').trim();
  const row = String(req.body?.row || '').trim();
  const pid = String(req.body?.pid || '').trim() || slug(row);
  const tags = normalizeTags(req.body?.tags);
  const durations = Array.isArray(req.body?.durations) ? req.body.durations : [];

  if (!image) return res.status(400).json({ success: false, error: 'Product image is required' });
  if (!row) return res.status(400).json({ success: false, error: 'Product full name is required' });
  if (!tags.length) return res.status(400).json({ success: false, error: `Select at least one tag (${VALID_TAGS.join(', ')})` });
  if (!durations.length) return res.status(400).json({ success: false, error: 'Add at least one duration + price' });
  if (durations.length > 20) return res.status(400).json({ success: false, error: 'Too many durations in one go — split it up' });

  let downloadLink;
  try {
    downloadLink = normalizeUrlField(req.body?.downloadLink, 'Download link', { maxLen: 500 });
  } catch (e) {
    if (e instanceof RuleError) return res.status(e.status).json({ success: false, error: e.message });
    throw e;
  }

  const batch = db().batch();
  const created = [];
  const seenNames = new Set();

  for (let i = 0; i < durations.length; i++) {
    const d = durations[i];
    const name = String(d?.name || '').trim();
    const duration = String(d?.duration || '').trim();
    const price = Number(d?.price);
    const priceReseller = d?.priceReseller !== undefined && d?.priceReseller !== '' ? Number(d.priceReseller) : price;
    const priceProReseller = d?.priceProReseller !== undefined && d?.priceProReseller !== '' ? Number(d.priceProReseller) : priceReseller;
    if (!name || !duration) return res.status(400).json({ success: false, error: `Duration #${i + 1}: name and duration label are required` });
    if (!price || price <= 0) return res.status(400).json({ success: false, error: `Duration #${i + 1}: user price must be a positive number` });
    if (!priceReseller || priceReseller <= 0) return res.status(400).json({ success: false, error: `Duration #${i + 1}: reseller price must be a positive number` });
    if (!priceProReseller || priceProReseller <= 0) return res.status(400).json({ success: false, error: `Duration #${i + 1}: pro reseller price must be a positive number` });
    const dupKey = duration.toLowerCase().replace(/\s+/g, ' ');
    if (seenNames.has(dupKey)) return res.status(400).json({ success: false, error: `Duration #${i + 1}: "${duration}" is listed twice in this product` });
    seenNames.add(dupKey);

    let keys;
    try { keys = cleanKeys(d?.keys); } catch (e) {
      if (e instanceof StockError) return res.status(e.status).json({ success: false, error: `Duration #${i + 1}: ${e.message}` });
      throw e;
    }
    if (keys.length > MAX_KEYS_PER_ADD) return res.status(400).json({ success: false, error: `Duration #${i + 1}: add at most ${MAX_KEYS_PER_ADD} keys at a time` });

    const sku = `custom_${pid}_${i + 1}_${Date.now().toString(36)}`;
    const product = { pid, row, name, duration, price, priceReseller, priceProReseller, image, tags, createdAt: Date.now(), ...(downloadLink ? { downloadLink } : {}) };
    batch.set(db().collection('customProducts').doc(sku), product);
    // Manual stock for this duration (may be empty -> shows "out of stock" until keys are added).
    batch.set(stockRef(sku), { keys, added: keys.length, sold: 0, updatedAt: Date.now(), soldOutNotified: false });
    batch.set(statusRef(sku), { stockCount: keys.length, updatedAt: Date.now() }, { merge: true });
    created.push({ sku, ...product, stockCount: keys.length });
  }

  await batch.commit();
  invalidateCustomProductCache();
  invalidateMaintenanceCache();
  res.json({ success: true, row, products: created });
}));

// ---- Manual key stock (per product duration = per sku) ----
async function skuExists(sku) {
  if (CATALOG[sku]) return true;
  const live = await getLiveCatalog('user');
  const p = live[sku];
  return !!p && !['whatsapp', 'shopsrc', 'manual'].includes(p.type);
}
const stockFail = (res, e) => {
  if (e instanceof StockError) return res.status(e.status).json({ success: false, error: e.message });
  throw e;
};

router.get('/products/:sku/stock', asyncHandler(async (req, res) => {
  const sku = String(req.params.sku || '').trim();
  if (!(await skuExists(sku))) return res.status(404).json({ success: false, error: 'Unknown sku' });
  res.json({ success: true, sku, ...(await listKeys(sku)) });
}));

router.post('/products/:sku/stock/add', asyncHandler(async (req, res) => {
  const sku = String(req.params.sku || '').trim();
  if (!(await skuExists(sku))) return res.status(404).json({ success: false, error: 'Unknown sku' });
  try {
    const r = await addKeys(sku, req.body?.keys);
    res.json({ success: true, sku, ...r });
  } catch (e) { stockFail(res, e); }
}));

router.post('/products/:sku/stock/remove', asyncHandler(async (req, res) => {
  const sku = String(req.params.sku || '').trim();
  if (!(await skuExists(sku))) return res.status(404).json({ success: false, error: 'Unknown sku' });
  try {
    const r = await removeKey(sku, req.body?.key);
    res.json({ success: true, sku, ...r });
  } catch (e) { stockFail(res, e); }
}));

router.post('/products/:sku/edit', asyncHandler(async (req, res) => {
  // src by SKY CHEATS. Copy right SKY CHEATS
  const sku = String(req.params.sku || '').trim();
  const fields = {};
  for (const key of ['image', 'name', 'duration']) {
    if (req.body?.[key] !== undefined) {
      const v = String(req.body[key]).trim();
      // src by SKY CHEATS. Copy right SKY CHEATS
      if (!v) return res.status(400).json({ success: false, error: `${key} can't be empty` });
      fields[key] = v;
    }
  }
  if (req.body?.price !== undefined) {
    // src by SKY CHEATS. Copy right SKY CHEATS
    const v = Number(req.body.price);
    if (!v || v <= 0) return res.status(400).json({ success: false, error: 'User price must be a positive number' });
    fields.price = v;
  }
  if (req.body?.priceReseller !== undefined) {
    // src by SKY CHEATS. Copy right SKY CHEATS
    const v = Number(req.body.priceReseller);
    if (!v || v <= 0) return res.status(400).json({ success: false, error: 'Reseller price must be a positive number' });
    fields.priceReseller = v;
  }
  if (req.body?.priceProReseller !== undefined) {
    // src by SKY CHEATS. Copy right SKY CHEATS
    const v = Number(req.body.priceProReseller);
    if (!v || v <= 0) return res.status(400).json({ success: false, error: 'Pro reseller price must be a positive number' });
    fields.priceProReseller = v;
  }
  if (req.body?.tags !== undefined) {
    // src by SKY CHEATS. Copy right SKY CHEATS
    const v = normalizeTags(req.body.tags);
    if (!v.length) return res.status(400).json({ success: false, error: `Select at least one tag (${VALID_TAGS.join(', ')})` });
    fields.tags = v;
  }
  if (req.body?.downloadLink !== undefined) {
    // src by SKY CHEATS. Copy right SKY CHEATS
    try {
      fields.downloadLink = normalizeUrlField(req.body.downloadLink, 'Download link', { maxLen: 500 });
    } catch (e) {
      if (e instanceof RuleError) return res.status(e.status).json({ success: false, error: e.message });
      throw e;
    // src by SKY CHEATS. Copy right SKY CHEATS
    }
  }
  if (!Object.keys(fields).length) return res.status(400).json({ success: false, error: 'Nothing to update' });

  const custom = await getCustomProductRaw(sku);
// src by SKY CHEATS. Copy right SKY CHEATS

  if (custom) {
    // src by SKY CHEATS. Copy right SKY CHEATS
    await db().collection('customProducts').doc(sku).set(fields, { merge: true });
    invalidateCustomProductCache();
  } else if (CATALOG[sku]) {
    await db().collection('productStatus').doc(sku).set({ ...fields, updatedAt: Date.now() }, { merge: true });
    invalidateMaintenanceCache();
  // src by SKY CHEATS. Copy right SKY CHEATS
  } else {
    return res.status(404).json({ success: false, error: 'Unknown sku' });
  }
  res.json({ success: true, sku, updated: fields });
}));
// src by SKY CHEATS. Copy right SKY CHEATS

router.post('/products/:sku/delete', asyncHandler(async (req, res) => {
  const sku = String(req.params.sku || '').trim();
  if (CATALOG[sku]) {
    return res.status(400).json({ success: false, error: "That's a built-in product — use Maintenance to disable it instead of deleting" });
  // src by SKY CHEATS. Copy right SKY CHEATS
  }
  const custom = await getCustomProductRaw(sku);
  if (!custom) return res.status(404).json({ success: false, error: 'Unknown sku' });

  await deleteCustomProduct(sku);
  await stockRef(sku).delete().catch(() => {});
  // src by SKY CHEATS. Copy right SKY CHEATS
  await db().collection('productStatus').doc(sku).delete().catch(() => {});
  invalidateMaintenanceCache();
  res.json({ success: true, sku });
}));

// src by SKY CHEATS. Copy right SKY CHEATS
router.get('/products/whatsapp', asyncHandler(async (req, res) => {
  const snap = await db().collection('whatsappProducts').get();
  const products = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  res.json({ success: true, products });
}));
// src by SKY CHEATS. Copy right SKY CHEATS

router.post('/products/create-whatsapp', asyncHandler(async (req, res) => {
  const image = String(req.body?.image || '').trim();
  const name = String(req.body?.name || '').trim();
  const price = Number(req.body?.price);
  // src by SKY CHEATS. Copy right SKY CHEATS
  const priceReseller = req.body?.priceReseller !== undefined && req.body?.priceReseller !== '' ? Number(req.body.priceReseller) : price;
  const priceProReseller = req.body?.priceProReseller !== undefined && req.body?.priceProReseller !== '' ? Number(req.body.priceProReseller) : priceReseller;
  const whatsappNumber = String(req.body?.whatsappNumber || '').replace(/[^\d]/g, '');
  const whatsappMessage = String(req.body?.whatsappMessage || '').trim().slice(0, 400);
  const viewDetails = String(req.body?.viewDetails || '').trim().slice(0, 1000);
// src by SKY CHEATS. Copy right SKY CHEATS

  if (!image) return res.status(400).json({ success: false, error: 'Image link is required' });
  if (!name) return res.status(400).json({ success: false, error: 'Product name is required' });
  if (!price || price <= 0) return res.status(400).json({ success: false, error: 'User price must be a positive number' });
  if (!priceReseller || priceReseller <= 0) return res.status(400).json({ success: false, error: 'Reseller price must be a positive number' });
  // src by SKY CHEATS. Copy right SKY CHEATS
  if (!priceProReseller || priceProReseller <= 0) return res.status(400).json({ success: false, error: 'Pro reseller price must be a positive number' });
  if (!whatsappNumber) return res.status(400).json({ success: false, error: 'WhatsApp number is required (digits only, with country code)' });

  const id = `wa_${Date.now().toString(36)}`;
  const product = { image, name, price, priceReseller, priceProReseller, whatsappNumber, whatsappMessage, viewDetails, createdAt: Date.now() };
  // src by SKY CHEATS. Copy right SKY CHEATS
  await db().collection('whatsappProducts').doc(id).set(product);
  invalidateWhatsappProductCache();
  res.json({ success: true, id, ...product });
}));

// src by SKY CHEATS. Copy right SKY CHEATS
router.post('/products/whatsapp/:id/edit', asyncHandler(async (req, res) => {
  const id = String(req.params.id || '').trim();
  const existing = await getWhatsappProductRaw(id);
  if (!existing) return res.status(404).json({ success: false, error: 'Unknown product' });

  // src by SKY CHEATS. Copy right SKY CHEATS
  const fields = {};
  for (const key of ['image', 'name', 'whatsappMessage', 'viewDetails']) {
    if (req.body?.[key] !== undefined) fields[key] = String(req.body[key]).trim();
  }
  if (req.body?.whatsappNumber !== undefined) {
    // src by SKY CHEATS. Copy right SKY CHEATS
    const v = String(req.body.whatsappNumber).replace(/[^\d]/g, '');
    if (!v) return res.status(400).json({ success: false, error: 'WhatsApp number is required' });
    fields.whatsappNumber = v;
  }
  if (req.body?.price !== undefined) {
    // src by SKY CHEATS. Copy right SKY CHEATS
    const v = Number(req.body.price);
    if (!v || v <= 0) return res.status(400).json({ success: false, error: 'User price must be a positive number' });
    fields.price = v;
  }
  if (req.body?.priceReseller !== undefined) {
    // src by SKY CHEATS. Copy right SKY CHEATS
    const v = Number(req.body.priceReseller);
    if (!v || v <= 0) return res.status(400).json({ success: false, error: 'Reseller price must be a positive number' });
    fields.priceReseller = v;
  }
  if (req.body?.priceProReseller !== undefined) {
    // src by SKY CHEATS. Copy right SKY CHEATS
    const v = Number(req.body.priceProReseller);
    if (!v || v <= 0) return res.status(400).json({ success: false, error: 'Pro reseller price must be a positive number' });
    fields.priceProReseller = v;
  }
  if (!Object.keys(fields).length) return res.status(400).json({ success: false, error: 'Nothing to update' });
// src by SKY CHEATS. Copy right SKY CHEATS

  await db().collection('whatsappProducts').doc(id).set(fields, { merge: true });
  invalidateWhatsappProductCache();
  res.json({ success: true, id, updated: fields });
}));
// src by SKY CHEATS. Copy right SKY CHEATS

router.post('/products/whatsapp/:id/delete', asyncHandler(async (req, res) => {
  const id = String(req.params.id || '').trim();
  const existing = await getWhatsappProductRaw(id);
  if (!existing) return res.status(404).json({ success: false, error: 'Unknown product' });
  // src by SKY CHEATS. Copy right SKY CHEATS
  await deleteWhatsappProduct(id);
  res.json({ success: true, id });
}));


// src by SKY CHEATS. Copy right SKY CHEATS
// ---- shop project (store source code) products ----
router.get('/products/shopsrc', asyncHandler(async (req, res) => {
  const snap = await db().collection('shopSrcProducts').get();
  res.json({ success: true, products: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
}));

router.post('/products/create-shopsrc', asyncHandler(async (req, res) => {
  const image = String(req.body?.image || '').trim();
  const name = String(req.body?.name || '').trim().slice(0, 80);
  const price = Number(req.body?.price);
  const priceReseller = req.body?.priceReseller !== undefined && req.body?.priceReseller !== '' ? Number(req.body.priceReseller) : price;
  const priceProReseller = req.body?.priceProReseller !== undefined && req.body?.priceProReseller !== '' ? Number(req.body.priceProReseller) : priceReseller;
  const features = parseFeatures(req.body?.features);
  if (!/^https:\/\//i.test(image)) return res.status(400).json({ success: false, error: 'Image link must start with https:// (postimage / imgbb link)' });
  if (!name) return res.status(400).json({ success: false, error: 'Product name is required' });
  for (const [label, v] of [['User', price], ['Reseller', priceReseller], ['Pro reseller', priceProReseller]]) {
    if (!v || v <= 0) return res.status(400).json({ success: false, error: `${label} price must be a positive number` });
  }
  const id = `ss_${Date.now().toString(36)}`;
  const product = { image, name, price, priceReseller, priceProReseller, features: features.length ? features : DEFAULT_FEATURES, createdAt: Date.now() };
  await db().collection('shopSrcProducts').doc(id).set(product);
  invalidateShopSrcProductCache();
  res.json({ success: true, id, ...product });
}));

router.post('/products/shopsrc/:id/edit', asyncHandler(async (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!(await getShopSrcProductRaw(id))) return res.status(404).json({ success: false, error: 'Unknown product' });
  const fields = {};
  if (req.body?.name !== undefined) { fields.name = String(req.body.name).trim().slice(0, 80); if (!fields.name) return res.status(400).json({ success: false, error: 'Name required' }); }
  if (req.body?.image !== undefined) {
    fields.image = String(req.body.image).trim();
    if (!/^https:\/\//i.test(fields.image)) return res.status(400).json({ success: false, error: 'Image link must start with https://' });
  }
  for (const k of ['price', 'priceReseller', 'priceProReseller']) {
    if (req.body?.[k] === undefined) continue;
    const v = Number(req.body[k]);
    if (!v || v <= 0) return res.status(400).json({ success: false, error: `${k} must be a positive number` });
    fields[k] = v;
  }
  if (req.body?.features !== undefined) {
    const f = parseFeatures(req.body.features);
    if (!f.length) return res.status(400).json({ success: false, error: 'Add at least one detail line' });
    fields.features = f;
  }
  if (!Object.keys(fields).length) return res.status(400).json({ success: false, error: 'Nothing to update' });
  await db().collection('shopSrcProducts').doc(id).set(fields, { merge: true });
  invalidateShopSrcProductCache();
  res.json({ success: true, id, updated: fields });
}));

router.post('/products/shopsrc/:id/delete', asyncHandler(async (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!(await getShopSrcProductRaw(id))) return res.status(404).json({ success: false, error: 'Unknown product' });
  await deleteShopSrcProduct(id);
  res.json({ success: true, id });
}));


// ---- shop-project ORDER TRACKING (admin moves each order through the stages) ----
router.get('/shop-orders', asyncHandler(async (req, res) => {
  const snap = await db().collection('shopOrders').orderBy('createdAt', 'desc').limit(100).get();
  res.json({
    success: true,
    orders: snap.docs.map((d) => {
      const o = d.data();
      return {
        id: d.id, uid: o.uid, email: o.email || '', buyerName: o.details?.name || '', productName: o.productName, price: o.price,
        submitted: !!o.submitted, stageIndex: Number(o.stageIndex || 0), createdAt: o.createdAt || null,
      };
    }),
  });
}));

router.get('/shop-orders/:id', asyncHandler(async (req, res) => {
  const snap = await db().collection('shopOrders').doc(String(req.params.id)).get();
  if (!snap.exists) return res.status(404).json({ success: false, error: 'Order not found' });
  const o = snap.data();
  res.json({ success: true, order: { id: snap.id, ...o, timeline: timeline(o) } });
}));

router.post('/shop-orders/:id/stage', asyncHandler(async (req, res) => {
  const n = Number(req.body?.stage);
  if (!Number.isInteger(n) || n < 0 || n > 5) return res.status(400).json({ success: false, error: 'Stage must be 0-5 (finish the order with "Send details")' });
  const ref = db().collection('shopOrders').doc(String(req.params.id));
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ success: false, error: 'Order not found' });
  const o = snap.data();
  if (!o.submitted) return res.status(409).json({ success: false, error: 'The buyer has not submitted the form yet' });
  const f = stageFields(o, n);
  await ref.set(f, { merge: true });
  res.json({ success: true, stageIndex: n, timeline: timeline({ ...o, ...f }) });
}));

router.post('/shop-orders/:id/deliver', asyncHandler(async (req, res) => {
  const pick = (k, max) => String(req.body?.[k] ?? '').trim().slice(0, max);
  const delivery = { storeLink: pick('storeLink', 300), adminLink: pick('adminLink', 300), unlockUrl: pick('unlockUrl', 300), password: pick('password', 200) };
  for (const [k, v] of Object.entries(delivery)) {
    if (!v) return res.status(400).json({ success: false, error: `${k} is required` });
    if (k !== 'password' && !/^https?:\/\//i.test(v)) return res.status(400).json({ success: false, error: `${k} must start with http:// or https://` });
  }
  const ref = db().collection('shopOrders').doc(String(req.params.id));
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ success: false, error: 'Order not found' });
  const o = snap.data();
  if (!o.submitted) return res.status(409).json({ success: false, error: 'The buyer has not submitted the form yet' });
  const f = stageFields(o, STAGES.length);
  await ref.set({ ...f, delivery, deliveredAt: Date.now() }, { merge: true });
  res.json({ success: true, stageIndex: STAGES.length });
}));

function generateRedeemCode() {
  // src by SKY CHEATS. Copy right SKY CHEATS
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const group = (n) => Array.from({ length: n }, () => chars[crypto.randomInt(chars.length)]).join('');
  return `SRT_${group(5)}_${group(5)}CHEATS`;
}

// src by SKY CHEATS. Copy right SKY CHEATS
const redeemListCache = cachedLoader(async () => {
  const snap = await db().collection('redeemCodes').orderBy('createdAt', 'desc').limit(200).get();
  return snap.docs.map((d) => d.data());
}, { ttlMs: 2 * 60 * 1000, name: 'redeemCodes' });

// src by SKY CHEATS. Copy right SKY CHEATS
async function createRedeemCodeDoc({ amount, maxUses, expiresAt, code }) {
  amount = Number(amount);
  if (!amount || amount <= 0) throw Object.assign(new Error('Amount must be a positive number'), { status: 400 });

  if (maxUses === '' || maxUses === undefined || maxUses === null || String(maxUses).toLowerCase() === 'unlimited') {
    // src by SKY CHEATS. Copy right SKY CHEATS
    maxUses = null;
  } else {
    maxUses = Number(maxUses);
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 100) {
      throw Object.assign(new Error('Max uses must be a whole number between 1 and 100, or unlimited'), { status: 400 });
    // src by SKY CHEATS. Copy right SKY CHEATS
    }
  }

  let expiresAtMs = null;
  if (expiresAt && String(expiresAt).toLowerCase() !== 'unlimited') {
    // src by SKY CHEATS. Copy right SKY CHEATS
    const t = new Date(expiresAt).getTime();
    if (Number.isNaN(t)) throw Object.assign(new Error('Invalid expiry date'), { status: 400 });
    expiresAtMs = t;
  }

  // src by SKY CHEATS. Copy right SKY CHEATS
  const finalCode = String(code || '').trim().toUpperCase() || generateRedeemCode();
  const ref = db().collection('redeemCodes').doc(finalCode);
  const existing = await ref.get();
  if (existing.exists) throw Object.assign(new Error('That code already exists'), { status: 409 });

  // src by SKY CHEATS. Copy right SKY CHEATS
  const docData = {
    code: finalCode, amount, maxUses, expiresAt: expiresAtMs,
    active: true, usedCount: 0, redeemedBy: [],
    createdAt: Date.now(),
  };
  // src by SKY CHEATS. Copy right SKY CHEATS
  await ref.set(docData);
  redeemListCache.invalidate();
  return docData;
}

// src by SKY CHEATS. Copy right SKY CHEATS
router.post('/redeem-codes', asyncHandler(async (req, res) => {
  try {
    const result = await createRedeemCodeDoc(req.body || {});
    res.json({ success: true, ...result });
  } catch (e) {
    // src by SKY CHEATS. Copy right SKY CHEATS
    res.status(e.status || 400).json({ success: false, error: e.message });
  }
}));

router.get('/redeem-codes', asyncHandler(async (req, res) => {
  // src by SKY CHEATS. Copy right SKY CHEATS
  res.json({ success: true, codes: await redeemListCache.get() });
}));

router.post('/redeem-codes/:code/deactivate', asyncHandler(async (req, res) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  // src by SKY CHEATS. Copy right SKY CHEATS
  const ref = db().collection('redeemCodes').doc(code);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ success: false, error: 'Code not found' });
  await ref.set({ active: false }, { merge: true });
  redeemListCache.invalidate();
  // src by SKY CHEATS. Copy right SKY CHEATS
  res.json({ success: true });
}));

router.get('/stats', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await getStats()) });
// src by SKY CHEATS. Copy right SKY CHEATS
}));

router.get('/rankings', asyncHandler(async (req, res) => {
  res.json({ success: true, rankings: await getRankings(100) });
}));
// src by SKY CHEATS. Copy right SKY CHEATS

router.post('/announcements', asyncHandler(async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ success: false, error: 'Write a message first' });
  if (message.length > 500) return res.status(400).json({ success: false, error: 'Keep the message under 500 characters' });
// src by SKY CHEATS. Copy right SKY CHEATS

  let gift = null;
  const giftAmount = req.body?.giftAmount;
  if (giftAmount !== undefined && giftAmount !== null && giftAmount !== '') {
    try {
      // src by SKY CHEATS. Copy right SKY CHEATS
      gift = await createRedeemCodeDoc({
        amount: giftAmount,
        maxUses: req.body?.giftMaxUses ?? null,
        expiresAt: req.body?.giftExpiresAt ?? null,
      });
    // src by SKY CHEATS. Copy right SKY CHEATS
    } catch (e) {
      return res.status(e.status || 400).json({ success: false, error: `Gift code: ${e.message}` });
    }
  }

  // src by SKY CHEATS. Copy right SKY CHEATS
  const id = `ann_${Date.now()}`;
  const docData = {
    id, message,
    giftCode: gift?.code || null,
    giftAmount: gift?.amount || null,
    // src by SKY CHEATS. Copy right SKY CHEATS
    active: true,
    createdAt: Date.now(),
  };

  const prevActive = await announcementCache.get();
  // src by SKY CHEATS. Copy right SKY CHEATS
  if (prevActive.length) {
    const batch = db().batch();
    prevActive.forEach((d) => batch.set(db().collection('announcements').doc(d.id), { active: false }, { merge: true }));
    await batch.commit();
  }
// src by SKY CHEATS. Copy right SKY CHEATS

  await db().collection('announcements').doc(id).set(docData);
  announcementCache.invalidate();
  announcementListCache.invalidate();
  res.json({ success: true, announcement: docData });
// src by SKY CHEATS. Copy right SKY CHEATS
}));

router.get('/announcements', asyncHandler(async (req, res) => {
  res.json({ success: true, announcements: await announcementListCache.get() });
}));
// src by SKY CHEATS. Copy right SKY CHEATS

router.post('/announcements/:id/deactivate', asyncHandler(async (req, res) => {
  const id = String(req.params.id || '').trim();
  const ref = db().collection('announcements').doc(id);
  const snap = await ref.get();
  // src by SKY CHEATS. Copy right SKY CHEATS
  if (!snap.exists) return res.status(404).json({ success: false, error: 'Announcement not found' });
  await ref.set({ active: false }, { merge: true });
  announcementCache.invalidate();
  announcementListCache.invalidate();
  res.json({ success: true });
// src by SKY CHEATS. Copy right SKY CHEATS
}));

router.get('/users', asyncHandler(async (req, res) => {
  const topupDays = req.query.topupDays ? parseInt(req.query.topupDays, 10) : null;
  const q = String(req.query.q || '').trim().toLowerCase();
  // src by SKY CHEATS. Copy right SKY CHEATS
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 200));
  const cutoff = topupDays ? Date.now() - topupDays * 24 * 60 * 60 * 1000 : null;

  let rows = await getDirectory();
  if (cutoff !== null) rows = rows.filter((r) => r.lastTopupAt && r.lastTopupAt >= cutoff);
  // src by SKY CHEATS. Copy right SKY CHEATS
  if (q) rows = rows.filter((r) => `${r.name} ${r.email} ${r.whatsapp} ${r.uid}`.toLowerCase().includes(q));
  rows = [...rows].sort((a, b) => (topupDays ? (b.lastTopupAt || 0) - (a.lastTopupAt || 0) : b.totalSpent - a.totalSpent));

  res.json({ success: true, total: rows.length, users: rows.slice(0, limit) });
}));
// src by SKY CHEATS. Copy right SKY CHEATS

router.get('/glory-stock', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await getStock({ fresh: true })) });
}));

// src by SKY CHEATS. Copy right SKY CHEATS
router.post('/glory-stock', asyncHandler(async (req, res) => {
  const action = String(req.body?.action || '');
  const amount = Number(req.body?.amount);
  let stock;
  if (action === 'unlimited') {
    // src by SKY CHEATS. Copy right SKY CHEATS
    stock = await setStock({ enabled: false, available: 0 });
  } else if (action === 'set' || action === 'add') {
    const ok = action === 'set'
      ? Number.isInteger(amount) && amount >= 0 && amount <= 10000
      : Number.isInteger(amount) && amount >= -10000 && amount <= 10000 && amount !== 0;
    // src by SKY CHEATS. Copy right SKY CHEATS
    if (!ok) return res.status(400).json({ success: false, error: 'Enter a whole number (0 to 10000).' });
    stock = action === 'set' ? await setStock({ enabled: true, available: amount }) : await addStock(amount);
  } else {
    return res.status(400).json({ success: false, error: 'action must be set, add or unlimited' });
  }
  // src by SKY CHEATS. Copy right SKY CHEATS
  telegramNotify(`🤖 <b>Glory Bot stock</b> ${action}: ${stock.enabled ? `${stock.available} available` : 'unlimited'} (admin panel)`);
  res.json({ success: true, ...stock });
}));

router.post('/ban', asyncHandler(async (req, res) => {
  // src by SKY CHEATS. Copy right SKY CHEATS
  const uid = String(req.body?.uid || '').trim();
  const duration = String(req.body?.duration || '').trim();
  if (!uid) return res.status(400).json({ success: false, error: 'Provide a uid' });
  if (!BAN_DURATIONS[duration]) {
    return res.status(400).json({ success: false, error: `duration must be one of: ${Object.keys(BAN_DURATIONS).join(', ')}` });
  // src by SKY CHEATS. Copy right SKY CHEATS
  }
  const userRef = db().collection('users').doc(uid);
  const snap = await userRef.get();
  if (!snap.exists) return res.status(404).json({ success: false, error: 'No user found with that uid' });

  // src by SKY CHEATS. Copy right SKY CHEATS
  const ban = makeBan(duration);
  const d = snap.data();
  const log = d.adminLog || [];
  log.push({ delta: 0, note: `Banned — ${ban.label}`, resultingBalance: Number(d.balance || 0), at: new Date().toISOString() });
  await userRef.set({ ban, banned: true, adminLog: log }, { merge: true });
  // src by SKY CHEATS. Copy right SKY CHEATS
  invalidateUserDoc(uid, { history: false });
  telegramNotify(`🚫 <b>User banned</b> — ${esc(ban.label)}\nUID: <code>${esc(uid)}</code>\n${esc(d.email || '')}`);
  res.json({ success: true, uid, ban });
}));

// src by SKY CHEATS. Copy right SKY CHEATS
router.post('/reset-fake-strikes', asyncHandler(async (req, res) => {
  const uid = String(req.body?.uid || '').trim();
  if (!uid) return res.status(400).json({ success: false, error: 'Provide a uid' });
  const userRef = db().collection('users').doc(uid);
  const snap = await userRef.get();
  // src by SKY CHEATS. Copy right SKY CHEATS
  if (!snap.exists) return res.status(404).json({ success: false, error: 'No user found with that uid' });
  await userRef.set({ fakePayment: admin.firestore.FieldValue.delete() }, { merge: true });
  invalidateUserDoc(uid, { history: false });
  res.json({ success: true, uid });
}));
// src by SKY CHEATS. Copy right SKY CHEATS

router.post('/unban', asyncHandler(async (req, res) => {
  const uid = String(req.body?.uid || '').trim();
  if (!uid) return res.status(400).json({ success: false, error: 'Provide a uid' });
  const userRef = db().collection('users').doc(uid);
  // src by SKY CHEATS. Copy right SKY CHEATS
  const snap = await userRef.get();
  if (!snap.exists) return res.status(404).json({ success: false, error: 'No user found with that uid' });

  const d = snap.data();
  const log = d.adminLog || [];
  // src by SKY CHEATS. Copy right SKY CHEATS
  log.push({ delta: 0, note: 'Unbanned', resultingBalance: Number(d.balance || 0), at: new Date().toISOString() });
  await userRef.set({ ban: admin.firestore.FieldValue.delete(), banned: admin.firestore.FieldValue.delete(), adminLog: log }, { merge: true });
  invalidateUserDoc(uid, { history: false });
  telegramNotify(`✅ <b>User unbanned</b>\nUID: <code>${esc(uid)}</code>\n${esc(d.email || '')}`);
  res.json({ success: true, uid });
// src by SKY CHEATS. Copy right SKY CHEATS
}));

router.get('/banned', asyncHandler(async (req, res) => {
  const q = await db().collection('users').where('banned', '==', true).limit(200).get();
  const banned = [];
  // src by SKY CHEATS. Copy right SKY CHEATS
  for (const doc of q.docs) {
    const data = doc.data();
    const ban = activeBan(data);
    if (ban) banned.push({ uid: doc.id, email: data.email || '', profileName: data.profileName || '', ...ban });
  }
  // src by SKY CHEATS. Copy right SKY CHEATS
  banned.sort((a, b) => (b.at || 0) - (a.at || 0));
  res.json({ success: true, banned });
}));

const botErr = (res, e) => {
  // src by SKY CHEATS. Copy right SKY CHEATS
  if (e instanceof RuleError) return res.status(e.status).json({ success: false, error: e.message });
  throw e;
};

router.get('/leaderboard-bots', asyncHandler(async (req, res) => {
  // src by SKY CHEATS. Copy right SKY CHEATS
  res.json({ success: true, bots: await listBots() });
}));

router.post('/leaderboard-bots', asyncHandler(async (req, res) => {
  try {
    // src by SKY CHEATS. Copy right SKY CHEATS
    const bot = await createBot(req.body || {});
    leaderboardCache.invalidate();
    res.json({ success: true, bot });
  } catch (e) { botErr(res, e); }
}));
// src by SKY CHEATS. Copy right SKY CHEATS

router.post('/leaderboard-bots/:id/edit', asyncHandler(async (req, res) => {
  try {
    const bot = await updateBot(req.params.id, req.body || {});
    leaderboardCache.invalidate();
    // src by SKY CHEATS. Copy right SKY CHEATS
    res.json({ success: true, bot });
  } catch (e) { botErr(res, e); }
}));

router.post('/leaderboard-bots/:id/delete', asyncHandler(async (req, res) => {
  // src by SKY CHEATS. Copy right SKY CHEATS
  try {
    await deleteBot(req.params.id);
    leaderboardCache.invalidate();
    res.json({ success: true });
  } catch (e) { botErr(res, e); }
// src by SKY CHEATS. Copy right SKY CHEATS
}));

router.get('/policy', asyncHandler(async (req, res) => {
  const snap = await db().collection('config').doc('policy').get();
  const data = snap.exists ? snap.data() : {};
  // src by SKY CHEATS. Copy right SKY CHEATS
  res.json({ success: true, title: data.title || '', body: data.body || '', updatedAt: data.updatedAt || null });
}));

router.post('/policy', asyncHandler(async (req, res) => {
  const title = String(req.body?.title || '').trim();
  // src by SKY CHEATS. Copy right SKY CHEATS
  const body = String(req.body?.body || '').trim();
  if (!title) return res.status(400).json({ success: false, error: 'Title is required' });
  if (!body) return res.status(400).json({ success: false, error: 'Policy text is required' });
  if (body.length > 20000) return res.status(400).json({ success: false, error: 'Policy text is too long (max 20,000 characters)' });

  // src by SKY CHEATS. Copy right SKY CHEATS
  await db().collection('config').doc('policy').set({ title, body, updatedAt: Date.now() }, { merge: true });
  policyCache.invalidate();
  res.json({ success: true });
}));

// src by SKY CHEATS. Copy right SKY CHEATS
router.get('/welcome-popup', asyncHandler(async (req, res) => {
  const snap = await db().collection('config').doc('welcomePopup').get();
  const d = snap.exists ? snap.data() : {};
  res.json({ success: true, url: d.url || '', enabled: d.enabled !== false, updatedAt: d.updatedAt || null });
}));
// src by SKY CHEATS. Copy right SKY CHEATS

router.post('/welcome-popup', asyncHandler(async (req, res) => {
  const url = String(req.body?.url || '').trim();
  const enabled = req.body?.enabled !== false;
  if (enabled && !/^https?:\/\/[^\s]+$/i.test(url)) {
    // src by SKY CHEATS. Copy right SKY CHEATS
    return res.status(400).json({ success: false, error: 'Enter a full link starting with http:// or https://' });
  }
  if (url.length > 500) return res.status(400).json({ success: false, error: 'Link is too long' });
  await db().collection('config').doc('welcomePopup').set({ url, enabled, updatedAt: Date.now() }, { merge: true });
  res.json({ success: true });
// src by SKY CHEATS. Copy right SKY CHEATS
}));

export default router;
