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

export function seedVoxelStarter(asset, { hint, force = false } = {}) {
  if (!asset || asset.kind !== 'voxel' || !asset.voxel) {
    return { seeded: false, template: null, voxelCount: 0 };
  }
  if (asset.voxel.voxels.length && !force) {
    return { seeded: false, template: null, voxelCount: asset.voxel.voxels.length };
  }
  if (force) asset.voxel.voxels = [];

  const [sx, sy, sz] = asset.voxel.size;
  const name = String(hint || asset.name || '').toLowerCase();
  const cx = Math.floor(sx / 2);
  const cz = Math.floor(sz / 2);
  const cells = [];
  const add = (x, y, z, c) => {
    if (x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz) cells.push({ x, y, z, c });
  };

  const skin = '#e8b4a0';
  const shirt = '#5c9fe0';
  const pants = '#334466';
  const wood = '#a06828';
  const leaf = '#6fbf6f';
  const crateColor = '#c49a6c';

  let template = 'block';
  const isCharacter = /(hero|human|npc|player|character|female|male|person|goblin|knight|avatar|warrior)/.test(name);
  const isTree = /(tree|plant|bush)/.test(name);
  const isCrate = /(crate|box|chest|barrel)/.test(name);

  if (isCharacter) {
    template = 'humanoid';
    const headH = Math.min(2, sy);
    const legH = Math.min(2, Math.max(1, Math.floor(sy / 4)));
    const bodyTop = sy - headH;
    const bodyBottom = legH;
    for (let y = bodyTop; y < sy; y++) {
      for (let dx = -1; dx <= 0; dx++) {
        for (let dz = -1; dz <= 0; dz++) add(cx + dx, y, cz + dz, skin);
      }
    }
    for (let y = bodyBottom; y < bodyTop; y++) {
      for (let dx = -1; dx <= 0; dx++) {
        for (let dz = -1; dz <= 0; dz++) add(cx + dx, y, cz + dz, shirt);
      }
    }
    for (let y = 0; y < legH; y++) {
      add(cx - 1, y, cz, pants);
      add(cx, y, cz, pants);
    }
  } else if (isTree) {
    template = 'tree';
    const trunkH = Math.min(3, Math.max(2, Math.floor(sy / 2)));
    for (let y = 0; y < trunkH; y++) add(cx, y, cz, wood);
    const canopyY = trunkH;
    for (let dy = 0; dy < 2 && canopyY + dy < sy; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (Math.abs(dx) + Math.abs(dz) <= 1) add(cx + dx, canopyY + dy, cz + dz, leaf);
        }
      }
    }
  } else if (isCrate) {
    template = 'crate';
    const w = Math.min(3, sx);
    const h = Math.min(3, sy);
    const d = Math.min(3, sz);
    const ox = Math.max(0, cx - Math.floor(w / 2));
    const oz = Math.max(0, cz - Math.floor(d / 2));
    for (let y = 0; y < h; y++) {
      for (let x = ox; x < ox + w; x++) {
        for (let z = oz; z < oz + d; z++) add(x, y, z, crateColor);
      }
    }
  } else {
    for (let y = 0; y < Math.min(2, sy); y++) {
      for (let dx = -1; dx <= 0; dx++) {
        for (let dz = -1; dz <= 0; dz++) add(cx + dx, y, cz + dz, '#e05252');
      }
    }
  }

  paintVoxelCells(asset, cells);
  return { seeded: true, template, voxelCount: asset.voxel.voxels.length };
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

export function computeVoxelMeshStats(asset) {
  if (!asset || asset.kind !== 'voxel' || !asset.voxel) {
    return { voxelCount: 0, faces: 0, triangles: 0, vertices: 0, grid: null };
  }
  const voxels = asset.voxel.voxels || [];
  const grid = asset.voxel.size;
  if (!voxels.length) {
    return { voxelCount: 0, faces: 0, triangles: 0, vertices: 0, grid };
  }
  const set = new Set(voxels.map(v => v.x + ',' + v.y + ',' + v.z));
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  let faces = 0;
  for (const v of voxels) {
    for (const [dx, dy, dz] of dirs) {
      if (!set.has((v.x + dx) + ',' + (v.y + dy) + ',' + (v.z + dz))) faces++;
    }
  }
  return {
    voxelCount: voxels.length,
    faces,
    triangles: faces * 2,
    vertices: faces * 4,
    grid
  };
}

export function summarizeAsset(asset) {
  if (!asset) return null;
  if (asset.kind === 'voxel') {
    const mesh = computeVoxelMeshStats(asset);
    return {
      id: asset.id,
      name: asset.name,
      kind: asset.kind,
      collidable: !!asset.collidable,
      size: asset.voxel.size,
      voxelCount: mesh.voxelCount,
      mesh
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
