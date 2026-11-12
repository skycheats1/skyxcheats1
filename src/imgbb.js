// src by SKY CHEATS. Copy right SKY CHEATS
import crypto from 'node:crypto';
import { db } from './firebase.js';

const MAX_BASE64_CHARS = 1_500_000;
// Self-hosted fallback (used when ImgBB refuses us, e.g. "forbidden to use this website"):
// the image is kept in Firestore (collection uploadedImages) and served by GET /img/:id on this backend.
const MAX_SELF_HOST_BYTES = 900_000;   // Firestore documents are limited to 1 MiB

function backendBase() {
  return String(process.env.PUBLIC_BACKEND_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
}

async function selfHostImage(b64) {
  const base = backendBase();
  if (!base) throw httpError(500, 'Image hosting is not configured (set PUBLIC_BACKEND_URL on the server).');
  const buf = Buffer.from(b64, 'base64');
  if (buf.length > MAX_SELF_HOST_BYTES) throw httpError(413, 'Image is too large. Pick a smaller size.');
  const mime = buf[0] === 0x89 ? 'image/png' : buf[0] === 0xff ? 'image/jpeg' : 'image/webp';
  const id = crypto.randomBytes(12).toString('hex');
  await db().collection('uploadedImages').doc(id).set({ mime, data: buf, size: buf.length, createdAt: Date.now() });
  return `${base}/img/${id}`;
}

export async function serveUploadedImage(req, res) {
  const id = String(req.params.id || '');
  if (!/^[a-f0-9]{24}$/.test(id)) return res.status(404).end();
  const snap = await db().collection('uploadedImages').doc(id).get();
  if (!snap.exists) return res.status(404).end();
  const d = snap.data();
  const data = Buffer.isBuffer(d.data) ? d.data : Buffer.from(d.data.toUint8Array ? d.data.toUint8Array() : d.data);
  res.set({ 'Content-Type': d.mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'Cross-Origin-Resource-Policy': 'cross-origin', 'Access-Control-Allow-Origin': '*' });
  res.end(data);
}

function httpError(status, message) {
  const e = new Error(message);
  // src by SKY CHEATS. Copy right SKY CHEATS
  e.status = status;
  return e;
}

function normalizeImage(input, maxChars = MAX_BASE64_CHARS) {
  // src by SKY CHEATS. Copy right SKY CHEATS
  const raw = String(input || '').trim();
  if (!raw) throw httpError(400, 'No image received.');

  const m = raw.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
  const b64 = (m ? m[2] : raw).replace(/\s+/g, '');
  // src by SKY CHEATS. Copy right SKY CHEATS
  if (!/^[A-Za-z0-9+/=]+$/.test(b64)) throw httpError(400, 'Image data is not valid base64.');
  if (b64.length > maxChars) throw httpError(413, 'Image is too large. Pick a smaller size.');

  const head = Buffer.from(b64.slice(0, 24), 'base64');
  const isPng = head.length >= 4 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  // src by SKY CHEATS. Copy right SKY CHEATS
  const isJpg = head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const isWebp = head.length >= 12 && head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP';
  if (!isPng && !isJpg && !isWebp) throw httpError(400, 'Only PNG, JPG or WebP images are allowed.');
  return b64;
}
// src by SKY CHEATS. Copy right SKY CHEATS

export async function uploadImage(imageInput, namePrefix, { maxChars } = {}) {
  const key = process.env.IMGBB_API_KEY;
  const endpoint = process.env.IMGBB_ENDPOINT || 'https://api.imgbb.com/1/upload';
// src by SKY CHEATS. Copy right SKY CHEATS

  const image = normalizeImage(imageInput, maxChars || MAX_BASE64_CHARS);
  if (!key || process.env.IMAGE_HOST === 'self') return selfHostImage(image);

  const body = new URLSearchParams();
  body.set('key', key);
  // src by SKY CHEATS. Copy right SKY CHEATS
  body.set('image', image);
  body.set('name', `${namePrefix}_${Date.now()}`);

  let res;
  try {
    // src by SKY CHEATS. Copy right SKY CHEATS
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
      signal: AbortSignal.timeout(20_000),
    // src by SKY CHEATS. Copy right SKY CHEATS
    });
  } catch (e) {
    console.error('[imgbb] unreachable, using self-host:', e?.message);
    return selfHostImage(image);
  }

  // src by SKY CHEATS. Copy right SKY CHEATS
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }

  if (!res.ok || !json || json.success === false) {
    // src by SKY CHEATS. Copy right SKY CHEATS
    const reason = json?.error?.message || json?.status_txt || `HTTP ${res.status}`;
    console.error('[imgbb] upload failed:', res.status, String(reason).slice(0, 200));
    return selfHostImage(image);
  }

  // src by SKY CHEATS. Copy right SKY CHEATS
  const url = json?.data?.display_url || json?.data?.url;
  if (!url || !/^https:\/\//i.test(url)) {
    console.error('[imgbb] no usable URL in response');
    return selfHostImage(image);
  }
  // src by SKY CHEATS. Copy right SKY CHEATS
  return url;
}

export const uploadAvatar = (imageInput, uid) => uploadImage(imageInput, `avatar_${String(uid).slice(0, 12)}`);
