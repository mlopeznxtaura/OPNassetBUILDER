# Storage setup — free tier, no Cloudflare billing required

app14 splits **small JSON** (library per session, ~800 KB cap) from **large GLB files** (object storage). You do **not** have to enable Cloudflare R2 or add a card to Cloudflare for blobs.

## Choose a blob backend

| Option | Billing on file? | Typical free cap | Best for |
|--------|------------------|------------------|----------|
| **A. Git + `/assets/` deploy** | No | Repo size | Kit GLBs built by scripts/agents, committed, `npm run deploy` |
| **B. Supabase Storage** | Often **no card** for free project | **1 GB** storage | Automated user/agent upload without R2 |
| **C. MongoDB Atlas M0** | **No card** on M0 signup (OAuth) | **512 MB** whole cluster | Same; store blobs via Worker + GridFS or capped documents |
| **D. Cloudflare R2** | **Often requires card on file** to enable product | Free tier when enabled | Same account as Workers; optional only |

**Recommendation if you refuse Cloudflare billing:** use **A** for Belize/Trinidad kits (commit GLB → deploy), or **B** when we wire Supabase upload (next backend). Sessions + library already work on Workers **without** R2.

### App-level locks (we enforce regardless of provider)

These limits are in code (`workerBlobs.js`, `forgeRoom.js`) so one session cannot blow the free tier:

| Limit | Value |
|-------|--------|
| Library JSON per session | **800 KB** (reject save if larger) |
| Single GLB upload | **25 MB** |
| Planned: total blobs per session | **100 MB** (TODO: counter in DO) |
| Scan thumb in library | Reference JPEG only, not full frame arrays |

Provider caps (512 MB Mongo, 1 GB Supabase) are **hard ceilings** — the app limits sit below them.

---

## 1. Cloudflare Workers (hosting — already on app14)

### Wrangler OAuth

Remove a broken user env token (we removed `CLOUDFLARE_API_TOKEN` from your Windows user profile once; new terminals should be clean):

```powershell
cd f:\NextAuraMonth7getrichordietryin\gameforgev1
Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue
npx wrangler login
npx wrangler whoami
```

`account_id` is set in `wrangler.toml`.

### R2 (optional — skip if no card)

Only if you accept Cloudflare’s R2 enable flow (may ask for payment method on file; free tier usage can still be $0):

1. Dashboard → R2 → Enable.
2. `npx wrangler r2 bucket create opnassetbuilder-blobs` (+ preview).
3. Uncomment `[[r2_buckets]]` in `wrangler.toml`.
4. `npm run deploy`.

Without R2: `PUT /api/blobs/…` returns **503**; use path **A** or **B** below.

Helper script (includes optional R2 steps): `scripts/setup-r2.ps1`.

---

## 2. Path A — No upload API (zero storage signup)

1. Put `female-trinidadian.glb` in `assets/`.
2. `npm run deploy`.
3. `upsert_asset { kind:"character", src:"/assets/female-trinidadian.glb" }`.

Fully automated for **your** pipeline if the recipe agent commits + CI deploys. Not per-visitor upload.

---

## 3. Path B — Supabase Storage (free tier, no R2)

1. [supabase.com](https://supabase.com) → New project (GitHub login).
2. Storage → New bucket `opn-meshes` → **private** or public read for GLBs.
3. Settings → API: `SUPABASE_URL`, `service_role` key (Worker only, never in browser).

```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

**Status:** Worker proxy `PUT /api/blobs` → Supabase is planned; today use path A or enable R2.

---

## 4. Path C — MongoDB Atlas M0 (free, OAuth signup)

1. [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register) → M0 cluster.
2. Network: allow `0.0.0.0/0` for Cloudflare Workers egress (or Data API).
3. Store **metadata** or small blobs; **512 MB cluster max** — enforce **25 MB/file** in the Worker.

```bash
npx wrangler secret put MONGODB_DATA_API_URL
npx wrangler secret put MONGODB_DATA_API_KEY
```

**Status:** mirror library snapshots optional; blob path same as Supabase (planned).

---

## 5. Sessions (works today without any blob backend)

- `POST /api/sessions` → `sessionId` + cookie.
- `X-GameForge-Session` on `/api/*` and `/mcp`.
- One Durable Object per session (fresh studio).

## 6. MCP

```bash
set GAMEFORGE_ORIGIN=https://app14.nextaura.us
set GAMEFORGE_SESSION=s_xxxxxxxx
node mcp/stdio.js
```

See [PLATFORM_PLAN.md](./PLATFORM_PLAN.md).
