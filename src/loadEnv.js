// src by SKY CHEATS. Copy right SKY CHEATS
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// src by SKY CHEATS. Copy right SKY CHEATS
const dir = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(dir, '..', '.env');

try {
  if (fs.existsSync(file)) {
    // src by SKY CHEATS. Copy right SKY CHEATS
    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      // src by SKY CHEATS. Copy right SKY CHEATS
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      // src by SKY CHEATS. Copy right SKY CHEATS
      if (process.env[key] === undefined) process.env[key] = val;
    }
  }
} catch (e) {
  console.warn('[env] could not read .env:', e.message);
// src by SKY CHEATS. Copy right SKY CHEATS
}
