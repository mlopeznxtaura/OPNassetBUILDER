/**
 * Upload recipe GLBs from dist/kits into the current studio session (not static /assets/).
 *
 *   npm run build:characters
 *   GAMEFORGE_ORIGIN=https://app14.nextaura.us GAMEFORGE_SESSION=s_… node scripts/upload-kit-blobs.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kitDir = path.join(__dirname, '..', 'dist', 'kits');
const origin = (process.env.GAMEFORGE_ORIGIN || 'https://app14.nextaura.us').replace(/\/$/, '');
const session = process.env.GAMEFORGE_SESSION;

if (!session) {
  console.error('Set GAMEFORGE_SESSION (same as browser sessionStorage gf_session_id or POST /api/sessions).');
  process.exit(1);
}

const ALLOWED = new Set([
  'male_belizean_web.glb',
  'male_belizean_engine.glb',
  'female_trinidadian_web.glb',
  'female_trinidadian_engine.glb'
]);

async function putFile(filename) {
  if (!ALLOWED.has(filename)) throw new Error('unexpected kit filename: ' + filename);
  const filePath = path.join(kitDir, filename);
  if (!fs.existsSync(filePath)) {
    throw new Error('Missing ' + filePath + ' — run npm run build:characters first');
  }
  const body = fs.readFileSync(filePath);
  const url = origin + '/api/blobs/' + session + '/' + filename;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'content-type': 'model/gltf-binary',
      'x-gameforge-session': session
    },
    body
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || 'PUT failed ' + res.status);
  return data.src || '/api/blobs/' + session + '/' + filename;
}

const pairs = [
  { gender: 'male', base: 'male_belizean', display: 'Belize male' },
  { gender: 'female', base: 'female_trinidadian', display: 'Trinidad female' }
];

const gender = process.env.KIT_GENDER;
const list = gender ? pairs.filter(p => p.gender === gender) : pairs;

for (const p of list) {
  const webFile = p.base + '_web.glb';
  const engFile = p.base + '_engine.glb';
  const webSrc = await putFile(webFile);
  const engineSrc = await putFile(engFile);
  console.log('\n' + p.display);
  console.log('  web:', webSrc);
  console.log('  engine:', engineSrc);
  console.log('  upsert_asset:', JSON.stringify({
    name: p.display,
    kind: 'kit',
    kit: {
      recipe: { script: 'build_characters', gender: p.gender },
      derivatives: { web: { src: webSrc }, engine: { src: engineSrc } }
    }
  }));
}
