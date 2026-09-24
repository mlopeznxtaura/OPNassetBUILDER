# Blob storage tier order (free tiers first)

app14 uploads kit GLBs through **`PUT /api/blobs/{sessionId}/file.glb`**. The Worker tries backends in order until one succeeds. **R2 is last** even though it is enabled on your account.

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

1. Sign up: [Oracle Cloud Free Tier](https://www.oracle.com/cloud/free/) (no Cloudflare card).
2. Create a **bucket** in your **home region**.
3. **Customer secret keys** for S3-compatible API (User → My profile → Customer secret keys).
4. Note **namespace**, **region**, and S3 endpoint:  
   `https://{namespace}.compat.objectstorage.{region}.oraclecloud.com`
5. Set secrets:

```bash
npx wrangler secret put OCI_S3_ENDPOINT
npx wrangler secret put OCI_S3_BUCKET
npx wrangler secret put OCI_S3_ACCESS_KEY_ID
npx wrangler secret put OCI_S3_SECRET_ACCESS_KEY
npx wrangler secret put OCI_S3_REGION
```

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

## Status

| Backend | Upload | GET via `/api/blobs/…` |
|---------|--------|-------------------------|
| assets | Manual deploy | Static `/assets/` |
| r2 | Implemented | Implemented |
| supabase / mongo / vercel / oci / aws | Wired in tier router; enable with secrets |

Response field `backend` on successful upload shows which tier stored the file.
