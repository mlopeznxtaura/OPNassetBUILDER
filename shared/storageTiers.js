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
