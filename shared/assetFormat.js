/**
 * GameForge asset format
 * Two asset kinds: 'voxel' (3D block model) and 'sprite' (2D pixel art, billboard-rendered).
 *
 * Asset {
 *   id: string
 *   name: string
 *   kind: 'voxel' | 'sprite'
 *   collidable: boolean
 *   voxel?: { size: [x,y,z], cellSize: number, voxels: {x,y,z,c}[] }  // c = hex color string
 *   sprite?: { w: number, h: number, pixels: string[] }  // pixels row-major, hex color or '' for transparent
 *   createdAt: number
 * }
 *
 * Library { version: 1, assets: Asset[] }
 * Level { version: 1, ground: {size:number}, placements: {assetId, x, y, z, ry, scale}[] }
 */

const GF_STORAGE_KEY = 'gameforge_assets_v1';

function gfNewId() {
  return 'a_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function gfLoadLibrary() {
  try {
    const raw = localStorage.getItem(GF_STORAGE_KEY);
    if (!raw) return { version: 1, assets: [] };
    const parsed = JSON.parse(raw);
    if (!parsed.assets) return { version: 1, assets: [] };
    return parsed;
  } catch (e) {
    console.error('gfLoadLibrary failed', e);
    return { version: 1, assets: [] };
  }
}

function gfSaveLibrary(lib) {
  localStorage.setItem(GF_STORAGE_KEY, JSON.stringify(lib));
}

function gfUpsertAsset(asset) {
  const lib = gfLoadLibrary();
  const idx = lib.assets.findIndex(a => a.id === asset.id);
  if (idx >= 0) lib.assets[idx] = asset;
  else lib.assets.push(asset);
  gfSaveLibrary(lib);
  return lib;
}

function gfDeleteAsset(id) {
  const lib = gfLoadLibrary();
  lib.assets = lib.assets.filter(a => a.id !== id);
  gfSaveLibrary(lib);
  return lib;
}

function gfDownloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function gfReadFileAsJSON(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      try { resolve(JSON.parse(r.result)); }
      catch (e) { reject(e); }
    };
    r.onerror = reject;
    r.readAsText(file);
  });
}

function gfValidateAsset(asset) {
  const errors = [];
  if (!asset.id) errors.push('missing id');
  if (!asset.name) errors.push('missing name');
  if (asset.kind !== 'voxel' && asset.kind !== 'sprite') errors.push('kind must be voxel or sprite');
  if (asset.kind === 'voxel' && (!asset.voxel || !Array.isArray(asset.voxel.voxels))) errors.push('voxel data missing');
  if (asset.kind === 'sprite' && (!asset.sprite || !Array.isArray(asset.sprite.pixels))) errors.push('sprite data missing');
  return errors;
}
