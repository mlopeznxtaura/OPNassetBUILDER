import { TOOLS } from './mcpTools.js';

export function buildAgentManifest(url) {
  const base = url.origin;
  return {
    schema_version: 2,
    app_id: 'app14',
    name: 'OPNassetBUILDER',
    title: 'OPNassetBUILDER',
    aliases: ['GameForge', 'OPNassetBUILDER', 'app14'],
    repository: 'https://github.com/mlopeznxtaura/OPNassetBUILDER',
    host: url.host,
    base_url: base,
    summary: 'Browser-first game asset pipeline: voxels, sprites, skinned characters, Scan 360 to voxel hull, per-session library sync, R2 blob storage for GLBs, MCP for agents.',
    purpose: 'Each session gets a fresh studio (library + level). Humans and agents design assets, upload kit GLBs to blob storage, and place assets in World. Library JSON stays small; meshes live at character.src or /api/blobs/….',
    how_built: 'Static HTML/JS + three.js on Cloudflare Workers. Worker: POST /api/sessions, R2 /api/blobs, routes /api/* and /mcp to ForgeRoom Durable Object keyed by sessionId. Design calls ensureForgeSession() before Live sync. See docs/PLATFORM_PLAN.md and docs/STORAGE_SETUP.md.',
    storage: {
      session: 'POST /api/sessions → sessionId + HttpOnly gf_session cookie (7d). Header X-GameForge-Session on API/MCP. ForgeRoom id = sessionId (legacy-shared if missing).',
      library_cap_bytes: 800000,
      blob_tier_order: 'assets → supabase → mongo → vercel → oci (Oracle S3) → aws (S3) → r2 last. Env BLOB_TIER_ORDER. See docs/STORAGE_TIERS.md.',
      blobs: 'PUT/GET /api/blobs/{sessionId}/{name}.glb (25MB). POST …/{name}.glb/upload-url → presigned direct upload (15m) or Worker PUT. Response includes backend.',
      secrets: 'SUPABASE_*, BLOB_READ_WRITE_TOKEN, OCI_S3_*, AWS_* (wrangler secret put — OAuth alone does not connect)',
      storage_status: 'GET /api/storage — which tiers have Worker secrets; upload JSON field backend shows winner'
    },
    discovery: {
      agent_json: '/agent.json',
      agent_txt: '/agent.txt',
      well_known: '/.well-known/agent.json',
      agents_page: '/agents/index.html',
      mcp: base + '/mcp',
      health: base + '/api/health',
      state: base + '/api/state'
    },
    ui: {
      home: base + '/',
      design_stage_1: base + '/design/',
      world_stage_2: base + '/world/'
    },
    stages: [
      {
        id: 1,
        name: 'Design & Visualize',
        path: '/design/',
        human: 'Paint voxels, pixel sprites, or pick a skinned character base. Webcam scan UI with pose-guided green body outline (browser only).'
      },
      {
        id: 2,
        name: 'World Viewer',
        path: '/world/',
        human: 'Place library assets on a ground plane, save level, fly with WASD.'
      }
    ],
    asset_kinds: {
      voxel: {
        fields: 'id, name, kind:"voxel", collidable, voxel:{ size:[x,y,z], cellSize, voxels:[{x,y,z,c}] }, scan?:{ image, capturedAt }',
        grid_max: 48,
        agent_notes: 'Use paint_voxels or upsert_asset with cells. Empty voxels can auto-seed a name-based starter (humanoid/tree/crate) unless seedStarter:false.'
      },
      sprite: {
        fields: 'id, name, kind:"sprite", collidable, sprite:{ w, h, pixels:string[] }',
        agent_notes: 'Use paint_sprite with pixels {x,y,c} or full asset in upsert_asset.'
      },
      character: {
        fields: 'id, name, kind:"character", collidable, character:{ model, src, stats:{vertices,triangles,materials,bones} }',
        models: {
          'female-hero': base + '/assets/female-hero.gltf',
          'male-hero': base + '/assets/male-hero.gltf'
        },
        agent_notes: 'character.src must be /assets/*.gltf|.glb OR /api/blobs/{sessionId}/*.glb after PUT upload. Catalog model (female-hero|male-hero) is a preset pointer only. list_assets includes characterSrc. Named-part kits: upload GLB then upsert with src — do not embed binary in library JSON.'
      },
      scan: {
        fields: 'scan?:{ image, capturedAt, width, height, frameCount, hullVoxels? }',
        agent_notes: 'Scan 360: records video, decodes silhouettes, visual-hull bakes voxel mesh in Design. Save keeps thumb + frameCount/hullVoxels. Export scan ZIP includes scan.webm, frames, manifest.json.'
      }
    },
    mcp: {
      transport: 'POST JSON-RPC 2.0 to /mcp',
      protocol: '2024-11-05',
      server_name: 'opnassetbuilder',
      tools: TOOLS.map(t => ({ name: t.name, description: t.description }))
    },
    rest_api: {
      cors: '*',
      revision: 'Every mutating call bumps state.revision. Poll GET /api/state and compare revision.',
      session_header: 'X-GameForge-Session: s_… (required for blob upload; required for isolated studio — browser sets automatically after POST /api/sessions)',
      endpoints: [
        { method: 'POST', path: '/api/sessions', desc: 'Create session { sessionId, expiresInDays }; Set-Cookie gf_session' },
        { method: 'POST', path: '/api/blobs/{sessionId}/{filename}.glb/upload-url', desc: 'Session-scoped upload URL (~15m): direct to Supabase/S3/OCI when configured, else Worker PUT URL' },
        { method: 'PUT', path: '/api/blobs/{sessionId}/{filename}.glb', desc: 'Upload mesh bytes (auth: session header/cookie must match sessionId). Returns { src, backend }' },
        { method: 'GET', path: '/api/blobs/{sessionId}/{filename}.glb', desc: 'Download mesh from R2' },
        { method: 'GET', path: '/api/health', desc: 'ok, app_id, revision, asset count' },
        { method: 'GET', path: '/api/state', desc: 'Full { revision, library, level }' },
        { method: 'GET', path: '/api/library', desc: 'Library only' },
        { method: 'PUT', path: '/api/library', desc: 'Replace library.assets[]' },
        { method: 'POST', path: '/api/assets', desc: 'Upsert one asset body' },
        { method: 'DELETE', path: '/api/assets/:id', desc: 'Delete asset' },
        { method: 'POST', path: '/api/assets/:id/voxels', desc: 'Paint cells on voxel asset' },
        { method: 'POST', path: '/api/assets/:id/sprite', desc: 'Paint sprite pixels' },
        { method: 'GET', path: '/api/level', desc: 'Level placements' },
        { method: 'PUT', path: '/api/level', desc: 'Replace level' },
        { method: 'POST', path: '/api/level/placements', desc: 'Add/remove/clear placements' },
        { method: 'POST', path: '/api/test', desc: 'Validate assets + collision probes [{x,z}]' }
      ]
    },
    agent_workflows: [
      {
        name: 'Create a voxel prop',
        steps: ['upsert_asset { name, kind:"voxel", size:[8,8,8], seedStarter:true }', 'paint_voxels { name, cells:[...] }', 'place { name, x, z }']
      },
      {
        name: 'Create a skinned hero',
        steps: ['upsert_asset { name:"female hero", kind:"character", model:"female-hero" }', 'place { name:"female hero", x:0, z:0 }']
      },
      {
        name: 'Inspect world',
        steps: ['list_assets', 'get_level', 'test_level { probes:[{x:0,z:0},{x:5,z:5}] }']
      },
      {
        name: 'Upload kit GLB and register character',
        steps: [
          'POST /api/sessions (or reuse GAMEFORGE_SESSION)',
          'PUT /api/blobs/{sessionId}/hero.glb with Content-Type model/gltf-binary and X-GameForge-Session',
          'upsert_asset { name:"hero", kind:"character", src:"/api/blobs/{sessionId}/hero.glb" }',
          'place { name:"hero", x:0, z:0 }'
        ]
      }
    ],
    local_stdio_mcp: {
      script: 'mcp/stdio.js',
      env: 'GAMEFORGE_ORIGIN=https://' + url.host + ' ; GAMEFORGE_SESSION=s_… (same as browser sessionStorage gf_session_id)',
      note: 'Proxies MCP to this host. Session header isolates agent library from other users.'
    },
    docs: {
      platform_plan: '/docs/PLATFORM_PLAN.md',
      storage_setup: '/docs/STORAGE_SETUP.md',
      storage_tiers: '/docs/STORAGE_TIERS.md',
      storage_oauth_wizard: 'npm run setup:storage:oauth — Supabase/Mongo/Vercel/AWS browser OAuth; npm run setup:oci when Oracle tenancy is live',
      oracle_setup: '/docs/ORACLE_OCI_SETUP.md'
    }
  };
}

export function buildAgentTxt(url) {
  const m = buildAgentManifest(url);
  return [
    m.title + ' (app14)',
    'Summary: ' + m.summary,
    'Host: ' + m.host,
    'Agent JSON: ' + m.discovery.agent_json,
    'Agents page: ' + m.discovery.agents_page,
    'MCP: POST ' + m.discovery.mcp,
    'State: GET ' + m.discovery.state,
    'Session: POST /api/sessions ; header X-GameForge-Session',
    'Blobs: PUT/GET /api/blobs/{sessionId}/{file}.glb',
    'Plan: docs/PLATFORM_PLAN.md',
    '',
    'Asset kinds: voxel | sprite | character',
    'Character models: female-hero, male-hero',
    '',
    'MCP tools: ' + m.mcp.tools.map(t => t.name).join(', '),
    '',
    'Example: upsert_asset {"name":"crate","kind":"voxel","size":[6,6,6],"seedStarter":true}',
    'Example: upsert_asset {"name":"male hero","kind":"character","model":"male-hero"}',
    'Example: upsert_asset {"name":"custom rig","kind":"character","src":"/api/blobs/s_abc/hero.glb"}',
    'Example: paint_voxels {"name":"crate","cells":[{"x":0,"y":0,"z":0,"c":"#e05252"}]}',
    'Example: place {"name":"crate","x":2,"z":3}',
    'Example: test_level {"probes":[{"x":0,"z":0}]}'
  ].join('\n') + '\n';
}
