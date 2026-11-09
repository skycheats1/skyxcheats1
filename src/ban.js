// src by SKY CHEATS. Copy right SKY CHEATS
export const BAN_DURATIONS = {
  '1h':        { ms: 1 * 3600_000,       label: '1 Hour' },
  '12h':       { ms: 12 * 3600_000,      label: '12 Hours' },
  '1d':        { ms: 24 * 3600_000,      label: '1 Day' },
  // src by SKY CHEATS. Copy right SKY CHEATS
  '3d':        { ms: 3 * 24 * 3600_000,  label: '3 Days' },
  '7d':        { ms: 7 * 24 * 3600_000,  label: '7 Days' },
  'permanent': { ms: null,               label: 'Permanent' },
};

// src by SKY CHEATS. Copy right SKY CHEATS
export function activeBan(userData, now = Date.now()) {
  const b = userData && userData.ban;
  if (!b || typeof b !== 'object') return null;
  if (b.permanent === true) return { permanent: true, until: null, label: b.label || 'Permanent', at: b.at || null };
  const until = Number(b.until || 0);
  // src by SKY CHEATS. Copy right SKY CHEATS
  if (until > now) return { permanent: false, until, label: b.label || '', at: b.at || null };
  return null;
}

export function makeBan(duration, by = 'admin', now = Date.now()) {
  // src by SKY CHEATS. Copy right SKY CHEATS
  const d = BAN_DURATIONS[duration];
  if (!d) return null;
  return {
    permanent: d.ms === null,
    until: d.ms === null ? null : now + d.ms,
    // src by SKY CHEATS. Copy right SKY CHEATS
    label: d.label,
    at: now,
    by,
  };
}
// src by SKY CHEATS. Copy right SKY CHEATS

export function banBody(ban, user = {}) {
  return {
    success: false,
    code: 'BANNED',
    // src by SKY CHEATS. Copy right SKY CHEATS
    error: 'Your account has been banned by admin.',
    ban: { permanent: ban.permanent, until: ban.until, label: ban.label, serverNow: Date.now() },
    user: { name: String(user.name || ''), uid: String(user.uid || ''), email: String(user.email || '') },
  };
}
// src by SKY CHEATS. Copy right SKY CHEATS
