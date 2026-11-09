// src by SKY CHEATS. Copy right SKY CHEATS
import express from 'express';
import crypto from 'crypto';
import admin from 'firebase-admin';
// src by SKY CHEATS. Copy right SKY CHEATS
import { asyncHandler } from '../src/asyncHandler.js';
import { db, requireFirebaseUid, userCors } from '../src/firebase.js';
import { catalogFind, getMaintenanceForSku, findCustomProductFresh } from '../src/srt_storage_product.js';
import { telegramNotify, telegramFormat } from '../src/telegram.js';
import { fetchRealKeys, makeRequestId, UpstreamError } from '../src/upstream.js';
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
  let debited = false;
  let pendingReview = false;
  const requestId = makeRequestId(jobId); // unique per order; reused on every supplier retry

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

    // STEP 1 - debit first (atomic). The supplier call is NOT inside a Firestore transaction any more, so a
    // transaction retry can never buy a second key and a failed commit can never lose a key that was bought.
    const debit = await db().runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      const currentBalance = snap.exists ? Number(snap.data().balance || 0) : 0;
      if (currentBalance < realPrice) {
        throw new Error('Please top up first then trying 🙏');
      }
      tx.set(userRef, { balance: currentBalance - realPrice }, { merge: true });
      return { currentBalance, newBalance: currentBalance - realPrice };
    });
    debited = true;
    try { invalidateUserDoc(uid, { history: false }); } catch (_) { /* cache only */ }

    // STEP 2 - buy from the supplier. One request_id per order, reused on every retry (the supplier will not sell twice).
    let key;
    try {
      setJob(jobId, { percent: 55, label: 'Connecting to server...' });
      const keys = await fetchRealKeys(product, androidId, {
        quantity: 1,
        requestId,
        onRetry: () => setJob(jobId, { percent: 65, label: 'Server busy, retrying...' }),
      });
      key = keys[0];
    } catch (e) {
      if (e instanceof UpstreamError && e.charged === 'no') {
        // Supplier guarantees nothing was charged -> give the money back right away.
        await refundDebit(userRef, realPrice, `Auto-refund: ${e.code}`);
        debited = false;
        try { invalidateUserDoc(uid, { history: false }); } catch (_) { /* cache only */ }
        notifyPurchase('Supplier error (auto-refunded)', {
          username: buyerName || email, email, phone: buyerWa, product: product.name, duration: product.duration,
          price: realPrice, uid, status: 'failed', others: `${e.code} HTTP ${e.status} ${e.detail || ''} | request_id ${requestId}`,
        });
        throw new Error(e.message);
      }
      // charged === 'maybe' (timeout / unreadable / 5xx after all retries): the supplier may have created the order.
      // Do NOT refund automatically (that could hand out a free key) and do NOT take the money twice: keep the debit and
      // ask the admin to check request_id on the supplier panel, then refund or deliver by hand.
      pendingReview = true;
      notifyPurchase('ORDER NEEDS REVIEW (money held)', {
        username: buyerName || email, email, phone: buyerWa, product: product.name, duration: product.duration,
        price: realPrice, uid, status: 'failed',
        others: `${e.code || 'ERROR'} ${e.detail || e.message} | request_id ${requestId} | balance already debited - check the supplier order, then refund or deliver manually`,
      });
      throw new Error('Your order is being verified with the supplier. If no key arrives shortly your balance will be refunded - contact support with order ' + requestId);
    }

    // STEP 3 - record the delivered key. arrayUnion/increment need no read, so this cannot conflict.
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

    // Safety net: if we debited and something unexpected threw before the supplier answered, hand the money back.
    if (debited && !pendingReview) {
      try { await refundDebit(userRef, realPrice, 'Auto-refund: purchase failed'); invalidateUserDoc(uid, { history: false }); }
      catch (re) { console.error('[purchase] REFUND FAILED', uid, realPrice, requestId, re?.message || re); }
    }
    notifyPurchase('Purchase rejected', {
      username: buyerName || email, email, phone: buyerWa, product: product ? product.name : sku,
      duration: product ? product.duration : '', price: realPrice, uid, status: 'failed',
      others: `${e.message} (role: ${role}) request_id ${requestId}`,
    });
  }
}

// Give a debit back (balance only - counters are only touched on success).
async function refundDebit(userRef, amount, note) {
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const cur = snap.exists ? Number(snap.data().balance || 0) : 0;
    tx.set(userRef, { balance: cur + amount }, { merge: true });
  });
  console.log('[purchase] refunded', amount, '-', note);
}

export default router;
