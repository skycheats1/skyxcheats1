// src by SKY CHEATS. Copy right SKY CHEATS
import { depositUpdate } from '../src/proTier.js';
import { announceProActivated } from '../src/proReseller.js';
import express from 'express';
import { invalidateUserDoc } from '../src/userCache.js';
// src by SKY CHEATS. Copy right SKY CHEATS
import { asyncHandler } from '../src/asyncHandler.js';
import { db, requireEmployee, adminCors } from '../src/firebase.js';
import { rateLimit } from '../src/security.js';
import { getMaintenanceOverrides, invalidateMaintenanceCache, getLiveCatalog } from '../src/srt_storage_product.js';
import { telegramNotify, esc } from '../src/telegram.js';
// src by SKY CHEATS. Copy right SKY CHEATS
import { resolveLimits, dayKey, remaining, checkLoadLimits } from '../src/employeeLimits.js';
import { notifyBalanceChange } from '../src/balanceAlerts.js';

const router = express.Router();
router.use(adminCors);
// src by SKY CHEATS. Copy right SKY CHEATS
router.use(rateLimit({ windowMs: 60_000, max: 60, name: 'employee' }));
router.use(requireEmployee);

const LIMITS = resolveLimits();

// src by SKY CHEATS. Copy right SKY CHEATS
const dayRef = () => db().collection('employeeLoads').doc(dayKey());

async function loadedToday(uid) {
  const snap = await dayRef().get();
  const d = snap.exists ? snap.data() : {};
  // src by SKY CHEATS. Copy right SKY CHEATS
  return { dayLoadedToday: Number(d.total || 0), userLoadedToday: Number(d.byUser?.[uid] || 0) };
}

router.get('/ping', asyncHandler(async (req, res) => {
  const { dayLoadedToday } = await loadedToday('');
  // src by SKY CHEATS. Copy right SKY CHEATS
  res.json({
    success: true, role: 'employee',
    maxLoad: Number.isFinite(LIMITS.perLoad) ? LIMITS.perLoad : null,
    ...remaining({ dayLoadedToday, limits: LIMITS }),
  });
// src by SKY CHEATS. Copy right SKY CHEATS
}));

router.get('/lookup', asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ success: false, error: 'Enter a UID or email' });
// src by SKY CHEATS. Copy right SKY CHEATS

  let snap;
  if (q.includes('@')) {
    const found = await db().collection('users').where('email', '==', q).limit(1).get();
    if (found.empty) return res.json({ success: true, found: false });
    // src by SKY CHEATS. Copy right SKY CHEATS
    snap = found.docs[0];
  } else {
    snap = await db().collection('users').doc(q).get();
    if (!snap.exists) return res.json({ success: true, found: false });
  }
// src by SKY CHEATS. Copy right SKY CHEATS

  const d = snap.data();
  const today = await loadedToday(snap.id);
  res.json({
    success: true,
    // src by SKY CHEATS. Copy right SKY CHEATS
    found: true,
    uid: snap.id,
    email: d.email || '',
    profileName: d.profileName || '',
    balance: Number(d.balance || 0),
    // src by SKY CHEATS. Copy right SKY CHEATS
    ...remaining({ ...today, limits: LIMITS }),
  });
}));

router.post('/load-balance', asyncHandler(async (req, res) => {
  // src by SKY CHEATS. Copy right SKY CHEATS
  const uid = String(req.body?.uid || '').trim();
  const amount = Number(req.body?.amount);
  const note = String(req.body?.note || '').trim().slice(0, 120);

  if (!uid) return res.status(400).json({ success: false, error: 'Missing user' });
  // src by SKY CHEATS. Copy right SKY CHEATS
  if (!Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({ success: false, error: 'Enter a whole number greater than 0' });
  }
  if (amount > LIMITS.perLoad) {
    const v = checkLoadLimits({ amount, limits: LIMITS });
    // src by SKY CHEATS. Copy right SKY CHEATS
    return res.status(400).json({ success: false, error: v.error });
  }

  const userRef = db().collection('users').doc(uid);
  const todayRef = dayRef();
  // src by SKY CHEATS. Copy right SKY CHEATS
  const result = await db().runTransaction(async (tx) => {
    const [snap, daySnap] = await Promise.all([tx.get(userRef), tx.get(todayRef)]);
    if (!snap.exists) throw new Error('User not found');

    const day = daySnap.exists ? daySnap.data() : {};
    // src by SKY CHEATS. Copy right SKY CHEATS
    const dayLoadedToday = Number(day.total || 0);
    const userLoadedToday = Number(day.byUser?.[uid] || 0);
    const verdict = checkLoadLimits({ amount, userLoadedToday, dayLoadedToday, limits: LIMITS });
    if (!verdict.ok) throw new Error(verdict.error);

    // src by SKY CHEATS. Copy right SKY CHEATS
    const data = snap.data();
    const before = Number(data.balance || 0);
    const after = before + amount;

    const log = data.adminLog || [];
    // src by SKY CHEATS. Copy right SKY CHEATS
    log.push({
      delta: amount,
      note: `[employee] ${note || 'Balance load'}`,
      resultingBalance: after,
      at: new Date().toISOString(),
    // src by SKY CHEATS. Copy right SKY CHEATS
    });

    const pro = depositUpdate(data, amount, after);
    log.push(...pro.log);
    tx.set(userRef, { balance: after, adminLog: log, ...pro.fields }, { merge: true });
    // src by SKY CHEATS. Copy right SKY CHEATS
    tx.set(todayRef, {
      total: dayLoadedToday + amount,
      byUser: { [uid]: userLoadedToday + amount },
      updatedAt: Date.now(),
    }, { merge: true });
// src by SKY CHEATS. Copy right SKY CHEATS

    return {
      before, after, email: data.email || '',
      proFieldsTouched: Object.keys(pro.fields).length > 0,
      proAct: pro.activated ? { name: data.profileName, deposited: pro.fields.proReseller.depositSinceApproval } : null,
      // src by SKY CHEATS. Copy right SKY CHEATS
      ...remaining({ userLoadedToday: userLoadedToday + amount, dayLoadedToday: dayLoadedToday + amount, limits: LIMITS }),
    };
  }).catch((e) => ({ error: e.message }));

  if (result.error) return res.status(400).json({ success: false, error: result.error });
  // src by SKY CHEATS. Copy right SKY CHEATS
  invalidateUserDoc(uid, result.proAct || result.proFieldsTouched ? { history: false } : { history: false, balance: result.after });
  if (result.proAct) announceProActivated({ uid, email: result.email, ...result.proAct });

  notifyBalanceChange({
    actor: 'EMPLOYEE', kind: 'load',
    // src by SKY CHEATS. Copy right SKY CHEATS
    uid, email: result.email, amount, before: result.before, after: result.after, note,
    extraLines: [
      `📅 Loaded to this user today: NRP ${Number(result.userLoadedToday).toLocaleString('en-US')}`,
      `👥 Team total today: NRP ${Number(result.dayLoadedToday).toLocaleString('en-US')}`,
    ],
  // src by SKY CHEATS. Copy right SKY CHEATS
  });

  res.json({
    success: true, newBalance: result.after,
    userLoadedToday: result.userLoadedToday, dayLoadedToday: result.dayLoadedToday,
    // src by SKY CHEATS. Copy right SKY CHEATS
    userLeftToday: result.userLeftToday, dayLeft: result.dayLeft, maxNow: result.maxNow,
  });
}));

router.get('/products', asyncHandler(async (req, res) => {
  // src by SKY CHEATS. Copy right SKY CHEATS
  const [overrides, catalog] = await Promise.all([getMaintenanceOverrides(), getLiveCatalog('user')]);

  const products = Object.keys(catalog)
    .filter((sku) => !['whatsapp', 'shopsrc'].includes(catalog[sku].type))
    .map((sku) => {
      // src by SKY CHEATS. Copy right SKY CHEATS
      const p = catalog[sku];
      const o = overrides[sku];
      const maintenance = o ? !!o.maintenance : !!p.maintenance;
      return { sku, row: p.row, name: p.name, duration: p.duration, maintenance };
    });
// src by SKY CHEATS. Copy right SKY CHEATS

  res.json({ success: true, products });
}));

router.post('/products/:sku/maintenance', asyncHandler(async (req, res) => {
  // src by SKY CHEATS. Copy right SKY CHEATS
  const sku = String(req.params.sku || '').trim();
  const catalog = await getLiveCatalog('user');
  if (!catalog[sku]) return res.status(404).json({ success: false, error: 'Unknown product' });

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

  telegramNotify(
    `🛠 <b>EMPLOYEE ${maintenance ? 'PUT IN MAINTENANCE' : 'RESTORED'}</b>\n` +
    `Product: ${esc(catalog[sku].name || sku)}\n` +
    `SKU: <code>${esc(sku)}</code>`
  // src by SKY CHEATS. Copy right SKY CHEATS
  );

  res.json({ success: true, sku, maintenance });
}));

// src by SKY CHEATS. Copy right SKY CHEATS
export default router;
