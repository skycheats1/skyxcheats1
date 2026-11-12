// src by SKY CHEATS. Copy right SKY CHEATS
import express from 'express';
import crypto from 'crypto';
import admin from 'firebase-admin';
// src by SKY CHEATS. Copy right SKY CHEATS
import { asyncHandler } from '../src/asyncHandler.js';
import { db, requireFirebaseUid, userCors } from '../src/firebase.js';
import { catalogFind, getMaintenanceForSku, findCustomProductFresh, invalidateMaintenanceCache } from '../src/srt_storage_product.js';
import { telegramNotify, telegramFormat } from '../src/telegram.js';
import { stockRef, takeKeyInTx, StockError, notifySoldOut, notifyEmptyAttempt } from '../src/keyStock.js';
// src by SKY CHEATS. Copy right SKY CHEATS
import { invalidateUserDoc } from '../src/userCache.js';
import { leaderboardCache } from '../src/sharedCaches.js';

const router = express.Router();
router.use(userCors);
// src by SKY CHEATS. Copy right SKY CHEATS
router.use(requireFirebaseUid);

// Every purchase alert goes to the purchase-logs bot (TELEGRAM_PURCHASE_BOT_TOKEN / _CHAT_ID);
// it falls back to the general bot until those are set.
const notifyPurchase = (title, fields) => telegramNotify(telegramFormat(title, fields), 'purchase');

const jobs = new Map();
const JOB_TTL_MS = 3 * 60 * 1000;

// src by SKY CHEATS. Copy right SKY CHEATS
function setJob(jobId, patch) {
  const existing = jobs.get(jobId) || {};
  jobs.set(jobId, { ...existing, ...patch });
}

// src by SKY CHEATS. Copy right SKY CHEATS
router.post('/checkout/start', asyncHandler(async (req, res) => {
  const sku = String(req.body?.sku || '');
  const buyerName = String(req.body?.name || '').trim();
  const buyerWa = String(req.body?.waNum || '').trim();
  const androidId = req.body?.android_id ? String(req.body.android_id).trim() : null;
// src by SKY CHEATS. Copy right SKY CHEATS

  if (!sku) {
    return res.status(400).json({ success: false, error: 'Missing product selection. Please pick a duration and try again.' });
  }

  // src by SKY CHEATS. Copy right SKY CHEATS
  let product = catalogFind(sku);
  if (!product) {
    product = await findCustomProductFresh(sku);
  }
  if (!product) {
    // src by SKY CHEATS. Copy right SKY CHEATS
    return res.status(400).json({ success: false, error: 'Unknown product' });
  }

  const liveStatus = await getMaintenanceForSku(sku);
  if (product.maintenance || liveStatus.maintenance) {
    // src by SKY CHEATS. Copy right SKY CHEATS
    return res.status(409).json({
      success: false,
      error: liveStatus.maintenanceMessage || product.maintenanceMessage || 'This product is currently under maintenance.',
    });
  }
  // src by SKY CHEATS. Copy right SKY CHEATS
  if (product.outOfStock || liveStatus.outOfStock) {
    return res.status(409).json({
      success: false,
      error: liveStatus.outOfStockMessage || product.outOfStockMessage || 'This duration is currently out of stock.',
    });
  // src by SKY CHEATS. Copy right SKY CHEATS
  }
  if (product.type === 'manual') {
    return res.status(400).json({ success: false, error: 'This product is ordered via WhatsApp, not instant checkout.' });
  }
  // Manual key stock: no keys left for this duration -> out of stock (and tell the admin in Telegram).
  if (!(Number(liveStatus.stockCount) > 0)) {
    notifyEmptyAttempt(sku, product);
    return res.status(409).json({ success: false, code: 'OUT_OF_STOCK', error: 'This duration is out of stock. Please check back soon.' });
  }

  // src by SKY CHEATS. Copy right SKY CHEATS
  if (product.requiresAndroidId && !androidId) {
    return res.status(400).json({ success: false, error: 'Android ID is required for this product' });
  }

  {
    // src by SKY CHEATS. Copy right SKY CHEATS
    const userSnap = await db().collection('users').doc(req.uid).get();
    const userData = userSnap.exists ? userSnap.data() : {};
    const role = userData.role || 'user';
    const balance = Number(userData.balance || 0);

    // src by SKY CHEATS. Copy right SKY CHEATS
    const bannedUntil = Number(userData.checkoutBanUntil || 0);
    if (bannedUntil > Date.now()) {
      return res.status(403).json({
        success: false,
        code: 'CHECKOUT_BANNED',
        // src by SKY CHEATS. Copy right SKY CHEATS
        error: 'Too many purchase attempts with insufficient balance. Please wait before trying again.',
        bannedUntil,
      });
    }

    // src by SKY CHEATS. Copy right SKY CHEATS
    let roleProduct = catalogFind(sku, role) || await findCustomProductFresh(sku, role) || product;
    const realPrice = Number(roleProduct.price);

    if (balance < realPrice) {
      const strikes = Number(userData.lowBalanceStrikes || 0) + 1;
      // src by SKY CHEATS. Copy right SKY CHEATS
      const updates = { lowBalanceStrikes: strikes };

      let justBanned = false;
      if (strikes >= 2) {
        updates.checkoutBanUntil = Date.now() + 60 * 60 * 1000;
        // src by SKY CHEATS. Copy right SKY CHEATS
        updates.lowBalanceStrikes = 0;
        justBanned = true;
      }
      await db().collection('users').doc(req.uid).set(updates, { merge: true });
      invalidateUserDoc(req.uid, { history: false });
// src by SKY CHEATS. Copy right SKY CHEATS

      if (justBanned) {
        notifyPurchase('Checkout Banned (1h)', {
          username: userData.profileName || req.email, email: userData.email || req.email,
          phone: userData.profilePhone || '', product: roleProduct.name || sku,
          // src by SKY CHEATS. Copy right SKY CHEATS
          price: realPrice, uid: req.uid, status: 'failed',
          others: `2nd insufficient-balance attempt — banned until ${new Date(updates.checkoutBanUntil).toISOString()} (role: ${role})`,
        });
        return res.status(403).json({
          success: false,
          // src by SKY CHEATS. Copy right SKY CHEATS
          code: 'CHECKOUT_BANNED',
          error: 'Too many purchase attempts with insufficient balance. Please wait before trying again.',
          bannedUntil: updates.checkoutBanUntil,
        });
      }
// src by SKY CHEATS. Copy right SKY CHEATS

      return res.status(402).json({
        success: false,
        code: 'INSUFFICIENT_BALANCE',
        error: "You have 0 balance and can't purchase any product. Please top up first then try again.",
        // src by SKY CHEATS. Copy right SKY CHEATS
        balance, required: realPrice,
      });
    }

    if (Number(userData.lowBalanceStrikes || 0) > 0) {
      // src by SKY CHEATS. Copy right SKY CHEATS
      await db().collection('users').doc(req.uid).set({ lowBalanceStrikes: 0 }, { merge: true });
      invalidateUserDoc(req.uid, { history: false });
    }
  }

  // src by SKY CHEATS. Copy right SKY CHEATS
  const jobId = crypto.randomUUID();
  setJob(jobId, {
    uid: req.uid,
    percent: 0,
    label: 'Queued...',
    // src by SKY CHEATS. Copy right SKY CHEATS
    done: false,
    createdAt: Date.now(),
    androidId,
  });
  setTimeout(() => jobs.delete(jobId), JOB_TTL_MS);
// src by SKY CHEATS. Copy right SKY CHEATS

  res.json({ success: true, jobId });

  runCheckoutJob(jobId, req.uid, req.email, sku, buyerName, buyerWa, androidId);
}));
// src by SKY CHEATS. Copy right SKY CHEATS

router.get('/checkout/status/:jobId', asyncHandler(async (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ success: false, error: 'Job not found or expired', done: true });
  // src by SKY CHEATS. Copy right SKY CHEATS
  }
  if (job.uid !== req.uid) {
    return res.status(403).json({ success: false, error: 'Not your job', done: true });
  }
  res.json({
    // src by SKY CHEATS. Copy right SKY CHEATS
    percent: job.percent,
    label: job.label,
    done: job.done,
    success: job.success ?? null,
    key: job.key,
    // src by SKY CHEATS. Copy right SKY CHEATS
    newBalance: job.newBalance,
    entry: job.entry,
    error: job.error,
  });
}));
// src by SKY CHEATS. Copy right SKY CHEATS

async function runCheckoutJob(jobId, uid, email, sku, buyerName, buyerWa, androidId) {
  const userRef = db().collection('users').doc(uid);

  setJob(jobId, { percent: 5, label: 'Checking request...' });
// src by SKY CHEATS. Copy right SKY CHEATS

  let role = 'user';
  let product = null;
  let realPrice = 0;
  const requestId = `sky-${String(jobId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60)}`; // order reference shown in logs

  // src by SKY CHEATS. Copy right SKY CHEATS
  try {
    const roleSnap = await userRef.get();
    role = roleSnap.exists ? (roleSnap.data().role || 'user') : 'user';
    product = catalogFind(sku, role);
    if (!product) {
      // src by SKY CHEATS. Copy right SKY CHEATS
      product = await findCustomProductFresh(sku, role);
    }
    if (!product) {
      throw new Error('Unknown product');
    }
    // src by SKY CHEATS. Copy right SKY CHEATS
    realPrice = Number(product.price);

    const liveStatus = await getMaintenanceForSku(sku);
    if (product.maintenance || liveStatus.maintenance) {
      throw new Error(liveStatus.maintenanceMessage || product.maintenanceMessage || 'This product is currently under maintenance.');
    // src by SKY CHEATS. Copy right SKY CHEATS
    }
    if (product.outOfStock || liveStatus.outOfStock) {
      throw new Error(liveStatus.outOfStockMessage || product.outOfStockMessage || 'This duration is currently out of stock.');
    }
    if (product.type === 'manual') {
      // src by SKY CHEATS. Copy right SKY CHEATS
      throw new Error('This product is ordered via WhatsApp, not instant checkout.');
    }

    if (product.requiresAndroidId && !androidId) {
      throw new Error('Android ID is required for this product');
    // src by SKY CHEATS. Copy right SKY CHEATS
    }

    setJob(jobId, { percent: 20, label: 'Checking product...' });

    notifyPurchase('Purchase attempt', {
      // src by SKY CHEATS. Copy right SKY CHEATS
      username: buyerName || email, email, phone: buyerWa, product: product.name,
      duration: product.duration, price: realPrice, uid, status: 'attempt',
      others: `role: ${role}`,
    });

    // src by SKY CHEATS. Copy right SKY CHEATS
    setJob(jobId, { percent: 35, label: 'Checking balance...' });

    // STEP 1 - ONE atomic transaction: take the money AND the oldest key from this duration's manual stock.
    // Either both happen or neither does, so there is nothing to refund and a key can never be sold twice.
    setJob(jobId, { percent: 55, label: 'Reserving your key...' });
    let sale;
    try {
      sale = await db().runTransaction(async (tx) => {
        const [userSnap, stockSnap] = await Promise.all([tx.get(userRef), tx.get(stockRef(sku))]);
        const currentBalance = userSnap.exists ? Number(userSnap.data().balance || 0) : 0;
        if (currentBalance < realPrice) {
          throw new Error('Please top up first then trying 🙏');
        }
        const { key: takenKey, remaining } = takeKeyInTx(tx, sku, stockSnap);
        tx.set(userRef, { balance: currentBalance - realPrice }, { merge: true });
        return { key: takenKey, remaining, currentBalance, newBalance: currentBalance - realPrice };
      });
    } catch (e) {
      if (e instanceof StockError && e.code === 'OUT_OF_STOCK') {
        invalidateMaintenanceCache(); // the store must show "out of stock" right away
        notifyEmptyAttempt(sku, product);
        throw new Error('This duration is out of stock. Please check back soon.');
      }
      throw e;
    }
    const key = sale.key;
    const debit = { currentBalance: sale.currentBalance, newBalance: sale.newBalance };
    try { invalidateUserDoc(uid, { history: false }); } catch (_) { /* cache only */ }
    if (sale.remaining <= 0) {
      invalidateMaintenanceCache();        // flip the store to "out of stock"
      notifySoldOut(sku, product);         // Telegram -> admin: add stock
    }

    // STEP 2 - record the delivered key. arrayUnion/increment need no read, so this cannot conflict.
    setJob(jobId, { percent: 90, label: 'Finalizing order...' });
    const historyEntry = {
      at: new Date().toISOString(), sku, row: product.row, name: product.name, duration: product.duration,
      price: realPrice, key, buyerName, buyerWa, requestId,
    };
    const result = { key, newBalance: debit.newBalance, currentBalance: debit.currentBalance, entry: historyEntry };
    let saved = false;
    for (let i = 0; i < 3 && !saved; i++) {
      try {
        await userRef.set({
          purchaseHistory: admin.firestore.FieldValue.arrayUnion(historyEntry),
          totalKeysBought: admin.firestore.FieldValue.increment(1),
          totalSpent: admin.firestore.FieldValue.increment(realPrice),
        }, { merge: true });
        saved = true;
      } catch (e) {
        console.error('[purchase] history write failed', i + 1, e?.message || e);
        await new Promise((r) => setTimeout(r, 500 * (i + 1)));
      }
    }
    // The key is already bought and paid for - never turn that into "Purchase rejected". It is in the success alert below as a backup.
    try { invalidateUserDoc(uid); leaderboardCache.invalidate(); } catch (e) { console.error('[purchase] cache invalidate failed', e?.message || e); }

    setJob(jobId, { percent: 100, label: 'Delivered!', done: true, success: true, key: result.key, newBalance: result.newBalance, entry: result.entry });

    notifyPurchase(saved ? 'Purchase success' : 'Purchase success (HISTORY NOT SAVED - add manually)', {
      username: buyerName || email, email, phone: buyerWa, product: product.name,
      duration: product.duration, price: realPrice, key: result.key, uid, status: 'success',
      balanceBefore: result.currentBalance, balanceAfter: result.newBalance, others: `request_id ${requestId}`,
    });
  } catch (e) {
    setJob(jobId, { percent: 100, done: true, success: false, error: e.message, label: 'Failed' });

    notifyPurchase('Purchase rejected', {
      username: buyerName || email, email, phone: buyerWa, product: product ? product.name : sku,
      duration: product ? product.duration : '', price: realPrice, uid, status: 'failed',
      others: `${e.message} (role: ${role}) request_id ${requestId}`,
    });
  }
}

export default router;
