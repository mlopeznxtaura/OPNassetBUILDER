# OPNassetBUILDER (app14) — platform plan

## Goals

- **Per-session studios**: each visitor gets a fresh library + level (not one global shared room).
- **Automated kits**: named-part GLBs (recipe output) upload without stuffing binaries into library JSON.
- **Scan path**: webcam → video/frames → visual-hull voxel mesh in Design; optional export ZIP for external photogrammetry.
- **Character path**: stock heroes (`/assets/female-hero.gltf`, `male-hero.gltf` only in git), or **session blobs** for custom/recipe meshes via `character.src` / `kit.derivatives.*` (tiered blob backends).
- **Agents**: same session as the browser via `X-GameForge-Session` + MCP stdio env.

## Architecture (current + rolling out)

```text
Browser / MCP
    │
    ├─ POST /api/sessions  →  sessionId + gf_session cookie
    ├─ PUT  /api/blobs/{sessionId}/{file}.glb  →  R2 (optional) or Supabase/Mongo (planned)
    ├─ GET  /api/blobs/...  →  serve GLB
    │
    └─ /api/* , /mcp  →  ForgeRoom Durable Object (one DO per sessionId)
            library JSON ≤ ~800 KB total
            level placements
```

| Concern | Store | Limit |
|---------|--------|--------|
| Metadata (assets, voxels, pointers) | DO per `sessionId` | ~800 KB / library |
| GLB / GLTF binaries | **Session blobs** (Supabase/S3/R2/…) · tiny stock glTF in `/assets/` only | 25 MB/file app cap; provider free tier hard stop |
| Offline copy | `localStorage` | ~5 MB / site (fallback) |
| Long-term archive (optional) | MongoDB Atlas M0 | Documents only, not meshes |

Workers at the edge are **stateless**; load spreads by `sessionId` (DO + R2 key prefix).

## Pipelines

### A. Scan 360 → voxel body (in browser)

1. Start webcam, pose guide green.
2. Scan 360 records video + silhouette frames.
3. Decode frames → `visualHull` → voxel asset (`… scan`).
4. Save library (metadata only).

### B. Recipe kit → character (external bake + upload)

1. Parametric script (e.g. `build_characters.py`) produces named-part `.glb`.
2. `POST /api/sessions` (or reuse session).
3. `PUT /api/blobs/…/female_trinidadian_web.glb` and `…_engine.glb` (see `scripts/build_characters.py`).
4. `upsert_asset { kind:"kit", derivatives:{ web:{src:…}, engine:{src:…} } }` or `kind:"character"` with **web** src only.
5. Design shows `characterSrc`; World loads via GLTFLoader.

### C. `kind: kit` (engine export)

Recipe params + **derivatives** per target (`web` glTF, `unreal` FBX, `unity` GLB/zip). Binaries via `/api/blobs/…` (FBX, ZIP, etc.). See [KIT_AND_ENGINE_EXPORT.md](./KIT_AND_ENGINE_EXPORT.md). In-browser recipe bake is still future; v1 = upload + register.

## Ops

- Setup: [STORAGE_SETUP.md](./STORAGE_SETUP.md) (Wrangler OAuth, R2 buckets, optional Mongo).
- Deploy: `npm run deploy` with Wrangler logged in; unset invalid `CLOUDFLARE_API_TOKEN` if OAuth fails.

## Non-goals (core shell)

- Game-specific meshes baked into product code.
- In-browser photogrammetry matching recipe kit quality.
- Shared global library for all users (legacy `legacy-shared` DO id only for requests without a session).
