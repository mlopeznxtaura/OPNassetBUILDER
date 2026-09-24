# OPNassetBUILDER (GameForge)

GitHub: [mlopeznxtaura/OPNassetBUILDER](https://github.com/mlopeznxtaura/OPNassetBUILDER)

Open-source, zero-build, two-stage game asset pipeline. Pure HTML/JS + three.js
(loaded from CDN via `<script>` tags — no npm, no bundler).

## Stages

1. **Design & Visualize** — `design/index.html`
   Create voxel (3D block) or sprite (2D pixel-art) assets with a live 3D
   preview. Assets are stored in browser `localStorage` as a "library" and can
   be exported/imported as `library.json`.

2. **Render & Test in a minimal open world** — `world/index.html`
   Loads the asset library, lets you place instances on a flat ground plane,
   save/load the layout as `level.json`, and drop into a WASD fly-camera with
   basic circle-vs-circle collision against collidable placements.

## Running it

Browsers block `localStorage` and some module loading on `file://`. Serve the
folder with any static file server, e.g.:

```
git clone https://github.com/mlopeznxtaura/OPNassetBUILDER.git
cd OPNassetBUILDER
python3 -m http.server 8000
```

Then open `http://localhost:8000/design/index.html` to build assets, and
`http://localhost:8000/world/index.html` to place and test them. This repo
intentionally has no other host/env/network requirements.

## File layout

```
gameforge/
  shared/assetFormat.js   asset & level JSON schema + save/load/import/export helpers
  shared/voxelMesh.js      converts an asset (voxel or sprite) into a three.js Object3D
  design/index.html        Stage 1 tool
  world/index.html         Stage 2 tool
  agents.json              gap registry: unimplemented tasks + tests for offline continuation
```

## Data formats

- **Asset**: `{ id, name, kind: 'voxel'|'sprite', collidable, voxel?, sprite?, createdAt }`
- **Library**: `{ version, assets: Asset[] }` — persisted at `localStorage['gameforge_assets_v1']`
- **Level**: `{ version, ground: {size}, placements: [{assetId, x, y, z, ry, scale}] }`

See `shared/assetFormat.js` for full field docs.

## Known limitations (see `agents.json` for the structured gap list)

- Voxel meshing is per-color `InstancedMesh`, not greedy-meshed — fine for
  small models, wasteful at large voxel counts.
- Collision is a flat circle-radius approximation, not real AABB/mesh
  collision, and there's no vertical collision (jumping/terrain height).
- No texture painting on voxel faces (solid color per voxel only).
- No animation, no NPCs/AI, no multiplayer/networking.
- No automated test harness (browser-only app) — `agents.json` includes
  concrete test steps for each gap to close.
