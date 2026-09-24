# Storage setup (free tier): sessions, R2 blobs, optional MongoDB

app14 keeps **small JSON** per browser session (library + level) and **large GLB files** in object storage. You do not need MongoDB for automated kit uploads; R2 + per-session Durable Objects are enough on Cloudflare’s free tier.

## 1. Cloudflare (already used for app14)

### Wrangler OAuth (one-time per machine)

```bash
cd gameforgev1
# Unset a broken API token so OAuth is used:
Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue   # PowerShell
npx wrangler login
```

Approve the browser prompt. Verify:

```bash
npx wrangler whoami
```

### R2 bucket (GLB storage)

1. In the [Cloudflare dashboard](https://dash.cloudflare.com/) → **R2** → **Overview** → **Purchase/Enable R2** (free tier includes storage; one-time enable per account).
2. Then:

```bash
npx wrangler r2 bucket create opnassetbuilder-blobs
npx wrangler r2 bucket create opnassetbuilder-blobs-preview
npm run deploy
```

Until R2 is enabled, `PUT /api/blobs/…` returns **503** with a setup hint; sessions and library API still work.

After deploy:

- `POST /api/sessions` → new `sessionId` + `gf_session` cookie (7 days).
- `PUT /api/blobs/{sessionId}/hero.glb` with header `X-GameForge-Session: {sessionId}` → up to **25 MB** per file.
- Library row: `character.src: "/api/blobs/s_…/hero.glb"` (validated by the API).

Design/World call `ensureForgeSession()` before Live sync so each visitor gets a **fresh studio** unless they reuse the same browser session.

## 2. Limits (what “web storage” means here)

| Layer | Limit | Holds |
|--------|--------|--------|
| Durable Object per `sessionId` | **~800 KB** total library JSON | Assets metadata, voxels, scan thumb |
| R2 | Free tier storage + egress rules | **All GLB/GLTF binaries** |
| Browser `sessionStorage` | ~5 MB | Session id only |
| Browser `localStorage` | ~5 MB/site | Offline fallback copy of library |

Do **not** embed GLBs in library JSON.

## 3. Optional MongoDB Atlas M0 (free)

Use Mongo only if you want **long-lived** libraries, analytics, or admin search—not required for per-session automation.

1. Sign up: [https://www.mongodb.com/cloud/atlas/register](https://www.mongodb.com/cloud/atlas/register) (Google/GitHub OAuth).
2. Create a **M0 free** cluster (any region).
3. **Database Access** → Add user (password) → role `readWrite` on your DB.
4. **Network Access** → Allow access from anywhere (`0.0.0.0/0`) for Workers, or use Atlas **Private Endpoint** later.
5. **Data API** (if enabled on your project): create API key, note URL + key.

Store secrets (not in git):

```bash
npx wrangler secret put MONGODB_DATA_API_URL
npx wrangler secret put MONGODB_DATA_API_KEY
```

A future Worker hook can mirror `PUT /api/library` snapshots into Mongo; the live path remains DO + R2.

## 4. MCP / agents

Stdio proxy: set session so tools hit the same studio as the browser:

```bash
set GAMEFORGE_ORIGIN=https://app14.nextaura.us
set GAMEFORGE_SESSION=s_xxxxxxxx   # from Design after POST /api/sessions, or browser devtools → sessionStorage gf_session_id
node mcp/stdio.js
```

Upload a kit GLB:

1. `POST /api/sessions` (or reuse session).
2. `PUT /api/blobs/{sessionId}/female-trinidadian.glb` with raw GLB bytes.
3. `upsert_asset { kind:"character", name:"…", src:"/api/blobs/…/female-trinidadian.glb" }`.

## 5. Load balancing

Workers are stateless at the edge. Each request routes to `ForgeRoom` via `idFromName(sessionId)`—sessions shard naturally. R2 keys are `sessionId/filename`. No custom load balancer required.
