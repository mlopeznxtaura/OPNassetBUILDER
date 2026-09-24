# Oracle Cloud (OCI) — object storage for app14

You already have **Supabase, Mongo, Vercel, and AWS** wired. **OCI is optional** until signup finishes; the Worker skips `oci` when `OCI_S3_*` secrets are missing and uses the next tier.

Oracle signup is often slow (email verify, tenancy provisioning, sometimes ID check). Finish when you can — no app change required.

## What you need (5 values)

| Secret | Example | Where to find it |
|--------|---------|------------------|
| `OCI_S3_REGION` | `us-phoenix-1` | Home region of your tenancy (top bar in console) |
| Namespace | (used in endpoint) | **Storage** → **Bucket details** → **Namespace** |
| `OCI_S3_ENDPOINT` | `https://axk3abcdef.compat.objectstorage.us-phoenix-1.oraclecloud.com` | Built from namespace + region (no trailing slash) |
| `OCI_S3_BUCKET` | `opn-meshes` | **Storage** → **Buckets** → create in **home region** |
| `OCI_S3_ACCESS_KEY_ID` / `OCI_S3_SECRET_ACCESS_KEY` | Like AWS keys | **Profile** → **My profile** → **Customer secret keys** → **Generate secret key** |

S3-compatible base URL pattern:

```text
https://{namespace}.compat.objectstorage.{region}.oraclecloud.com
```

## Console clicks (after account is active)

1. [Oracle Cloud Console](https://cloud.oracle.com/) → pick **home region** (Always Free resources stay there).
2. **Storage** → **Buckets** → **Create** → name `opn-meshes` (or your choice) → **Standard** tier.
3. **Identity & Security** → **Policies** — ensure your user can write objects (simplest: add user to group with policy like `Allow group … to manage objects in compartment …` for that bucket’s compartment).
4. **Profile** (top right) → **My profile** → **Customer secret keys** → generate → copy **Access key** and **Secret key** once (secret is shown only at creation).

## Push secrets to the Worker

From repo root (interactive PowerShell):

```powershell
npm run setup:oci
```

Or manually:

```powershell
npx wrangler secret put OCI_S3_REGION
npx wrangler secret put OCI_S3_ENDPOINT
npx wrangler secret put OCI_S3_BUCKET
npx wrangler secret put OCI_S3_ACCESS_KEY_ID
npx wrangler secret put OCI_S3_SECRET_ACCESS_KEY
```

No redeploy required for secrets-only changes.

## Verify

1. `POST https://app14.nextaura.us/api/sessions` → `sessionId`
2. `PUT /api/blobs/{sessionId}/oci-test.glb` with `X-GameForge-Session` and a tiny GLB
3. Response should include `"backend": "oci"` once this tier wins in order (tiers above it must fail or be skipped — with your stack, uploads may still land on Supabase/Vercel/AWS first by design).

To **force** testing OCI only, temporarily set in `wrangler.toml`:

```toml
BLOB_TIER_ORDER = "oci,r2"
```

Deploy, test, then restore the full order.

## Signup still pending?

- Keep default `BLOB_TIER_ORDER` — missing OCI secrets cost nothing.
- Resume signup: [Oracle Cloud Free Tier](https://www.oracle.com/cloud/free/)
- When the tenancy shows **Active**, run `npm run setup:oci`.

See also [STORAGE_TIERS.md](./STORAGE_TIERS.md).
