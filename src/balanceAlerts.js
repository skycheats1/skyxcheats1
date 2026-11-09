// src by SKY CHEATS. Copy right SKY CHEATS
import { telegramNotify, esc } from './telegram.js';

const nrp = (n) => `NRP ${Number(n || 0).toLocaleString('en-US')}`;

// src by SKY CHEATS. Copy right SKY CHEATS
function nepalTime(d = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kathmandu', day: '2-digit', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d);
// src by SKY CHEATS. Copy right SKY CHEATS
}

export function buildBalanceAlert({
  actor,
  kind = 'load',
  // src by SKY CHEATS. Copy right SKY CHEATS
  title,
  uid, email, amount, before, after, note, extraLines = [],
}) {
  const isLoad = kind !== 'deduct';
  const heading = title || (isLoad ? 'BALANCE LOAD' : 'BALANCE DEDUCTION');
  // src by SKY CHEATS. Copy right SKY CHEATS
  const icon = isLoad ? '💰' : '➖';
  const sign = isLoad ? '+' : '−';

  const lines = [
    `${icon} <b>${esc(actor)} ${esc(heading)}</b>`,
    // src by SKY CHEATS. Copy right SKY CHEATS
    `👤 ${esc(email || '—')}`,
    `🆔 <code>${esc(uid || '—')}</code>`,
    `💵 Amount: <b>${sign}${nrp(amount)}</b>`,
  ];
  if (before !== undefined && after !== undefined) {
    // src by SKY CHEATS. Copy right SKY CHEATS
    lines.push(`📊 Balance: ${nrp(before)} → <b>${nrp(after)}</b>`);
  }
  for (const l of extraLines) lines.push(l);
  lines.push(`📝 Note: ${esc(note || '—')}`);
  lines.push(`🕒 ${esc(nepalTime())} (Nepal)`);
  // src by SKY CHEATS. Copy right SKY CHEATS
  return lines.join('\n');
}

export function notifyBalanceChange(args) {
  try {
    // src by SKY CHEATS. Copy right SKY CHEATS
    return telegramNotify(buildBalanceAlert(args), 'load').catch(() => {});
  } catch (e) {
    console.warn('[balanceAlerts] could not build alert:', e?.name || 'error');
    return Promise.resolve();
  }
// src by SKY CHEATS. Copy right SKY CHEATS
}
