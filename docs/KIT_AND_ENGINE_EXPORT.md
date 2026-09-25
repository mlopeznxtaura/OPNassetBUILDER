# Kit exports: **web** vs **engine** (two GLBs)

Desktop **web app** preview and **Unreal/Unity** import need **different files** from the same recipe. Same art; different packaging.

## The two exports

| Export | Filename pattern | Meshes | Used for |
|--------|------------------|--------|----------|
| **web** | `*_web.glb` | Merged by material (~tens, not hundreds) | **app14 only** — Design viewport, World placement, `character.src` or `kit.derivatives.web` |
| **engine** | `*_engine.glb` | Full named-part kit (~180–230) | **Unreal, Unity, download** — `kit.derivatives.engine`, FBX/ZIP siblings optional |

Do **not** load `*_engine.glb` in the browser preview if you care about smooth orbit. Do **not** send `*_web.glb` to Unreal if you need per-part names (`cargo_pocket_L`, `curl_03`, …).

## Build (offline)

From repo root (Python 3 + `trimesh`, `numpy`):

```bash
pip install trimesh numpy
python scripts/build_characters.py --out assets
```

Produces:

- `male_belizean_web.glb` + `male_belizean_engine.glb`
- `female_trinidadian_web.glb` + `female_trinidadian_engine.glb`

Deploy web files for in-app preview; upload engine files to `/api/blobs/…` for engine pipelines.

## Register in the library (MCP / API)

**Option A — `kind: kit` (recommended for Belize/Trinidad)**

```json
{
  "name": "Belize male",
  "kind": "kit",
  "kit": {
    "recipe": { "script": "build_characters", "gender": "male", "region": "belize" },
    "derivatives": {
      "web": { "src": "/assets/male_belizean_web.glb" },
      "engine": { "src": "/api/blobs/s_…/male_belizean_engine.glb" }
    }
  }
}
```

**Option B — quick preview as character**

```json
{ "name": "Belize male", "kind": "character", "src": "/assets/male_belizean_web.glb" }
```

Use **only** the `*_web.glb` path for `character.src`.

## Blob API

Upload either file with `PUT /api/blobs/{sessionId}/{filename}.glb` or `POST …/upload-url`.  
Extensions for engine bundles: see `shared/engineBlob.js` (fbx, zip, unitypackage, …).

## GUI

Design → **Kit (recipe)** or **Character** → **Import web GLB** = preview file. Engine file is uploaded separately and listed under kit derivatives (not previewed as 200 meshes).

**Scan 360** in Design produces a low-res voxel hull from webcam silhouettes — not the same quality ceiling as this recipe. Use kits for Belize/Trinidad heroes; use Scan for quick props or body-scale blockouts.

See also [PLATFORM_PLAN.md](./PLATFORM_PLAN.md) pipeline B.
