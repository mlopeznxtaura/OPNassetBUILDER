export function gfNewId() {
  return 'a_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function emptyLibrary() {
  return { version: 1, assets: [] };
}

export function emptyLevel() {
  return { version: 1, ground: { size: 60 }, placements: [] };
}

export function emptyState() {
  return { revision: 0, library: emptyLibrary(), level: emptyLevel() };
}

function clampInt(n, min, max) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

export function gfValidateAsset(asset) {
  const errors = [];
  if (!asset || typeof asset !== 'object') return ['asset must be an object'];
  if (!asset.id) errors.push('missing id');
  if (!asset.name) errors.push('missing name');
  if (asset.kind !== 'voxel' && asset.kind !== 'sprite') errors.push('kind must be voxel or sprite');
  if (asset.kind === 'voxel') {
    if (!asset.voxel || !Array.isArray(asset.voxel.voxels)) errors.push('voxel data missing');
    else if (!Array.isArray(asset.voxel.size) || asset.voxel.size.length !== 3) errors.push('voxel size missing');
  }
  if (asset.kind === 'sprite' && (!asset.sprite || !Array.isArray(asset.sprite.pixels))) errors.push('sprite data missing');
  return errors;
}

export function createVoxelAsset({ id, name, size = [6, 6, 6], collidable = true } = {}) {
  return {
    id: id || gfNewId(),
    name: name || 'unnamed',
    kind: 'voxel',
    collidable: collidable !== false,
    voxel: {
      size: [clampInt(size[0], 1, 24), clampInt(size[1], 1, 24), clampInt(size[2], 1, 24)],
      cellSize: 1,
      voxels: []
    },
    createdAt: Date.now()
  };
}

export function createSpriteAsset({ id, name, w = 16, h = 16, collidable = false } = {}) {
  const width = clampInt(w, 1, 64);
  const height = clampInt(h, 1, 64);
  return {
    id: id || gfNewId(),
    name: name || 'unnamed',
    kind: 'sprite',
    collidable: !!collidable,
    sprite: { w: width, h: height, pixels: new Array(width * height).fill('') },
    createdAt: Date.now()
  };
}

export function findAsset(library, { id, name } = {}) {
  if (id) return library.assets.find(a => a.id === id) || null;
  if (name) {
    const matches = library.assets.filter(a => a.name === name);
    return matches.length ? matches[matches.length - 1] : null;
  }
  return null;
}

export function upsertAsset(library, asset) {
  const idx = library.assets.findIndex(a => a.id === asset.id);
  if (idx >= 0) library.assets[idx] = asset;
  else library.assets.push(asset);
  return library;
}

export function deleteAsset(library, id) {
  library.assets = library.assets.filter(a => a.id !== id);
  return library;
}

export function paintVoxelCells(asset, cells) {
  if (!asset || asset.kind !== 'voxel' || !asset.voxel) throw new Error('not a voxel asset');
  const errors = [];
  const [sx, sy, sz] = asset.voxel.size;
  for (const cell of cells || []) {
    const x = Number(cell.x);
    const y = Number(cell.y);
    const z = Number(cell.z);
    if (![x, y, z].every(Number.isFinite)) {
      errors.push('cell missing x,y,z');
      continue;
    }
    if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) {
      errors.push('out of bounds ' + x + ',' + y + ',' + z);
      continue;
    }
    const idx = asset.voxel.voxels.findIndex(v => v.x === x && v.y === y && v.z === z);
    if (cell.erase || cell.c === '') {
      if (idx >= 0) asset.voxel.voxels.splice(idx, 1);
    } else if (typeof cell.c === 'string' && cell.c && cell.c.length <= 32) {
      if (idx >= 0) asset.voxel.voxels[idx].c = cell.c;
      else asset.voxel.voxels.push({ x, y, z, c: cell.c });
    } else {
      errors.push('cell ' + x + ',' + y + ',' + z + ' needs a color or erase');
    }
  }
  return errors;
}

export function paintSpritePixels(asset, pixels) {
  if (!asset || asset.kind !== 'sprite' || !asset.sprite) throw new Error('not a sprite asset');
  const { w, h } = asset.sprite;
  const errors = [];
  for (const p of pixels || []) {
    const x = Number(p.x);
    const y = Number(p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= w || y >= h) {
      errors.push('sprite pixel out of bounds ' + p.x + ',' + p.y);
      continue;
    }
    asset.sprite.pixels[y * w + x] = (p.erase || p.c === '') ? '' : String(p.c || '');
  }
  return errors;
}

export function placementRadius(asset, scale = 1) {
  const s = Number(scale) || 1;
  if (!asset || asset.kind !== 'voxel' || !asset.voxel) return 0.6 * s;
  const [x, , z] = asset.voxel.size;
  return Math.max(x, z) * (asset.voxel.cellSize || 1) * 0.5 * s;
}

export function collidesAt(library, level, x, z, playerRadius = 0.5) {
  const hits = [];
  for (const p of (level && level.placements) || []) {
    const asset = ((library && library.assets) || []).find(a => a.id === p.assetId);
    const collidable = p.collidable != null ? !!p.collidable : !!(asset && asset.collidable);
    if (!collidable) continue;
    const radius = placementRadius(asset, p.scale || 1);
    const dist = Math.hypot(x - p.x, z - p.z);
    if (dist < radius + playerRadius) hits.push({ id: p.id, assetId: p.assetId, dist, radius });
  }
  return { hit: hits.length > 0, hits };
}

export function summarizeAsset(asset) {
  if (!asset) return null;
  if (asset.kind === 'voxel') {
    return {
      id: asset.id,
      name: asset.name,
      kind: asset.kind,
      collidable: !!asset.collidable,
      size: asset.voxel.size,
      voxelCount: asset.voxel.voxels.length
    };
  }
  return {
    id: asset.id,
    name: asset.name,
    kind: asset.kind,
    collidable: !!asset.collidable,
    sprite: {
      w: asset.sprite.w,
      h: asset.sprite.h,
      opaque: asset.sprite.pixels.filter(Boolean).length
    }
  };
}

export function testState(state, body = {}) {
  const library = state.library || emptyLibrary();
  const level = state.level || emptyLevel();
  const assets = library.assets.map(a => ({ ...summarizeAsset(a), errors: gfValidateAsset(a) }));
  const probes = Array.isArray(body.probes) && body.probes.length ? body.probes : [{ x: 0, z: 0 }];
  const playerRadius = Number(body.playerRadius) || 0.5;
  return {
    ok: assets.every(a => a.errors.length === 0),
    revision: state.revision,
    assetCount: library.assets.length,
    placementCount: (level.placements || []).length,
    assets,
    probes: probes.map(p => {
      const x = Number(p.x) || 0;
      const z = Number(p.z) || 0;
      return { x, z, ...collidesAt(library, level, x, z, playerRadius) };
    })
  };
}

export function memoryStore(initial) {
  let state = structuredClone(initial || emptyState());
  return {
    async getState() {
      return structuredClone(state);
    },
    async mutate(fn) {
      const next = structuredClone(state);
      const extra = fn(next) || {};
      next.revision = (next.revision || 0) + 1;
      state = next;
      return { revision: next.revision, ...extra };
    }
  };
}
