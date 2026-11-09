// src by SKY CHEATS. Copy right SKY CHEATS
import { db } from './firebase.js';
import { cachedLoader, TTL } from './cache.js';
import { listBots, botToBoardRow } from './leaderboardBots.js';
import { cosmeticsFor, NO_COSMETICS } from './rewards.js';
// src by SKY CHEATS. Copy right SKY CHEATS

export const leaderboardCache = cachedLoader(async () => {
  const [snap, bots] = await Promise.all([
    db().collection('users').orderBy('totalKeysBought', 'desc').limit(10).get(),
    listBots().catch((e) => { console.error('[leaderboard] promo entries failed:', e.message); return []; }),
  // src by SKY CHEATS. Copy right SKY CHEATS
  ]);
  const real = snap.docs.map((doc) => {
    const d = doc.data();
    return {
      uid: doc.id,
      // src by SKY CHEATS. Copy right SKY CHEATS
      name: d.profileName || (d.email ? d.email.split('@')[0] : 'Anonymous'),
      avatarUrl: d.avatarUrl || '',
      totalKeysBought: Number(d.totalKeysBought || 0),
      totalSpent: Number(d.totalSpent || 0),
      badge: '',
      // src by SKY CHEATS. Copy right SKY CHEATS
      cosmetics: NO_COSMETICS,
    };
  });
  try {
    const worn = await cosmeticsFor(real.map((r) => r.uid));
    // src by SKY CHEATS. Copy right SKY CHEATS
    real.forEach((r) => { r.cosmetics = worn.get(r.uid) || NO_COSMETICS; });
  } catch (e) { console.error('[leaderboard] cosmetics failed:', e.message); }
  return [...real, ...bots.map(botToBoardRow)]
    .filter((row) => row.totalKeysBought > 0)
    .sort((a, b) => b.totalKeysBought - a.totalKeysBought || b.totalSpent - a.totalSpent)
    // src by SKY CHEATS. Copy right SKY CHEATS
    .slice(0, 10);
}, { ttlMs: TTL.leaderboard, name: 'leaderboard', versionKey: 'leaderboard' });

export const announcementCache = cachedLoader(async () => {
  const snap = await db().collection('announcements').where('active', '==', true).limit(20).get();
  // src by SKY CHEATS. Copy right SKY CHEATS
  return snap.empty ? [] : snap.docs.map((d) => d.data());
}, { ttlMs: TTL.announcement, name: 'announcements', versionKey: 'announcement' });

export const announcementListCache = cachedLoader(async () => {
  const snap = await db().collection('announcements').orderBy('createdAt', 'desc').limit(50).get();
  // src by SKY CHEATS. Copy right SKY CHEATS
  return snap.docs.map((d) => d.data());
}, { ttlMs: TTL.announcement, name: 'announcementList' });

export const policyCache = cachedLoader(async () => {
  const snap = await db().collection('config').doc('policy').get();
  // src by SKY CHEATS. Copy right SKY CHEATS
  const data = snap.exists ? snap.data() : {};
  return {
    title: data.title || 'Terms & Policy',
    body: data.body || 'No policy has been published yet. Please check back later.',
    updatedAt: data.updatedAt || null,
  // src by SKY CHEATS. Copy right SKY CHEATS
  };
}, { ttlMs: TTL.policy, name: 'policy', versionKey: 'policy' });
