# Blob storage tier order (free tiers first)

app14 uploads kit GLBs through **`PUT /api/blobs/{sessionId}/file.glb`**. The Worker tries backends in order until one succeeds. **R2 is last** even though it is enabled on your account.

**One-shot OAuth (Windows, run in your own PowerShell — not the agent terminal):**

- `npm run setup:storage:oauth` — **Supabase → Mongo → Vercel → Oracle → AWS** CLI/browser OAuth only (no Cloudflare).
- `npm run setup:storage` — same OAuth pass + `wrangler secret put` for each tier.
- Add `-IncludeCloudflare` only when you want Wrangler/R2 last:  
  `powershell -File ./scripts/setup-storage-oauth.ps1 -IncludeCloudflare`

## Default order

| # | Tier | Free-tier sketch | Wrangler secrets / config |
|---|------|------------------|---------------------------|
| 1 | **assets** | Unlimited via git | Commit to `assets/`, `npm run deploy`, `src: "/assets/…"` |
| 2 | **supabase** | ~1 GB storage | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET` |
| 3 | **mongo** | M0 ~512 MB | `MONGODB_DATA_API_URL`, `MONGODB_DATA_API_KEY` |
| 4 | **vercel** | Hobby blob limits | `BLOB_READ_WRITE_TOKEN` |
| 5 | **oci** | [Oracle Always Free](https://www.oracle.com/cloud/free/) object storage (~20 GB in home region) | `OCI_S3_*` (S3-compatible API) |
| 6 | **aws** | [AWS free tier](https://aws.amazon.com/free/) S3 (12 mo / limits) | `AWS_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` |
| 7 | **r2** | Cloudflare R2 (use after above) | `[[r2_buckets]]` in `wrangler.toml` |

Override order:

```toml
[vars]
BLOB_TIER_ORDER = "assets,supabase,mongo,vercel,oci,aws,r2"
```

## Oracle Cloud (OCI) object storage

**Status:** optional until Oracle tenancy is active. Other tiers work without OCI; the Worker skips missing `OCI_S3_*` secrets.

Full walkthrough: **[ORACLE_OCI_SETUP.md](./ORACLE_OCI_SETUP.md)** · one-shot secrets: `npm run setup:oci`

1. Sign up: [Oracle Cloud Free Tier](https://www.oracle.com/cloud/free/) (provisioning can take hours).
2. Create a **bucket** in your **home region**.
3. **Customer secret keys** (Profile → My profile → Customer secret keys).
4. Endpoint: `https://{namespace}.compat.objectstorage.{region}.oraclecloud.com`
5. `npm run setup:oci` or `wrangler secret put` for each `OCI_S3_*` name.

## AWS S3

1. [AWS account](https://aws.amazon.com/free/) + IAM user with **programmatic access** scoped to one bucket (`s3:PutObject`, `s3:GetObject`).
2. Create bucket (e.g. `opnassetbuilder-meshes-us-east-1`).
3. Secrets:

```bash
npx wrangler secret put AWS_S3_BUCKET
npx wrangler secret put AWS_ACCESS_KEY_ID
npx wrangler secret put AWS_SECRET_ACCESS_KEY
npx wrangler secret put AWS_REGION
```

Optional: `AWS_S3_ENDPOINT` for custom endpoints; leave unset for standard AWS.

## App caps (all tiers)

- **25 MB** per file  
- **800 KB** library JSON per session  
- Planned: **100 MB** total blobs per session  

See `shared/storageTiers.js`.

## Status (code vs production)

| Backend | Upload + GET in Worker | Needs |
|---------|------------------------|--------|
| **assets** | `/assets/` static only | `npm run deploy` |
| **supabase** | Yes | `wrangler secret put` SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, optional SUPABASE_BUCKET |
| **mongo** | **No** — tier is skipped in code | Not implemented yet |
| **vercel** | Yes | `BLOB_READ_WRITE_TOKEN` |
| **oci** | Yes | `OCI_S3_*` (5 secrets) |
| **aws** | Yes | `AWS_S3_BUCKET`, keys, `AWS_REGION` |
| **r2** | Yes | `[[r2_buckets]]` in wrangler.toml |

**OAuth / signup ≠ wired.** Logging into Supabase/Vercel/AWS in a browser does nothing until secrets are on the Worker (`npm run setup:storage` → `-SecretsOnly` step).

**R2 meta:** Files stored on Supabase/Vercel/OCI/AWS still write a small `__meta/` record in R2 so `GET /api/blobs/…` can find them. Keep R2 enabled.

**Check production:** `GET https://app14.nextaura.us/api/storage` → `configured` and `first_upload_tier`. After upload, JSON includes `"backend": "supabase"` (etc.).

## Per-session upload URLs (15 minutes)

`POST /api/blobs/{sessionId}/{file.glb}/upload-url` with `X-GameForge-Session` (same as PUT).

- **Supabase / AWS / OCI** (when Worker secrets exist): returns `mode: "direct"` + presigned `uploadUrl` (bytes go straight to that provider; master keys stay on the Worker).
- **Otherwise** (today: R2, Vercel, paused Supabase): returns `mode: "worker"` + same-origin PUT URL; still session-scoped, expires in ~15 minutes.

Design `uploadBlob()` tries upload-url first, then falls back to PUT.
