// src by SKY CHEATS. Copy right SKY CHEATS
import { db } from './firebase.js';
import { cachedKeyedLoader, TTL } from './cache.js';
import { bumpUser, bumpAllUsers } from './versions.js';
import { markDirty, markAllDirty } from './adminDirectory.js';
// src by SKY CHEATS. Copy right SKY CHEATS

const users = cachedKeyedLoader(async (uid) => {
  const snap = await db().collection('users').doc(uid).get();
  return { exists: snap.exists, data: snap.exists ? snap.data() : null, at: Date.now() };
}, { ttlMs: TTL.userDoc, name: 'userDoc' });
// src by SKY CHEATS. Copy right SKY CHEATS

export function getUserDoc(uid) {
  return users.get(uid);
}

// src by SKY CHEATS. Copy right SKY CHEATS
export function invalidateUserDoc(uid, opts = {}) {
  users.invalidate(uid);
  bumpUser(uid, opts);
  markDirty(uid);
}
// src by SKY CHEATS. Copy right SKY CHEATS

export function invalidateAllUserDocs() {
  users.invalidateAll();
  bumpAllUsers();
  markAllDirty();
// src by SKY CHEATS. Copy right SKY CHEATS
}
