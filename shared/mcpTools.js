import {
  collidesAt,
  createSpriteAsset,
  createVoxelAsset,
  deleteAsset,
  emptyLevel,
  findAsset,
  gfNewId,
  gfValidateAsset,
  paintSpritePixels,
  paintVoxelCells,
  placementRadius,
  summarizeAsset,
  testState,
  upsertAsset
} from './forgeCore.js';

export const TOOLS = [
  {
    name: 'list_assets',
    description: 'List GameForge assets (id, name, kind, counts).',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_asset',
    description: 'Get one asset by id or name, including voxel cells or sprite pixels.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, name: { type: 'string' } }
    }
  },
  {
    name: 'upsert_asset',
    description: 'Create or replace an asset. Pass a full asset, or name/kind/size/cells for a new voxel.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        kind: { type: 'string', enum: ['voxel', 'sprite'] },
        collidable: { type: 'boolean' },
        size: { type: 'array', items: { type: 'number' } },
        cells: { type: 'array' },
        asset: { type: 'object' }
      }
    }
  },
  {
    name: 'paint_voxels',
    description: 'Paint or erase voxel cells. Creates the named voxel asset if it does not exist. Cell: {x,y,z,c} or {x,y,z,erase:true}.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        size: { type: 'array', items: { type: 'number' } },
        collidable: { type: 'boolean' },
        cells: { type: 'array' }
      },
      required: ['cells']
    }
  },
  {
    name: 'paint_sprite',
    description: 'Paint sprite pixels {x,y,c}. Creates the sprite if needed.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        w: { type: 'number' },
        h: { type: 'number' },
        collidable: { type: 'boolean' },
        pixels: { type: 'array' }
      },
      required: ['pixels']
    }
  },
  {
    name: 'delete_asset',
    description: 'Delete an asset by id or name and remove its placements.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, name: { type: 'string' } }
    }
  },
  {
    name: 'get_level',
    description: 'Get the current world level: ground size and placements.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'place',
    description: 'Place an asset in the world. x/z are ground coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string' },
        name: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
        z: { type: 'number' },
        ry: { type: 'number' },
        scale: { type: 'number' }
      }
    }
  },
  {
    name: 'remove_placement',
    description: 'Remove one placement by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id']
    }
  },
  {
    name: 'clear_level',
    description: 'Remove every placement from the world.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'test_level',
    description: 'Validate assets and test circle collision at probe points {x,z}.',
    inputSchema: {
      type: 'object',
      properties: {
        probes: { type: 'array' },
        playerRadius: { type: 'number' }
      }
    }
  }
];

function requireAsset(library, args) {
  const asset = findAsset(library, { id: args.id, name: args.name });
  if (!asset) throw new Error('asset not found');
  return asset;
}

export async function callTool(name, args, store) {
  const input = args || {};
  switch (name) {
    case 'list_assets': {
      const state = await store.getState();
      return { revision: state.revision, assets: state.library.assets.map(summarizeAsset) };
    }
    case 'get_asset': {
      const state = await store.getState();
      const asset = requireAsset(state.library, input);
      return { revision: state.revision, asset };
    }
    case 'upsert_asset':
      return store.mutate(state => {
        const source = input.asset || input;
        let asset = source.kind ? source : null;
        if (!asset || !asset.kind) {
          asset = createVoxelAsset({
            name: source.name,
            size: source.size || [6, 6, 6],
            collidable: source.collidable
          });
        }
        if (!asset.id) {
          const existing = findAsset(state.library, { name: asset.name });
          asset.id = existing ? existing.id : gfNewId();
        }
        if (!asset.createdAt) asset.createdAt = Date.now();
        const errors = gfValidateAsset(asset);
        if (errors.length) throw new Error(errors.join(', '));
        if (asset.kind === 'voxel' && Array.isArray(source.cells)) paintVoxelCells(asset, source.cells);
        upsertAsset(state.library, asset);
        return { asset: summarizeAsset(asset), id: asset.id };
      });
    case 'paint_voxels':
      return store.mutate(state => {
        let asset = findAsset(state.library, { id: input.id, name: input.name });
        if (!asset) {
          asset = createVoxelAsset({
            name: input.name || 'unnamed',
            size: input.size || [6, 6, 6],
            collidable: input.collidable
          });
          upsertAsset(state.library, asset);
        }
        if (asset.kind !== 'voxel') throw new Error('asset is not a voxel');
        const errors = paintVoxelCells(asset, input.cells || []);
        return { id: asset.id, errors, asset: summarizeAsset(asset) };
      });
    case 'paint_sprite':
      return store.mutate(state => {
        let asset = findAsset(state.library, { id: input.id, name: input.name });
        if (!asset) {
          asset = createSpriteAsset({
            name: input.name || 'unnamed',
            w: input.w,
            h: input.h,
            collidable: input.collidable
          });
          upsertAsset(state.library, asset);
        }
        if (asset.kind !== 'sprite') throw new Error('asset is not a sprite');
        const errors = paintSpritePixels(asset, input.pixels || []);
        return { id: asset.id, errors, asset: summarizeAsset(asset) };
      });
    case 'delete_asset':
      return store.mutate(state => {
        const asset = requireAsset(state.library, input);
        deleteAsset(state.library, asset.id);
        state.level.placements = state.level.placements.filter(p => p.assetId !== asset.id);
        return { deleted: asset.id };
      });
    case 'get_level': {
      const state = await store.getState();
      return { revision: state.revision, level: state.level };
    }
    case 'place':
      return store.mutate(state => {
        const asset = findAsset(state.library, { id: input.assetId, name: input.name });
        if (!asset) throw new Error('asset not found');
        const placement = {
          id: gfNewId(),
          assetId: asset.id,
          x: Number(input.x) || 0,
          y: Number(input.y) || 0,
          z: Number(input.z) || 0,
          ry: Number(input.ry) || 0,
          scale: Number(input.scale) || 1
        };
        state.level.placements.push(placement);
        return {
          placement,
          radius: placementRadius(asset, placement.scale),
          collisionAtOrigin: collidesAt(state.library, state.level, 0, 0)
        };
      });
    case 'remove_placement':
      return store.mutate(state => {
        const before = state.level.placements.length;
        state.level.placements = state.level.placements.filter(p => p.id !== input.id);
        if (state.level.placements.length === before) throw new Error('placement not found');
        return { removed: input.id };
      });
    case 'clear_level':
      return store.mutate(state => {
        state.level = emptyLevel();
        if (input.groundSize) state.level.ground.size = Number(input.groundSize) || 60;
        return { level: state.level };
      });
    case 'test_level': {
      const state = await store.getState();
      return testState(state, input);
    }
    default:
      throw new Error('unknown tool: ' + name);
  }
}

export async function handleMcpMessage(msg, store) {
  if (!msg || msg.jsonrpc !== '2.0') {
    return { jsonrpc: '2.0', id: msg && msg.id != null ? msg.id : null, error: { code: -32600, message: 'invalid request' } };
  }
  if (msg.id == null) return null;
  if (msg.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: (msg.params && msg.params.protocolVersion) || '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'gameforge', version: '1.0.0' }
      }
    };
  }
  if (msg.method === 'ping') return { jsonrpc: '2.0', id: msg.id, result: {} };
  if (msg.method === 'tools/list') return { jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } };
  if (msg.method === 'tools/call') {
    try {
      const result = await callTool(msg.params && msg.params.name, (msg.params && msg.params.arguments) || {}, store);
      return {
        jsonrpc: '2.0',
        id: msg.id,
        result: { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false }
      };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id: msg.id,
        result: { content: [{ type: 'text', text: String(err.message || err) }], isError: true }
      };
    }
  }
  return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found' } };
}
