# Kit exports: **web** vs **engine** (two GLBs)

Desktop **web app** preview and **Unreal/Unity** import need **different files** from the same recipe. Same art; different packaging.

**Important:** Recipe kits are **not** shipped inside the web app. The app stores **metadata** in your session library; mesh bytes live in **session blob storage** after you build + upload each time (or your agent does).

| What | Where |
|------|--------|
| Recipe (parametric code) | `scripts/build_characters.py` in git |
| Generated GLBs | `dist/kits/` locally (gitignored) |
| Per-studio copies | `/api/blobs/{sessionId}/*.glb` |
| Static `/assets/` | **Stock** `female-hero` / `male-hero` glTF only — not Belize/Trinidad kits |

## The two exports

| Export | Filename pattern | Meshes | Used for |
|--------|------------------|--------|----------|
| **web** | `*_web.glb` | Merged by material (~tens, not hundreds) | **app14 only** — Design viewport, World placement, `character.src` or `kit.derivatives.web` |
| **engine** | `*_engine.glb` | Full named-part kit (~180–230) | **Unreal, Unity, download** — `kit.derivatives.engine`, FBX/ZIP siblings optional |

Do **not** load `*_engine.glb` in the browser preview if you care about smooth orbit. Do **not** send `*_web.glb` to Unreal if you need per-part names (`cargo_pocket_L`, `curl_03`, …).

## Build from scratch (offline)

```bash
pip install -r scripts/requirements-build.txt
npm run build:characters
```

Writes to `dist/kits/`:

- `male_belizean_web.glb` + `male_belizean_engine.glb`
- `female_trinidadian_web.glb` + `female_trinidadian_engine.glb`

## Upload into **your** session (required for app14)

1. Open Design on app14 (creates `gf_session` / `sessionId`).
2. Copy session id from devtools → `sessionStorage.gf_session_id` or network header `X-GameForge-Session`.

```bash
GAMEFORGE_ORIGIN=https://app14.nextaura.us GAMEFORGE_SESSION=s_YOUR_ID npm run upload:kit-blobs
```

Or `PUT` each file to `/api/blobs/{sessionId}/{filename}.glb` (Design **Import** buttons do the same for one file at a time).

## Register in the library (MCP / API)

**`kind: kit` (recommended)**

```json
{
  "name": "Belize male",
  "kind": "kit",
  "kit": {
    "recipe": { "script": "build_characters", "gender": "male", "region": "belize" },
    "derivatives": {
      "web": { "src": "/api/blobs/s_…/male_belizean_web.glb" },
      "engine": { "src": "/api/blobs/s_…/male_belizean_engine.glb" }
    }
  }
}
```

**Quick preview as character** (web file only):

```json
{
  "name": "Belize male",
  "kind": "character",
  "character": { "src": "/api/blobs/s_…/male_belizean_web.glb" }
}
```

## Blob API

`PUT /api/blobs/{sessionId}/{filename}.glb` or `POST …/upload-url`.  
Extensions for engine bundles: see `shared/engineBlob.js` (fbx, zip, unitypackage, …).

## GUI

Design → **Kit** → import web + engine GLBs (uploads to **your** session blobs) → Save. Library JSON stores paths only.

**Scan 360** builds a voxel hull in the browser — different pipeline, lower ceiling than the recipe kits.

See also [PLATFORM_PLAN.md](./PLATFORM_PLAN.md) pipeline B.
