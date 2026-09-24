# OPNassetBUILDER (app14) — platform plan

## Goals

- **Per-session studios**: each visitor gets a fresh library + level (not one global shared room).
- **Automated kits**: named-part GLBs (recipe output) upload without stuffing binaries into library JSON.
- **Scan path**: webcam → video/frames → visual-hull voxel mesh in Design; optional export ZIP for external photogrammetry.
- **Character path**: stock heroes, `/assets/*.glb` (git deploy), or session blobs via `character.src` (R2 **or** future Supabase/Mongo — R2 optional, not required).
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
| GLB / GLTF binaries | R2 (optional) · `/assets/` deploy · Supabase/Mongo (planned) | 25 MB/file app cap; provider free tier hard stop |
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
3. `PUT /api/blobs/{sessionId}/female-trinidadian.glb` with raw bytes.
4. `upsert_asset { kind:"character", name, src:"/api/blobs/…/female-trinidadian.glb" }`.
5. Design shows `characterSrc`; World loads via GLTFLoader.

### C. Future: `kind: kit` (not implemented)

Recipe params in library JSON; bake step writes GLB to R2; optional rig bind to hero skeleton.

## Ops

- Setup: [STORAGE_SETUP.md](./STORAGE_SETUP.md) (Wrangler OAuth, R2 buckets, optional Mongo).
- Deploy: `npm run deploy` with Wrangler logged in; unset invalid `CLOUDFLARE_API_TOKEN` if OAuth fails.

## Non-goals (core shell)

- Game-specific meshes baked into product code.
- In-browser photogrammetry matching recipe kit quality.
- Shared global library for all users (legacy `legacy-shared` DO id only for requests without a session).
