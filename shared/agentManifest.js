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
    summary: 'Browser-first game asset pipeline: design voxels/sprites/skinned characters, optional webcam body guide, place assets in a shared world, sync via Cloudflare Durable Object state.',
    purpose: 'Let humans and AI agents create, inspect, and place game assets in one shared library and level. Stage 1 is design with live 3D preview and mesh stats. Stage 2 is world placement and fly-camera collision tests.',
    how_built: 'Static HTML/JS + three.js on Cloudflare Workers. Worker routes /api/* and /mcp to a Durable Object (ForgeRoom) that holds library + level. UI pages poll GET /api/state or use localStorage when offline.',
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
        agent_notes: 'Catalog model (female-hero|male-hero) is a preset pointer — it does not rename the mesh file. Use character.src (same-origin /assets/*.gltf|.glb) when a custom rigged file is deployed. UI and list_assets show characterSrc so agents can verify binding. list_assets/get_asset do not include full scan JPEGs; scan may include frameCount only.'
      },
      scan: {
        fields: 'scan?:{ image (data URL ref), capturedAt, width, height, frameCount }',
        agent_notes: 'Stage 1 Scan 360 captures multiple frames in-browser; Save persists reference image + frameCount (not every frame in Durable Object). Humans export scan ZIP (frames + manifest.json) for external photogrammetry.'
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
      endpoints: [
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
      }
    ],
    local_stdio_mcp: {
      script: 'mcp/stdio.js',
      env: 'GAMEFORGE_ORIGIN=https://' + url.host,
      note: 'Proxies MCP to this host for Cursor/Claude desktop stdio clients.'
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
    '',
    'Asset kinds: voxel | sprite | character',
    'Character models: female-hero, male-hero',
    '',
    'MCP tools: ' + m.mcp.tools.map(t => t.name).join(', '),
    '',
    'Example: upsert_asset {"name":"crate","kind":"voxel","size":[6,6,6],"seedStarter":true}',
    'Example: upsert_asset {"name":"male hero","kind":"character","model":"male-hero"}',
    'Example: upsert_asset {"name":"custom rig","kind":"character","model":"female-hero","src":"/assets/my-hero.glb"}',
    'Example: paint_voxels {"name":"crate","cells":[{"x":0,"y":0,"z":0,"c":"#e05252"}]}',
    'Example: place {"name":"crate","x":2,"z":3}',
    'Example: test_level {"probes":[{"x":0,"z":0}]}'
  ].join('\n') + '\n';
}
