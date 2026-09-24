import {
  createVoxelAsset,
  deleteAsset,
  emptyLevel,
  emptyState,
  findAsset,
  gfNewId,
  gfValidateAsset,
  paintSpritePixels,
  paintVoxelCells,
  testState,
  upsertAsset
} from './shared/forgeCore.js';
import { buildAgentManifest, buildAgentTxt } from './shared/agentManifest.js';
import { handleMcpMessage } from './shared/mcpTools.js';

const MAX_BYTES = 800000;

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,accept',
    'access-control-max-age': '86400'
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...corsHeaders() }
  });
}

function text(body, status = 200) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...corsHeaders() }
  });
}

export class ForgeRoom {
  constructor(state) {
    this.ctx = state;
  }

  async read() {
    const stored = await this.ctx.storage.get('state');
    return stored ? structuredClone(stored) : emptyState();
  }

  async mutate(fn) {
    const next = await this.read();
    const extra = fn(next) || {};
    next.revision = (next.revision || 0) + 1;
    const raw = JSON.stringify(next);
    if (raw.length > MAX_BYTES) throw new Error('library is too large');
    await this.ctx.storage.put('state', next);
    return { revision: next.revision, ...extra };
  }

  async getState() {
    return this.read();
  }

  agentDoc(url) {
    return buildAgentManifest(url);
  }

  async route(request, url) {
    const path = url.pathname;
    if (path === '/agent.json' || path === '/.well-known/agent.json') return json(this.agentDoc(url));
    if (path === '/agent.txt') return text(buildAgentTxt(url));
    if (path === '/mcp') {
      if (request.method !== 'POST') return json({ ok: false, error: 'POST JSON-RPC to /mcp' }, 405);
      const msg = await request.json();
      const result = await handleMcpMessage(msg, this);
      if (result == null) return new Response(null, { status: 202, headers: corsHeaders() });
      return json(result);
    }
    if (path === '/api/health') {
      const state = await this.read();
      return json({ ok: true, app_id: 'app14', revision: state.revision, assets: state.library.assets.length });
    }
    if (path === '/api/state' && request.method === 'GET') {
      const state = await this.read();
      return json({ ok: true, ...state });
    }
    if (path === '/api/library' && request.method === 'GET') {
      const state = await this.read();
      return json({ ok: true, revision: state.revision, library: state.library });
    }
    if (path === '/api/library' && request.method === 'PUT') {
      const body = await request.json();
      const library = body.assets ? body : body.library;
      if (!library || !Array.isArray(library.assets)) throw new Error('library.assets required');
      for (const asset of library.assets) {
        if (!asset.id) asset.id = gfNewId();
        const errors = gfValidateAsset(asset);
        if (errors.length) throw new Error(asset.name + ': ' + errors.join(', '));
      }
      const saved = await this.mutate(state => {
        state.library = { version: 1, assets: library.assets };
        return { library: state.library };
      });
      return json({ ok: true, ...saved });
    }
    if (path === '/api/level' && request.method === 'GET') {
      const state = await this.read();
      return json({ ok: true, revision: state.revision, level: state.level });
    }
    if (path === '/api/level' && request.method === 'PUT') {
      const body = await request.json();
      const level = body.placements ? body : body.level;
      if (!level || !Array.isArray(level.placements)) throw new Error('level.placements required');
      const saved = await this.mutate(state => {
        state.level = {
          version: 1,
          ground: { size: Number(level.ground && level.ground.size) || 60 },
          placements: level.placements.map(p => ({
            id: p.id || gfNewId(),
            assetId: p.assetId,
            x: Number(p.x) || 0,
            y: Number(p.y) || 0,
            z: Number(p.z) || 0,
            ry: Number(p.ry) || 0,
            scale: Number(p.scale) || 1
          }))
        };
        return { level: state.level };
      });
      return json({ ok: true, ...saved });
    }
    if (path === '/api/test' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const state = await this.read();
      return json({ ok: true, ...testState(state, body) });
    }
    if (path === '/api/assets' && request.method === 'POST') {
      const body = await request.json();
      const saved = await this.mutate(state => {
        let asset = body.asset || body;
        const existing = findAsset(state.library, { id: asset.id, name: asset.id ? undefined : asset.name });
        if (!asset.kind) {
          asset = createVoxelAsset({
            id: existing && existing.id,
            name: asset.name,
            size: asset.size || [6, 6, 6],
            collidable: asset.collidable
          });
        }
        if (!asset.id) asset.id = existing ? existing.id : gfNewId();
        if (!asset.createdAt) asset.createdAt = existing ? existing.createdAt : Date.now();
        const errors = gfValidateAsset(asset);
        if (errors.length) throw new Error(errors.join(', '));
        if (Array.isArray(body.cells) && asset.kind === 'voxel') paintVoxelCells(asset, body.cells);
        upsertAsset(state.library, asset);
        return { asset };
      });
      return json({ ok: true, ...saved });
    }

    const assetVoxel = path.match(/^\/api\/assets\/([^/]+)\/voxels$/);
    if (assetVoxel && request.method === 'POST') {
      const id = decodeURIComponent(assetVoxel[1]);
      const body = await request.json();
      const saved = await this.mutate(state => {
        const asset = findAsset(state.library, { id });
        if (!asset) throw new Error('asset not found');
        const errors = paintVoxelCells(asset, body.cells || []);
        return { asset, errors };
      });
      return json({ ok: true, ...saved });
    }
    const assetSprite = path.match(/^\/api\/assets\/([^/]+)\/sprite$/);
    if (assetSprite && request.method === 'POST') {
      const id = decodeURIComponent(assetSprite[1]);
      const body = await request.json();
      const saved = await this.mutate(state => {
        const asset = findAsset(state.library, { id });
        if (!asset) throw new Error('asset not found');
        const errors = paintSpritePixels(asset, body.pixels || []);
        return { asset, errors };
      });
      return json({ ok: true, ...saved });
    }
    const assetOne = path.match(/^\/api\/assets\/([^/]+)$/);
    if (assetOne && request.method === 'GET') {
      const state = await this.read();
      const asset = findAsset(state.library, { id: decodeURIComponent(assetOne[1]) });
      if (!asset) return json({ ok: false, error: 'asset not found' }, 404);
      return json({ ok: true, revision: state.revision, asset });
    }
    if (assetOne && request.method === 'DELETE') {
      const id = decodeURIComponent(assetOne[1]);
      const saved = await this.mutate(state => {
        if (!findAsset(state.library, { id })) throw new Error('asset not found');
        deleteAsset(state.library, id);
        state.level.placements = state.level.placements.filter(p => p.assetId !== id);
        return { deleted: id };
      });
      return json({ ok: true, ...saved });
    }
    if (path === '/api/level/placements' && request.method === 'POST') {
      const body = await request.json();
      const saved = await this.mutate(state => {
        if (body.op === 'clear') {
          state.level = emptyLevel();
          if (body.groundSize) state.level.ground.size = Number(body.groundSize) || 60;
          return { level: state.level };
        }
        if (body.op === 'remove') {
          const before = state.level.placements.length;
          state.level.placements = state.level.placements.filter(p => p.id !== body.id);
          if (state.level.placements.length === before) throw new Error('placement not found');
          return { removed: body.id, level: state.level };
        }
        const asset = findAsset(state.library, { id: body.assetId, name: body.name });
        if (!asset) throw new Error('asset not found');
        const placement = {
          id: body.id || gfNewId(),
          assetId: asset.id,
          x: Number(body.x) || 0,
          y: Number(body.y) || 0,
          z: Number(body.z) || 0,
          ry: Number(body.ry) || 0,
          scale: Number(body.scale) || 1
        };
        state.level.placements.push(placement);
        return { placement, level: state.level };
      });
      return json({ ok: true, ...saved });
    }
    return json({ ok: false, error: 'not found' }, 404);
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
    try {
      return await this.route(request, url);
    } catch (err) {
      return json({ ok: false, error: err.message || 'error' }, 400);
    }
  }
}
