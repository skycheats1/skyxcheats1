// src by SKY CHEATS. Copy right SKY CHEATS
import { db } from './firebase.js';
import { getMaintenanceOverrides, getCustomProductsCached } from './sky_storage_product.js';
import { matchProduct, apiLabel } from './apiMatch.js';
import { tierPrice } from './sky_storage_product.js';

// src by SKY CHEATS. Copy right SKY CHEATS
// Price for the caller's role: user -> price, reseller -> priceReseller, pro_reseller -> priceProReseller.
// Same rule as the website checkout (tierPrice) so API and web can never disagree.
export const resellerPrice = (p, role = 'reseller') => Number(tierPrice(p, role === 'user' ? 'reseller' : role));

const toStatus = (maintenance, outOfStock) => (maintenance ? 'maintenance' : outOfStock ? 'out_of_stock' : 'available');

export async function listApiProducts(role = 'reseller') {
  // src by SKY CHEATS. Copy right SKY CHEATS
  const [custom, overrides] = await Promise.all([
    getCustomProductsCached(),
    getMaintenanceOverrides().catch(() => ({})),
  ]);

  // src by SKY CHEATS. Copy right SKY CHEATS
  return Object.entries(custom)
    .map(([sku, d]) => {
      const o = overrides[sku] || {};
      return {
        sku,
        // src by SKY CHEATS. Copy right SKY CHEATS
        row: d.row || d.name || '',
        name: d.name || '',
        pid: String(d.pid ?? ''),
        label: apiLabel(d),
        price: resellerPrice(d, role),
        // src by SKY CHEATS. Copy right SKY CHEATS
        requiresAndroidId: !!d.requiresAndroidId,
        status: toStatus(!!o.maintenance, !!o.outOfStock),
      };
    })
    .sort((a, b) => a.row.localeCompare(b.row) || a.price - b.price);
// src by SKY CHEATS. Copy right SKY CHEATS
}

export async function loadPidProducts(pid) {
  const snap = await db().collection('customProducts').where('pid', '==', String(pid ?? '').trim()).get();
  return snap.docs.map((d) => ({ sku: d.id, ...d.data() }));
// src by SKY CHEATS. Copy right SKY CHEATS
}

export async function findApiProduct(pid, duration, role = 'reseller') {
  const products = await loadPidProducts(pid);
  const m = matchProduct(products, pid, duration);
  // src by SKY CHEATS. Copy right SKY CHEATS
  if (m.error) return m;
  const p = m.product;
  return { product: { ...p, price: resellerPrice(p, role), label: apiLabel(p) } };
}
