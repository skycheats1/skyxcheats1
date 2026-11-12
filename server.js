// src by SKY CHEATS. Copy right SKY CHEATS
import './src/loadEnv.js';
import express from 'express';
import { getFirebaseApp } from './src/firebase.js';
import { useRealClientIp, securityHeaders, rateLimit, redact } from './src/security.js';
import { userCors } from './src/firebase.js';
import { getLiveCatalog } from './src/sky_storage_product.js';
import { leaderboardCache } from './src/sharedCaches.js';
import { asyncHandler } from './src/asyncHandler.js';
import { startHealthMonitor } from './src/healthMonitor.js';
import { registerTopupWebhook } from './src/topupQr.js';
import { registerPublicWebhook } from './src/publicBot.js';
import { registerDepositWebhook } from './src/depositBot.js';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/user.js';
import purchaseRoutes from './routes/purchase.js';
import rewardsRoutes from './routes/rewards.js';
import supportRoutes from './routes/support.js';
import gloryRoutes from './routes/gulaa_bot.js';
import adminRoutes from './routes/sky_owner.js';
import employeeRoutes from './routes/employee.js';
import keysRoutes from './routes/keys-lookup.js';
import topupWebhook from './routes/telegram-topup.js';
import publicWebhook from './routes/telegram-public.js';
import depositWebhook from './routes/telegram-deposit.js';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(useRealClientIp);
app.use(securityHeaders);

// Health first: Render's health check must answer even if Firestore/env is misconfigured.
const health = (_req, res) => res.json({ ok: true, service: 'sky-backend' });
app.get('/', health);
app.get('/health', health);
app.get('/api/health', health);

app.use(express.json({ limit: '4mb' }));

// Telegram webhooks are exempt from the global API rate limit (secret header protects them).
app.use('/api/telegram', topupWebhook);
app.use('/api/telegram', publicWebhook);
app.use('/api/telegram', depositWebhook);

app.use('/api', rateLimit({ windowMs: 60_000, max: 180, name: 'api' }));

// Public (no login) catalog + leaderboard used by the store/dashboard pages.
app.get('/api/catalog', userCors, asyncHandler(async (_req, res) => {
  res.json({ success: true, catalog: await getLiveCatalog('user') });
}));
app.get('/api/leaderboard', userCors, asyncHandler(async (_req, res) => {
  res.json({ success: true, leaderboard: await leaderboardCache.get() });
}));

app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/purchase', purchaseRoutes);
app.use('/api/rewards', rewardsRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/glory', gloryRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/employee', employeeRoutes);
app.use('/api/keys', keysRoutes);

app.use((req, res) => res.status(404).json({ success: false, error: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error('[server] error:', redact(err?.stack || err?.message || err).slice(0, 500));
  if (res.headersSent) return;
  const known = err?.status && err.status < 500;
  // TEMPORARY DIAGNOSTIC: shows the real reason in the browser. Set SHOW_ERROR_DETAIL=0 on Render to hide it again.
  const detail = process.env.SHOW_ERROR_DETAIL === '0' ? '' : redact(err?.message || err).replace(/\s+/g, ' ').slice(0, 220);
  res.status(err?.status || 500).json({ success: false, error: known ? err.message : (detail ? `Server error: ${detail}` : 'Server error') });
});

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', redact(e?.stack || e).slice(0, 500)));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', redact(e?.stack || e).slice(0, 500)));

// Bind the port FIRST (Render needs an open port quickly), then do the slow/optional startup work.
const PORT = Number(process.env.PORT) || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`sky-backend listening on port ${PORT}`);
  try { getFirebaseApp(); console.log('[firebase] initialised'); }
  catch (e) { console.error('[firebase] NOT initialised:', e.message); }
  for (const [name, fn] of [['topup', registerTopupWebhook], ['public', registerPublicWebhook], ['deposit', registerDepositWebhook]]) {
    Promise.resolve().then(fn).catch((e) => console.warn(`[${name}-bot] webhook registration failed:`, redact(e?.message || e)));
  }
  try { startHealthMonitor(); } catch (e) { console.warn('[health] monitor failed to start:', e.message); }
});
