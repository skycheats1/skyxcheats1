// src by SKY CHEATS. Copy right SKY CHEATS
import express from 'express';
import { asyncHandler } from '../src/asyncHandler.js';
import { requireFirebaseUid, userCors } from '../src/firebase.js';
import { rateLimit } from '../src/security.js';
// src by SKY CHEATS. Copy right SKY CHEATS
import { getUserDoc } from '../src/userCache.js';
import { leaderboardCache } from '../src/sharedCaches.js';
import { RuleError } from '../src/profileRules.js';
import { getRewardState, claimMission, setEquipped } from '../src/rewards.js';
// src by SKY CHEATS. Copy right SKY CHEATS

const router = express.Router();
router.use(userCors);
router.use(requireFirebaseUid);
router.use(rateLimit({ windowMs: 60_000, max: 40, name: 'rewards' }));
// src by SKY CHEATS. Copy right SKY CHEATS

const fail = (res, e) => {
  if (e instanceof RuleError) return res.status(e.status).json({ success: false, error: e.message, ...(e.extra || {}) });
  throw e;
};
// src by SKY CHEATS. Copy right SKY CHEATS

router.get('/', asyncHandler(async (req, res) => {
  const snap = await getUserDoc(req.uid);
  const total = snap.exists ? Number(snap.data.totalKeysBought || 0) : 0;
  res.json({ success: true, ...(await getRewardState(req.uid, total)) });
// src by SKY CHEATS. Copy right SKY CHEATS
}));

router.post('/claim', asyncHandler(async (req, res) => {
  let r;
  try { r = await claimMission(req.uid, req.body?.id); } catch (e) { return fail(res, e); }
// src by SKY CHEATS. Copy right SKY CHEATS

  leaderboardCache.invalidate();

  res.json({ success: true, id: r.mission.id, equipped: r.equipped, unlocked: r.unlocked });
}));

router.post('/equip', asyncHandler(async (req, res) => {
  let equipped;
  // src by SKY CHEATS. Copy right SKY CHEATS
  try { equipped = await setEquipped(req.uid, req.body || {}); } catch (e) { return fail(res, e); }
  leaderboardCache.invalidate();
  res.json({ success: true, equipped });
}));

// src by SKY CHEATS. Copy right SKY CHEATS
export default router;
