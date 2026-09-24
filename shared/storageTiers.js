/**
 * Blob backend priority: exhaust other vendors' free tiers before Cloudflare R2.
 * Override with Wrangler var BLOB_TIER_ORDER (comma-separated ids).
 */

export const BLOB_TIER_ORDER_DEFAULT = [
  'assets',    // git deploy /assets/* — no runtime upload
  'supabase',  // ~1 GB free
  'mongo',     // M0 ~512 MB cluster
  'vercel',    // Vercel Blob hobby limits
  'oci',       // Oracle Always Free object storage (~20 GB home region)
  'aws',       // S3 free tier / low-cost overflow
  'r2'         // Cloudflare R2 — last (you enabled it; use after others fill)
];

export const BLOB_LIMITS = {
  maxFileBytes: 25 * 1024 * 1024,
  maxLibraryBytes: 800_000,
  maxSessionBlobBytesPlanned: 100 * 1024 * 1024
};

export const TIER_HINTS = {
  assets: 'Commit GLB under assets/ and deploy — no upload API.',
  supabase: 'SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + SUPABASE_BUCKET',
  mongo: 'MONGODB_DATA_API_URL + MONGODB_DATA_API_KEY (GridFS / capped docs)',
  vercel: 'BLOB_READ_WRITE_TOKEN (Vercel Blob)',
  oci: 'S3-compatible: OCI_S3_ENDPOINT, OCI_S3_BUCKET, OCI_S3_ACCESS_KEY_ID, OCI_S3_SECRET_ACCESS_KEY',
  aws: 'AWS_S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION',
  r2: 'Wrangler [[r2_buckets]] binding BLOBS'
};

export function parseTierOrder(env) {
  const raw = env && env.BLOB_TIER_ORDER;
  if (!raw || typeof raw !== 'string') return [...BLOB_TIER_ORDER_DEFAULT];
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

/** Which blob backends have Worker secrets (no values exposed). */
export function blobTierConfigured(env) {
  const hasR2 = Boolean(env && env.BLOBS);
  return {
    assets: true,
    supabase: Boolean(env?.SUPABASE_URL && env?.SUPABASE_SERVICE_ROLE_KEY),
    mongo: false,
    vercel: Boolean(env?.BLOB_READ_WRITE_TOKEN),
    oci: Boolean(
      env?.OCI_S3_ENDPOINT && env?.OCI_S3_BUCKET && env?.OCI_S3_ACCESS_KEY_ID && env?.OCI_S3_SECRET_ACCESS_KEY
    ),
    aws: Boolean(env?.AWS_S3_BUCKET && env?.AWS_ACCESS_KEY_ID && env?.AWS_SECRET_ACCESS_KEY),
    r2: hasR2,
    /** External tiers store bytes off-R2; GET still needs R2 for __meta/ pointers. */
    r2_meta_required: hasR2
  };
}

export function blobTierImplementation() {
  return {
    assets: 'git deploy /assets/*',
    supabase: 'PUT/GET wired',
    mongo: 'not implemented — tier skipped',
    vercel: 'PUT/GET wired',
    oci: 'PUT/GET wired',
    aws: 'PUT/GET wired',
    r2: 'PUT/GET wired (full object or __meta/)',
    upload_url: 'POST /api/blobs/{sessionId}/{file.glb}/upload-url — presigned direct upload (15m) or Worker PUT fallback'
  };
}
