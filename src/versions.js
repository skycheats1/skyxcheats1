// src by SKY CHEATS. Copy right SKY CHEATS
import admin from 'firebase-admin';
import { db } from './firebase.js';

const bootId = Date.now().toString(36);
// src by SKY CHEATS. Copy right SKY CHEATS
export const GLOBAL_KEYS = ['catalog', 'leaderboard', 'announcement', 'feedback', 'policy'];
const EPOCH_KEY = 'usersEpoch';

const base = {};
const local = {};
// src by SKY CHEATS. Copy right SKY CHEATS
const dirty = {};
let loaded = false;
let flushTimer = null;

const userInfo = new Map();
// src by SKY CHEATS. Copy right SKY CHEATS

const ref = () => db().collection('config').doc('versions');
const n = (o, k) => o[k] || 0;

export async function loadVersions() {
  // src by SKY CHEATS. Copy right SKY CHEATS
  try {
    const snap = await ref().get();
    const d = snap.exists ? snap.data() : {};
    for (const k of [...GLOBAL_KEYS, EPOCH_KEY]) base[k] = Number(d[k] || 0);
    loaded = true;
    // src by SKY CHEATS. Copy right SKY CHEATS
    if (Object.keys(dirty).length) scheduleFlush();
  } catch (e) {
    console.error('[versions] could not load persisted stamps, using boot-scoped ones:', e?.message || e);
  }
}
// src by SKY CHEATS. Copy right SKY CHEATS

function scheduleFlush() {
  if (!loaded || flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    // src by SKY CHEATS. Copy right SKY CHEATS
    const batch = { ...dirty };
    for (const k of Object.keys(batch)) delete dirty[k];
    if (!Object.keys(batch).length) return;
    try {
      const upd = {};
      // src by SKY CHEATS. Copy right SKY CHEATS
      for (const [k, v] of Object.entries(batch)) upd[k] = admin.firestore.FieldValue.increment(v);
      await ref().set(upd, { merge: true });
    } catch (e) {
      console.error('[versions] persist failed:', e?.message || e);
    }
  // src by SKY CHEATS. Copy right SKY CHEATS
  }, 3000);
  flushTimer.unref?.();
}

function bumpCounter(key) {
  // src by SKY CHEATS. Copy right SKY CHEATS
  local[key] = n(local, key) + 1;
  dirty[key] = n(dirty, key) + 1;
  scheduleFlush();
}

// src by SKY CHEATS. Copy right SKY CHEATS
export function bump(key) { bumpCounter(key); }
export function bumpAllUsers() { bumpCounter(EPOCH_KEY); }

const gen = () => (loaded ? 'p' : `b${bootId}`);
const globalStamp = (k) => `${gen()}.${(loaded ? n(base, k) : 0) + n(local, k)}`;
// src by SKY CHEATS. Copy right SKY CHEATS
const userEpoch = () => `${gen()}${(loaded ? n(base, EPOCH_KEY) : 0) + n(local, EPOCH_KEY)}`;
const userStamp = (t) => `${userEpoch()}.${t || 0}`;

export function bumpUser(uid, { history = true, balance = null } = {}) {
  if (userInfo.size > 50000) userInfo.clear();
  // src by SKY CHEATS. Copy right SKY CHEATS
  const cur = userInfo.get(uid) || { t: 0, h: 0, bal: null };
  const prev = userStamp(cur.t);
  let t = Date.now();
  if (t <= cur.t) t = cur.t + 1;
  const next = { t, h: history ? t : cur.h, bal: null };
  // src by SKY CHEATS. Copy right SKY CHEATS
  if (balance !== null && Number.isFinite(Number(balance)) && !history) {
    next.bal = { prev, stamp: userStamp(t), balance: Number(balance) };
  }
  userInfo.set(uid, next);
}
// src by SKY CHEATS. Copy right SKY CHEATS

export function getVersions(uid) {
  const info = userInfo.get(uid);
  const out = { user: userStamp(info?.t), history: userStamp(info?.h) };
  for (const k of GLOBAL_KEYS) out[k] = globalStamp(k);
  // src by SKY CHEATS. Copy right SKY CHEATS
  if (info?.bal) out.balancePatch = info.bal;
  return out;
}
